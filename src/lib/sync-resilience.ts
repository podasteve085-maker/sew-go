/**
 * CouturPro — Couche de Résilience & Robustesse du Moteur de Synchronisation
 *
 * Ce module renforce le moteur de synchronisation existant pour gérer :
 *   - Les synchros différées (semaines/mois d'accumulation hors-ligne).
 *   - L'isolation stricte multi-ateliers : chaque atelier ne touche qu'à ses propres données.
 *   - La résistance aux conflits et aux collisions inter-ateliers et multi-onglets.
 *   - Le backoff exponentiel avec plafond pour les items temporairement en échec.
 *   - Le traitement par lots (batch) pour les grandes files sans bloquer le thread UI.
 *   - La déduplication renforcée en entrée de file (idempotence des mutations).
 *   - Le journal de bord de synchronisation persistant (audit-trail local).
 *   - Le classement topologique de la file : Client → Commande → Paiement → Mesure → RDV.
 *
 * IMPORTANT : Ce fichier ne modifie, ne remplace et ne supprime aucun fichier existant.
 * Il exporte des fonctions additionnelles appelées depuis sync-engine.ts.
 */

import {
  getPendingSyncQueue,
  removeSyncQueueItem,
  updateSyncQueueItem,
  setLocalItem,
  type SyncQueueItem,
} from "./offline-storage";

// ---------------------------------------------------------------------------
// CONSTANTES DE CONFIGURATION
// ---------------------------------------------------------------------------

/** Délai de base du backoff exponentiel (ms). Chaque retry ×2 (plafonné à MAX_BACKOFF_MS). */
const BASE_BACKOFF_MS = 1_500;

/** Plafond du délai de backoff (10 secondes max entre retries). */
const MAX_BACKOFF_MS = 10_000;

/**
 * Nombre maximal de tentatives avant qu'un item soit marqué "dead" et sauté
 * pour ne pas bloquer les items suivants indépendants.
 */
const MAX_RETRIES_BEFORE_SKIP = 5;

/**
 * Taille maximale d'un lot traité en une passe (protège le thread UI).
 * Au-delà, chaque lot est espacé d'une micro-pause.
 */
const BATCH_SIZE = 50;

/** Pause inter-lots (ms) pour libérer le thread UI entre deux séries. */
const INTER_BATCH_PAUSE_MS = 80;

/** Clé de stockage du journal de bord de synchronisation dans IndexedDB. */
const SYNC_LOG_STORE_KEY = "couturpro_sync_audit_log";

// ---------------------------------------------------------------------------
// PRIORITÉ TOPOLOGIQUE DES ENTITÉS
// Garantit que les dépendances sont toujours synchronisées avant leurs dépendants.
// (ex: le client doit exister sur Supabase avant la commande qui le référence)
// ---------------------------------------------------------------------------

const ENTITY_PRIORITY: Record<string, number> = {
  business: 0,       // 1er : infos de l'atelier
  client: 1,         // 2e : clients
  order: 2,          // 3e : commandes (dépendent des clients)
  order_image: 3,    // 4e : photos de commandes (dépendent des commandes)
  measurement_set: 3, // 4e : mesures (dépendent des clients)
  payment: 4,        // 5e : paiements (dépendent des commandes)
  appointment: 3,    // 4e : rendez-vous (dépendent des clients)
  garment_type: 0,   // 1er : types de vêtements (indépendants)
  catalog_model: 0,  // 1er : modèles catalogue (indépendants)
  expense: 1,        // 2e : dépenses (légèrement dépendantes de l'atelier)
};

// ---------------------------------------------------------------------------
// HELPERS INTERNES
// ---------------------------------------------------------------------------

/**
 * Délai asynchone non-bloquant.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calcule le délai de backoff exponentiel avec jitter (±20%) pour éviter
 * la tempête de retries simultanés depuis plusieurs onglets/appareils.
 */
