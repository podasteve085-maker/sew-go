/**
 * CouturPro — Couche de Résilience & Robustesse du Moteur de Synchronisation
 *
 * Ce module renforce le moteur de synchronisation existant pour gérer :
 *   - Les synchros différées (semaines/mois d'accumulation hors-ligne).
 *   - L'isolation stricte multi-ateliers : chaque atelier ne touche qu'à ses propres données.
 *   - La résistance aux conflits et aux collisions inter-ateliers et multi-onglets.
 *   - Le traitement par lots (batch) pour les grandes files sans bloquer le thread UI.
 *   - Le journal de bord de synchronisation persistant (audit-trail local).
 *   - Le classement topologique de la file : Client → Commande → Paiement → Mesure → RDV.
 *
 * PRINCIPES DE SÉCURITÉ :
 *   - Aucun item de la file n'est JAMAIS supprimé ici sans avoir été traité avec succès.
 *   - Aucun item n'est sauté définitivement : chaque item est toujours tenté à chaque cycle.
 *   - Les erreurs non-réseau ne bloquent PAS les items suivants indépendants.
 *   - Seules les erreurs réseau suspendent le cycle (connexion perdue).
 *
 * IMPORTANT : Ce fichier ne modifie, ne remplace et ne supprime aucun fichier existant.
 * Il exporte des fonctions additionnelles appelées depuis sync-engine.ts.
 */

import {
  getPendingSyncQueue,
  removeSyncQueueItem,
  updateSyncQueueItem,
  setLocalItem,
  getLocalItem,
  type SyncQueueItem,
} from "./offline-storage";

// ---------------------------------------------------------------------------
// PERSISTANCE DU MAPPING DES IDENTIFIANTS TEMPORAIRES (idMapping cross-cycles)
// ---------------------------------------------------------------------------

/**
 * Clé de stockage dans IndexedDB pour les mappings tempId → realId.
 * Persiste entre les cycles de synchronisation (toutes les 15s).
 *
 * PROBLÈME RÉSOLU : Si un client est créé offline (temp_xxx → uuid-supabase) dans le
 * cycle N, et qu'un paiement référençant cet ordre arrive dans le cycle N+1,
 * l'idMapping local (en mémoire) est vide → FK violation → item bloqué.
 *
 * SOLUTION : On persiste chaque nouveau mapping dans IndexedDB immédiatement après
 * un sync réussi, et on le recharge au début de chaque cycle.
 */
const ID_MAPPING_STORE_KEY = "couturpro_id_mappings";

interface PersistedIdMappings {
  id: string;
  entries: Array<{ tempId: string; realId: string; savedAt: string }>;
}

/**
 * Charge les mappings persistés depuis IndexedDB et les fusionne dans la Map en mémoire.
 * Appelé au début de chaque runResilientSync pour récupérer les mappings des cycles précédents.
 */
export async function loadPersistedIdMappings(idMapping: Map<string, string>): Promise<void> {
  try {
    const stored = await getLocalItem<PersistedIdMappings>("workshop_data", ID_MAPPING_STORE_KEY);
    if (stored?.entries) {
      for (const entry of stored.entries) {
        // On ne charge que si pas déjà présent en mémoire (ne pas écraser les mappings du cycle courant)
        if (!idMapping.has(entry.tempId)) {
          idMapping.set(entry.tempId, entry.realId);
        }
      }
    }
  } catch {
    // Ne jamais bloquer la synchronisation à cause du journal de mapping
  }
}

/**
 * Persiste un mapping tempId → realId dans IndexedDB.
 * Appelé immédiatement après chaque sync d'item réussi qui produit un nouveau mapping.
 * Conservation maximale : 500 entrées (rotation automatique).
 */