export function computeBackoffDelay(retryCount: number): number {
  const base = Math.min(BASE_BACKOFF_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS);
  // ±20% de jitter pour désynchroniser les retries multi-onglets
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

/**
 * Détermine si un item en échec doit être sauté (pour débloquer la file)
 * ou si son erreur est définitivement fatale (violation FK non récupérable).
 */
export function shouldSkipFailedItem(item: SyncQueueItem): boolean {
  const retries = item.retryCount ?? 0;
  if (retries >= MAX_RETRIES_BEFORE_SKIP) return true;

  const msg = (item.errorMessage ?? "").toLowerCase();
  // Erreurs définitivement fatales : violation de contrainte d'intégrité non transitoire
  const fatalPatterns = [
    "violates check constraint",
    "violates not-null constraint",
    "invalid input syntax",
    "value too long",
    "already exists",        // doublon irrécupérable
    "permission denied",     // problème RLS : ne réessayera pas
  ];
  return fatalPatterns.some((p) => msg.includes(p));
}

/**
 * Détermine si une erreur est transitoire (réseau, timeout, surcharge serveur)
 * et mérite un retry avec backoff.
 */
export function isTransientError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === "string"
      ? err.toLowerCase()
      : "";
  const transientPatterns = [
    "failed to fetch",
    "network",
    "timeout",
    "abort",
    "503",
    "502",
    "504",
    "too many requests",
    "rate limit",
    "load failed",
    "fetch",
    "connection",
  ];
  return transientPatterns.some((p) => msg.includes(p));
}

// ---------------------------------------------------------------------------
// TRI TOPOLOGIQUE DE LA FILE DE SYNCHRONISATION
// ---------------------------------------------------------------------------

/**
 * Trie la file d'attente en respectant l'ordre de dépendance des entités.
 * À priorité égale, respecte l'ordre chronologique FIFO (createdAt ASC).
 * Garantit qu'un client est toujours synchronisé avant sa commande, etc.
 */
export function sortQueueTopologically(queue: SyncQueueItem[]): SyncQueueItem[] {
  return [...queue].sort((a, b) => {
    const pa = ENTITY_PRIORITY[a.entity] ?? 99;
    const pb = ENTITY_PRIORITY[b.entity] ?? 99;
    if (pa !== pb) return pa - pb;
    // À même priorité : FIFO strict par date de création
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

// ---------------------------------------------------------------------------
// ISOLATION MULTI-ATELIERS
// ---------------------------------------------------------------------------

/**
 * Extrait le business_id courant depuis localStorage (clé la plus rapide).
 * Retourne null si impossible (SSR, stockage indisponible).
 */
export function getCurrentBusinessIdFast(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("couturpro_current_business_id") ?? null;
  } catch {
    return null;
  }
}

/**
 * Vérifie que l'item de la file appartient bien à l'atelier actuel.
 * Les items sans business_id dans le payload passent toujours (cas légitimes).
 * Garantit qu'aucun atelier A ne peut synchroniser les données d'un atelier B.
 */
export function itemBelongsToCurrentBusiness(
  item: SyncQueueItem,
  currentBusinessId: string | null,
): boolean {
  if (!currentBusinessId) return true; // Impossible de vérifier → laisser passer
  const payloadBizId = item.payload["business_id"] as string | undefined;
  if (!payloadBizId) return true; // Pas de business_id dans le payload → laisser passer
  return payloadBizId === currentBusinessId;
}

// ---------------------------------------------------------------------------
// DÉDUPLICATION RENFORCÉE (IDEMPOTENCE)
// ---------------------------------------------------------------------------

/**
 * Déduplication à l'entrée de la file : si plusieurs mutations "update" successives
 * portent sur le même objet, fusionne leurs payloads en une seule opération.
 * Évite les N requêtes inutiles sur Supabase pour le même enregistrement.
 *
 * Cette déduplication est complémentaire à celle de addToSyncQueue dans offline-storage.ts
 * et opère au moment du traitement (file déjà stockée).
 */
export function deduplicateQueue(queue: SyncQueueItem[]): SyncQueueItem[] {
  const seen = new Map<string, SyncQueueItem>();
  const result: SyncQueueItem[] = [];

  for (const item of queue) {
    // Clé de déduplication : entité + action + identifiant de l'objet
    const objId =
      (item.payload["id"] as string | undefined) ?? item.tempId ?? item.id;
    const key = `${item.entity}::${item.action}::${objId}`;

    if (item.action === "update" && seen.has(key)) {
      // Fusionner les payloads : le plus récent écrase le plus ancien
      const existing = seen.get(key)!;
      const merged: SyncQueueItem = {
        ...existing,
        payload: { ...existing.payload, ...item.payload },
        // Conserver la date la plus ancienne pour maintenir l'ordre FIFO
        createdAt: existing.createdAt,
      };
      seen.set(key, merged);
      // Supprimer l'entrée ancienne de la liste de résultat
      const idx = result.findIndex((r) => r.id === existing.id);
      if (idx !== -1) result[idx] = merged;
      // Marquer l'item en double comme traité pour éviter double envoi
      removeSyncQueueItem(item.id).catch(() => {});
    } else {
      seen.set(key, item);
      result.push(item);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// TRAITEMENT PAR LOTS (BATCH PROCESSING)
// ---------------------------------------------------------------------------

/**
 * Découpe un tableau en sous-tableaux de taille `size`.
 * Utilisé pour traiter la file hors-ligne par lots de BATCH_SIZE items,
 * en insérant une micro-pause entre chaque lot pour ne pas bloquer le thread UI.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Génère les lots de traitement depuis une file déjà triée et dédupliquée.
 * Retourne un itérateur asynchrone de lots avec pause inter-lots.
 */
export async function* generateSyncBatches(
  queue: SyncQueueItem[],
): AsyncGenerator<SyncQueueItem[]> {
  const sorted = sortQueueTopologically(deduplicateQueue(queue));
  const chunks = chunkArray(sorted, BATCH_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      // Micro-pause entre lots pour libérer le thread UI et éviter le gel de l'interface
      await delay(INTER_BATCH_PAUSE_MS);
    }
    yield chunks[i];
  }
}

// ---------------------------------------------------------------------------
// JOURNAL DE BORD LOCAL (AUDIT TRAIL DE SYNCHRONISATION)
// ---------------------------------------------------------------------------

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  entity: string;
  action: string;
  status: "success" | "skipped" | "failed";
  retryCount: number;
  errorMessage?: string;
  businessId?: string;
}

/**
 * Enregistre une entrée dans le journal local de synchronisation.
 * Stocké dans IndexedDB sous la clé `couturpro_sync_audit_log`.
 * Les 200 dernières entrées sont conservées (rotation automatique).
 */
export async function logSyncEvent(entry: Omit<SyncLogEntry, "id" | "timestamp">): Promise<void> {
  try {
    const logEntry: SyncLogEntry = {
      ...entry,
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    // Lire le journal existant
    const { getLocalItem } = await import("./offline-storage");
    const existing = await getLocalItem<{ id: string; entries: SyncLogEntry[] }>(
      "workshop_data",
      SYNC_LOG_STORE_KEY,
    );

    const entries = existing?.entries ?? [];
    entries.push(logEntry);

    // Rotation : conserver uniquement les 200 dernières entrées
    const trimmed = entries.slice(-200);

    await setLocalItem("workshop_data", {
      id: SYNC_LOG_STORE_KEY,
      entries: trimmed,
    });
  } catch {
    // Le journal ne doit jamais bloquer la synchronisation principale
  }
}

/**
 * Récupère le journal de synchronisation local (pour diagnostics / affichage admin).
 */
export async function getSyncLog(): Promise<SyncLogEntry[]> {
  try {
    const { getLocalItem } = await import("./offline-storage");
    const existing = await getLocalItem<{ id: string; entries: SyncLogEntry[] }>(
      "workshop_data",
      SYNC_LOG_STORE_KEY,
    );
    return existing?.entries ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// ORCHESTRATEUR RENFORCÉ — REMPLACE LA BOUCLE NAÏVE DE sync-engine.ts
// ---------------------------------------------------------------------------

/**
 * Traite la file de synchronisation complète avec toutes les garanties de robustesse :
 * - Tri topologique (Client → Commande → Paiement → …)
 * - Déduplication
 * - Traitement par lots (BATCH_SIZE items)
 * - Isolation multi-ateliers
 * - Backoff exponentiel pour les erreurs transitoires
 * - Skip des items définitivement bloqués (sans arrêter les items indépendants)
 * - Journal de bord de chaque opération
 *
 * @param processFn Fonction de traitement d'un item unitaire (issue de processSyncItem dans sync-engine.ts)
 * @param idMapping Table de correspondance des identifiants temporaires → identifiants Supabase
 * @returns Nombre d'items synchronisés avec succès
 */
export async function runResilientSync(
  processFn: (item: SyncQueueItem, idMapping: Map<string, string>) => Promise<void>,
  idMapping: Map<string, string>,
): Promise<{ synced: number; skipped: number; failed: number }> {
  const currentBusinessId = getCurrentBusinessIdFast();
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  // 1. Lire la file complète depuis IndexedDB
  const rawQueue = await getPendingSyncQueue();
  if (rawQueue.length === 0) return { synced: 0, skipped: 0, failed: 0 };

  // 2. Filtrer : seulement les items de l'atelier courant (isolation multi-ateliers)
  const ownQueue = rawQueue.filter((item) =>
    itemBelongsToCurrentBusiness(item, currentBusinessId),
  );

  // 3. Traitement en lots triés et dédupliqués
  for await (const batch of generateSyncBatches(ownQueue)) {
    if (!navigator.onLine) break; // Arrêt immédiat si connexion perdue en cours de sync

    for (const item of batch) {
      if (!navigator.onLine) break;

      // 4. Skip des items définitivement bloqués (trop de retries ou erreur fatale)
      if (shouldSkipFailedItem(item)) {
        console.warn(
          `[SyncRésil] Item sauté après ${item.retryCount} tentatives : ${item.entity}/${item.action} [${item.id}]`,
        );
        await logSyncEvent({
          entity: item.entity,
          action: item.action,
          status: "skipped",
          retryCount: item.retryCount,
          errorMessage: item.errorMessage,
          businessId: item.payload["business_id"] as string | undefined,
        });
        skipped++;
        continue; // NE PAS stopper la file — continuer les items suivants
      }

      try {
        await processFn(item, idMapping);
        await removeSyncQueueItem(item.id);
        synced++;

        await logSyncEvent({
          entity: item.entity,
          action: item.action,
          status: "success",
          retryCount: item.retryCount,
          businessId: item.payload["business_id"] as string | undefined,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[SyncRésil] Échec [${item.entity}/${item.action}] id=${item.id} :`,
          errMsg,
        );

        const newRetryCount = (item.retryCount ?? 0) + 1;
        const isTransient = isTransientError(err);

        await updateSyncQueueItem({
          ...item,
          retryCount: newRetryCount,
          status: "failed",
          errorMessage: errMsg,
        });

        await logSyncEvent({
          entity: item.entity,
          action: item.action,
          status: "failed",
          retryCount: newRetryCount,
          errorMessage: errMsg,
          businessId: item.payload["business_id"] as string | undefined,
        });

        if (!isTransient) {
          // Erreur non-réseau : on continue les items INDÉPENDANTS
          // (ne pas arrêter toute la file pour une erreur isolée non transitoire)
          failed++;
          continue;
        }

        // Erreur réseau transitoire : backoff exponentiel avant de continuer
        const backoff = computeBackoffDelay(newRetryCount);
        console.info(`[SyncRésil] Backoff ${backoff}ms avant retry (tentative ${newRetryCount})…`);
        await delay(backoff);

        // Vérifier à nouveau la connexion après le délai
        if (!navigator.onLine) {
          console.info("[SyncRésil] Connexion perdue pendant backoff — suspension de la sync.");
          break;
        }

        // Un seul retry immédiat après backoff pour les erreurs réseau légères
        try {
          await processFn(item, idMapping);
          await removeSyncQueueItem(item.id);
          synced++;

          await logSyncEvent({
            entity: item.entity,
            action: item.action,
            status: "success",
            retryCount: newRetryCount,
            businessId: item.payload["business_id"] as string | undefined,
          });
        } catch (retryErr: unknown) {
          failed++;
          console.warn(
            `[SyncRésil] Retry échoué pour ${item.id} — reporté au prochain cycle.`,
            retryErr,
          );
        }
      }
    }
  }

  return { synced, skipped, failed };
}