export async function persistIdMapping(tempId: string, realId: string): Promise<void> {
  try {
    const stored = await getLocalItem<PersistedIdMappings>("workshop_data", ID_MAPPING_STORE_KEY);
    const entries = stored?.entries ?? [];

    // Dédupliquer : remplacer si même tempId
    const idx = entries.findIndex((e) => e.tempId === tempId);
    const newEntry = { tempId, realId, savedAt: new Date().toISOString() };
    if (idx >= 0) {
      entries[idx] = newEntry;
    } else {
      entries.push(newEntry);
    }

    // Rotation : conserver uniquement les 500 dernières entrées
    await setLocalItem("workshop_data", {
      id: ID_MAPPING_STORE_KEY,
      entries: entries.slice(-500),
    });
  } catch {
    // Ne jamais bloquer la synchronisation à cause du journal de mapping
  }
}

// ---------------------------------------------------------------------------
// CONSTANTES DE CONFIGURATION
// ---------------------------------------------------------------------------

/**
 * Taille maximale d'un lot traité en une passe (protège le thread UI).
 * Au-delà, chaque lot est espacé d'une micro-pause.
 */
const BATCH_SIZE = 50;

/** Pause inter-lots (ms) pour libérer le thread UI entre deux séries. */
const INTER_BATCH_PAUSE_MS = 60;

/** Clé de stockage du journal de bord de synchronisation dans IndexedDB. */
const SYNC_LOG_STORE_KEY = "couturpro_sync_audit_log";

// ---------------------------------------------------------------------------
// PRIORITÉ TOPOLOGIQUE DES ENTITÉS
// Garantit que les dépendances sont toujours synchronisées avant leurs dépendants.
// (ex: le client doit exister sur Supabase avant la commande qui le référence)
// ---------------------------------------------------------------------------

const ENTITY_PRIORITY: Record<string, number> = {
  business: 0,        // 1er : infos de l'atelier
  garment_type: 0,    // 1er : types de vêtements (indépendants)
  catalog_model: 0,   // 1er : modèles catalogue (indépendants)
  client: 1,          // 2e : clients
  expense: 1,         // 2e : dépenses (légèrement dépendantes de l'atelier)
  order: 2,           // 3e : commandes (dépendent des clients)
  order_image: 3,     // 4e : photos de commandes (dépendent des commandes)
  measurement_set: 3, // 4e : mesures (dépendent des clients)
  appointment: 3,     // 4e : rendez-vous (dépendent des clients)
  payment: 4,         // 5e : paiements (dépendent des commandes)
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
 * Détermine si une erreur est une VRAIE erreur réseau (connexion physiquement perdue).
 *
 * IMPORTANT : Cette fonction est délibérément stricte pour ne PAS stopper le cycle de sync
 * sur des erreurs Supabase logiques (violation FK, contrainte unique, permission RLS) qui
 * contiendraient des mots comme "network", "timeout", "abort" dans leur message.
 *
 * Seules les erreurs correspondant à une coupure réseau réelle (navigator.onLine = false
 * ou messages d'échec DNS/TCP/SSL) suspendent le cycle.
 *
 * Les erreurs Supabase passent en "failed" et l'item est retenté au prochain cycle (15s).
 * Les autres items indépendants continuent de se synchroniser normalement.
 */
function isNetworkError(err: unknown): boolean {
  // Vérification immédiate du statut réseau du navigateur
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;

  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === "string"
      ? err.toLowerCase()
      : "";

  // Patterns strictement liés à une coupure réseau physique
  // NOTE : "network" seul est exclu car Supabase l'utilise aussi pour des erreurs logiques
  // NOTE : "timeout" seul est exclu car il peut venir de timeouts Supabase côté serveur
  // NOTE : "abort" seul est exclu car il peut venir d'AbortController applicatif
  return (
    msg.includes("failed to fetch") ||          // Navigateur : DNS ou TCP echoué
    msg.includes("networkerror") ||             // Firefox : vrai NetworkError
    msg.includes("network request failed") ||   // React Native / fetch polyfill
    msg.includes("load failed") ||              // Safari iOS : echec réseau
    msg.includes("the internet connection appears to be offline") || // iOS natif
    msg.includes("net::err_")                   // Chrome : erreurs réseau bas niveau
  );
}

// ---------------------------------------------------------------------------
// TRI TOPOLOGIQUE DE LA FILE DE SYNCHRONISATION
// ---------------------------------------------------------------------------

/**
 * Trie la file d'attente en respectant l'ordre de dépendance des entités.
 * À priorité égale, respecte l'ordre chronologique FIFO (createdAt ASC).
 * Garantit qu'un client est toujours synchronisé avant sa commande, etc.
 *
 * NOTE : Ne modifie jamais le contenu des items, uniquement leur ordre.
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
// TRAITEMENT PAR LOTS (BATCH PROCESSING)
// ---------------------------------------------------------------------------

/**
 * Découpe un tableau en sous-tableaux de taille `size`.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Génère les lots de traitement depuis une file déjà triée topologiquement.
 * Insère une micro-pause entre chaque lot pour libérer le thread UI.
 *
 * IMPORTANT : Aucune déduplication ici — addToSyncQueue dans offline-storage.ts
 * s'en charge déjà à l'écriture. Toute déduplication ici risquerait de supprimer
 * des items légitimes ou de fusionner des payloads dans le mauvais ordre.
 */
export async function* generateSyncBatches(
  queue: SyncQueueItem[],
): AsyncGenerator<SyncQueueItem[]> {
  const sorted = sortQueueTopologically(queue);
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
  status: "success" | "failed";
  retryCount: number;
  errorMessage?: string;
  businessId?: string;
}

/**
 * Enregistre une entrée dans le journal local de synchronisation.
 * Stocké dans IndexedDB sous la clé `couturpro_sync_audit_log`.
 * Les 200 dernières entrées sont conservées (rotation automatique).
 * Le journal ne bloque JAMAIS la synchronisation principale.
 */
export async function logSyncEvent(entry: Omit<SyncLogEntry, "id" | "timestamp">): Promise<void> {
  try {
    const logEntry: SyncLogEntry = {
      ...entry,
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    const { getLocalItem } = await import("./offline-storage");
    const existing = await getLocalItem<{ id: string; entries: SyncLogEntry[] }>(
      "workshop_data",
      SYNC_LOG_STORE_KEY,
    );

    const entries = existing?.entries ?? [];
    entries.push(logEntry);

    // Rotation : conserver uniquement les 200 dernières entrées
    await setLocalItem("workshop_data", {
      id: SYNC_LOG_STORE_KEY,
      entries: entries.slice(-200),
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
 *
 * ✅ Tri topologique (business → client → order → payment → …) : les dépendances
 *    sont toujours synchronisées AVANT leurs dépendants.
 *
 * ✅ Traitement par lots (BATCH_SIZE items) avec micro-pauses : ne bloque jamais
 *    l'interface utilisateur, même avec des milliers d'items accumulés.
 *
 * ✅ Isolation multi-ateliers : filtrage par business_id courant, garantit qu'aucun
 *    atelier ne touche aux données d'un autre.
 *
 * ✅ Continuation sur erreur non-réseau : un item en échec ne bloque PAS les items
 *    suivants indépendants (comportement identique au moteur d'origine).
 *
 * ✅ Suspension sur erreur réseau : si la connexion est perdue, le cycle s'arrête
 *    proprement pour reprendre au prochain cycle (evite les boucles d'erreurs).
 *
 * ✅ Aucun item supprimé sans traitement réussi : toute la gestion de la file
 *    reste cohérente — un item n'est retiré de la file QUE si processFn réussit.
 *
 * ✅ Journal de bord : chaque opération (succès/échec) est tracée localement.
 *
 * @param processFn Fonction de traitement d'un item unitaire (processSyncItem de sync-engine.ts)
 * @param idMapping Table de correspondance des identifiants temporaires → identifiants Supabase
 * @param preloadedQueue File déjà lue par l'appelant (évite une double-lecture d'IndexedDB)
 * @returns Statistiques du cycle : items synchronisés, en échec
 */
export async function runResilientSync(
  processFn: (item: SyncQueueItem, idMapping: Map<string, string>) => Promise<void>,
  idMapping: Map<string, string>,
  preloadedQueue?: SyncQueueItem[],
): Promise<{ synced: number; failed: number }> {
  const currentBusinessId = getCurrentBusinessIdFast();
  let synced = 0;
  let failed = 0;

  // 0. Charger les mappings persistés depuis les cycles précédents
  //    (résout les FK temporaires pour les paiements/mesures créés dans un cycle antérieur)
  await loadPersistedIdMappings(idMapping);

  // 1. Lire la file complète depuis IndexedDB (ou utiliser la file pré-lue pour éviter la double-lecture)
  const rawQueue = preloadedQueue ?? await getPendingSyncQueue();
  if (rawQueue.length === 0) return { synced: 0, failed: 0 };

  // 2. Filtrer : seulement les items de l'atelier courant (isolation stricte multi-ateliers)
  //    Cela garantit qu'un atelier A ne synchronise JAMAIS les données d'un atelier B,
  //    même s'ils se connectent exactement au même moment.
  const ownQueue = rawQueue.filter((item) =>
    itemBelongsToCurrentBusiness(item, currentBusinessId),
  );

  if (ownQueue.length === 0) return { synced: 0, failed: 0 };

  // 3. Traitement en lots triés topologiquement
  for await (const batch of generateSyncBatches(ownQueue)) {
    // Arrêt immédiat si connexion perdue entre deux lots
    if (!navigator.onLine) {
      console.info("[SyncRésil] Connexion perdue — suspension du cycle de synchronisation.");
      break;
    }

    for (const item of batch) {
      // Arrêt immédiat si connexion perdue en cours de lot
      if (!navigator.onLine) {
        console.info("[SyncRésil] Connexion perdue — suspension du cycle de synchronisation.");
        break;
      }

      try {
        // Snapshot de la taille du idMapping AVANT le traitement (pour détecter les nouveaux mappings)
        const mappingSizeBefore = idMapping.size;

        // Tentative de synchronisation de l'item
        await processFn(item, idMapping);

        // Succès : retirer l'item de la file (et seulement là)
        await removeSyncQueueItem(item.id);
        synced++;

        // Si processFn a ajouté de nouveaux mappings (ex: temp_xxx → uuid-supabase),
        // les persister dans IndexedDB pour qu'ils soient disponibles dans les cycles suivants.
        // Cela résout le cas : client créé en cycle N, paiement pour cet ordre en cycle N+1.
        if (idMapping.size > mappingSizeBefore) {
          // Identifier et persister uniquement les nouveaux mappings (pas tous)
          let mappingIdx = 0;
          for (const [tempId, realId] of idMapping) {
            if (mappingIdx >= mappingSizeBefore) {
              // Ce mapping est nouveau (au-delà de l'index avant la synchro)
              persistIdMapping(tempId, realId).catch(() => {});
            }
            mappingIdx++;
          }
        }

        // Journaliser le succès (non-bloquant)
        logSyncEvent({
          entity: item.entity,
          action: item.action,
          status: "success",
          retryCount: item.retryCount,
          businessId: item.payload["business_id"] as string | undefined,
        }).catch(() => {});

      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const newRetryCount = (item.retryCount ?? 0) + 1;

        console.error(
          `[SyncRésil] Échec [${item.entity}/${item.action}] retryCount=${newRetryCount} :`,
          errMsg,
        );

        // Mettre à jour le compteur de retries dans la file (l'item reste pour le prochain cycle)
        await updateSyncQueueItem({
          ...item,
          retryCount: newRetryCount,
          status: "failed",
          errorMessage: errMsg,
        });

        // Journaliser l'échec (non-bloquant)
        logSyncEvent({
          entity: item.entity,
          action: item.action,
          status: "failed",
          retryCount: newRetryCount,
          errorMessage: errMsg,
          businessId: item.payload["business_id"] as string | undefined,
        }).catch(() => {});

        failed++;

        // Si erreur réseau : suspension immédiate du cycle entier
        // (les items dépendants des suivants échoueraient de toute façon)
        if (isNetworkError(err)) {
          console.info("[SyncRésil] Erreur réseau détectée — suspension du cycle.");
          return { synced, failed };
        }

        // Si erreur non-réseau (ex: validation Supabase) :
        // On continue avec les items suivants qui sont indépendants.
        // L'item en échec sera retenté au prochain cycle de synchronisation (toutes les 15s).
      }
    }
  }

  return { synced, failed };
}
