/**
 * CouturPro — Système d'Authentification Hors-Ligne & Coffre-Fort Sécurisé Local
 * 
 * Permet aux artisans de :
 * 1. Se reconnecter à leur atelier même sans connexion Internet (avec leur mot de passe habituel).
 * 2. Modifier ou réinitialiser leur mot de passe en mode hors-ligne en cas d'oubli.
 * 3. Synchroniser automatiquement le nouveau mot de passe vers Supabase dès le retour du réseau.
 */

import { supabase } from "@/integrations/supabase/client";
import { cleanPhone } from "@/lib/format";
import { extractDigits } from "@/lib/phone-utils";
import { toast } from "sonner";

export interface OfflineAccountVault {
  id: string; // businessId ou identifiant unique
  businessId: string;
  userId: string;
  phone: string;
  email: string | null;
  businessName: string;
  ownerName: string | null;
  salt: string;
  passwordHash?: string;
  business?: any;
  lastLoginAt: string;
  pendingPasswordSync?: {
    newPasswordPlain: string;
    phone: string;
    businessName: string;
    ownerName: string;
    requestedAt: string;
  };
}

const VAULT_STORAGE_KEY = "couturpro_offline_auth_vault";
const VAULT_IDB_KEY = "offline_accounts_vault";

/**
 * Calcul d'empreinte cryptographique SHA-256 avec sel individuel par atelier
 */
export async function hashPasswordOffline(password: string, salt: string): Promise<string> {
  const salted = `${salt}:${password}:couturpro_salt_vault_v1`;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const data = new TextEncoder().encode(salted);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fallback si WebCrypto n'est pas disponible
    }
  }

  // Fallback simple si WebCrypto n'est pas disponible (environnement dégradé)
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    const char = salted.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fb_${Math.abs(hash).toString(16)}`;
}

/**
 * Récupère tous les comptes enregistrés dans le coffre-fort local
 */
export async function getOfflineVault(): Promise<OfflineAccountVault[]> {
  if (typeof window === "undefined") return [];

  // 1. Essai de lecture depuis IndexedDB (résistant à localStorage.clear())
  try {
    const { getLocalItem } = await import("@/lib/offline-storage");
    const item = await getLocalItem<{ id: string; accounts: OfflineAccountVault[] }>(
      "workshop_data",
      VAULT_IDB_KEY,
    );
    if (item && Array.isArray(item.accounts) && item.accounts.length > 0) {
      // Synchroniser le cache localStorage
      try {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(item.accounts));
      } catch {}
      return item.accounts;
    }
  } catch {
    // IDB temporairement inaccessible
  }

  // 2. Lecture de secours depuis localStorage
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  return [];
}

/**
 * Enregistre le coffre-fort local dans IndexedDB ET localStorage
 */
export async function saveOfflineVault(accounts: OfflineAccountVault[]): Promise<void> {
  if (typeof window === "undefined") return;

  // 1. Sauvegarde dans localStorage pour accès synchrone ultra-rapide
  try {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(accounts));
  } catch {}

  // 2. Sauvegarde persistante dans IndexedDB (ne disparaît jamais lors d'une déconnexion)
  try {
    const { setLocalItem } = await import("@/lib/offline-storage");
    await setLocalItem("workshop_data", {
      id: VAULT_IDB_KEY,
      accounts,
    });
  } catch {}
}

/**
 * Enregistre ou met à jour les identifiants d'un atelier après une connexion ou création en ligne
 */
export async function saveOfflineCredentials(params: {
  identifier: string;
  password?: string;
  userId: string;
  businessId: string;
  businessName: string;
  ownerName?: string | null;
  phone?: string | null;
  email?: string | null;
  business?: any;
}): Promise<void> {
  if (typeof window === "undefined") return;

  const accounts = await getOfflineVault();
  const digits = extractDigits(params.phone || params.identifier);
  const cleanId = digits.length >= 8 ? digits.slice(-8) : params.identifier.trim().toLowerCase();

  let account = accounts.find((a) => {
    if (a.businessId === params.businessId || a.userId === params.userId) return true;
    if (digits.length >= 8 && extractDigits(a.phone).slice(-8) === cleanId) return true;
    if (params.email && a.email && a.email.toLowerCase() === params.email.toLowerCase()) return true;
    return false;
  });

  const salt = account?.salt || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `salt_${Date.now()}`);
  let passwordHash = account?.passwordHash;

  if (params.password) {
    passwordHash = await hashPasswordOffline(params.password, salt);
  }

  const updatedAccount: OfflineAccountVault = {
    id: params.businessId,
    businessId: params.businessId,
    userId: params.userId,
    phone: params.phone || account?.phone || params.identifier,
    email: params.email || account?.email || null,
    businessName: params.businessName || account?.businessName || "Mon Atelier",
    ownerName: params.ownerName || account?.ownerName || null,
    salt,
    passwordHash,
    business: params.business || account?.business || null,
    lastLoginAt: new Date().toISOString(),
    pendingPasswordSync: account?.pendingPasswordSync,
  };

  const filtered = accounts.filter((a) => a.businessId !== params.businessId && a.id !== params.businessId);
  filtered.push(updatedAccount);

  await saveOfflineVault(filtered);

  // Mettre à jour les clés de session locales
  applyOfflineSession(updatedAccount);
}

/**
 * Applique les clés de session locales pour autoriser l'accès à l'application
 */
export function applyOfflineSession(account: OfflineAccountVault): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("couturpro_current_business_id", account.businessId);
    localStorage.setItem("couturpro_current_user_id", account.userId);
    if (account.business) {
      localStorage.setItem("couturpro_cached_business", JSON.stringify(account.business));
    }
  } catch {}
}

/**
 * Tentative de connexion hors-ligne avec vérification du mot de passe hashé
 */
export async function verifyAndLoginOffline(
  identifier: string,
  passwordVal: string,
): Promise<{ success: boolean; message?: string; account?: OfflineAccountVault }> {
  const accounts = await getOfflineVault();
  if (accounts.length === 0) {
    return {
      success: false,
      message: "Aucun atelier n'est encore enregistré hors-ligne sur cet appareil. Connectez-vous avec Internet au moins une première fois.",
    };
  }

  const digits = extractDigits(identifier);
  const cleanLast8 = digits.length >= 8 ? digits.slice(-8) : "";
  const lowerIdent = identifier.trim().toLowerCase();

  // Recherche de l'atelier correspondant
  const account = accounts.find((a) => {
    if (cleanLast8 && extractDigits(a.phone).slice(-8) === cleanLast8) return true;
    if (a.email && a.email.toLowerCase() === lowerIdent) return true;
    if (extractDigits(a.phone) === digits && digits.length > 0) return true;
    return false;
  });

  if (!account) {
    return {
      success: false,
      message: "Atelier introuvable hors-ligne pour ce numéro ou email. Vérifiez votre saisie.",
    };
  }

  if (!account.passwordHash) {
    return {
      success: false,
      message: "Aucun mot de passe hors-ligne n'est mémorisé pour cet atelier. Connectez-vous avec Internet pour initialiser le coffre-fort local.",
    };
  }

  const computedHash = await hashPasswordOffline(passwordVal, account.salt);
  if (computedHash !== account.passwordHash) {
    return {
      success: false,
      message: "Mot de passe incorrect pour cet atelier en mode hors-ligne. Vérifiez votre saisie ou utilisez « Mot de passe oublié ? ».",
    };
  }

  // Mot de passe correct : activation de la session hors-ligne
  applyOfflineSession(account);

  // Mettre à jour l'heure de dernière connexion
  account.lastLoginAt = new Date().toISOString();
  await saveOfflineVault(accounts);

  return {
    success: true,
    account,
  };
}

/**
 * Réinitialisation directe de mot de passe en mode hors-ligne
 * avec vérification de l'identité de l'artisan (téléphone + nom d'atelier ou propriétaire)
 */
export async function resetPasswordOffline(params: {
  phone: string;
  businessName: string;
  ownerName?: string;
  newPassword: string;
}): Promise<{ success: boolean; message?: string }> {
  const accounts = await getOfflineVault();
  const digits = extractDigits(params.phone);
  const cleanLast8 = digits.length >= 8 ? digits.slice(-8) : "";

  const account = accounts.find((a) => {
    if (cleanLast8 && extractDigits(a.phone).slice(-8) === cleanLast8) return true;
    return false;
  });

  if (!account) {
    return {
      success: false,
      message: "Aucun atelier trouvé en mémoire locale pour ce numéro de téléphone.",
    };
  }

  // Vérification de sécurité : le nom de l'atelier ou le nom du propriétaire doit correspondre
  const normInputBiz = params.businessName.trim().toLowerCase();
  const normSavedBiz = (account.businessName || "").trim().toLowerCase();
  const normInputOwner = (params.ownerName || "").trim().toLowerCase();
  const normSavedOwner = (account.ownerName || "").trim().toLowerCase();

  const bizMatches =
    normSavedBiz.includes(normInputBiz) || normInputBiz.includes(normSavedBiz);
  const ownerMatches =
    normInputOwner.length > 2 &&
    (normSavedOwner.includes(normInputOwner) || normInputOwner.includes(normSavedOwner));

  if (!bizMatches && !ownerMatches) {
    return {
      success: false,
      message: "Les informations de l'atelier (nom de l'atelier ou propriétaire) ne correspondent pas aux données mémorisées sur cet appareil.",
    };
  }

  // Génération du nouveau hash de mot de passe
  const newHash = await hashPasswordOffline(params.newPassword, account.salt);
  account.passwordHash = newHash;

  // Enregistrement de l'action de synchronisation différée
  account.pendingPasswordSync = {
    newPasswordPlain: params.newPassword,
    phone: account.phone,
    businessName: account.businessName,
    ownerName: account.ownerName || params.ownerName || "",
    requestedAt: new Date().toISOString(),
  };

  await saveOfflineVault(accounts);

  // Connexion immédiate de l'artisan avec son nouveau mot de passe
  applyOfflineSession(account);

  return { success: true };
}

/**
 * Détecte si une erreur est due à l'absence de réseau ou à un échec de fetch
 */
export function isNetworkOrOfflineError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!err) return false;
  const msg =
    typeof err === "string"
      ? err
      : err instanceof Error
      ? err.message
      : typeof (err as any).message === "string"
      ? (err as any).message
      : "";
  const lower = msg.toLowerCase();
  return (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network error") ||
    lower.includes("offline") ||
    lower.includes("fetch") ||
    lower.includes("abort") ||
    lower.includes("timeout") ||
    lower.includes("load failed")
  );
}

/**
 * Synchronise les mots de passe mis à jour hors-ligne dès que la connexion revient
 */
export async function syncPendingOfflinePasswords(): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;

  const accounts = await getOfflineVault();
  const pendingAccounts = accounts.filter((a) => a.pendingPasswordSync);
  if (pendingAccounts.length === 0) return;

  for (const acc of pendingAccounts) {
    const sync = acc.pendingPasswordSync;
    if (!sync) continue;

    try {
      const { data, error } = await supabase.rpc("reset_password_by_phone_verification", {
        p_phone: sync.phone,
        p_business_name: sync.businessName,
        p_owner_name: sync.ownerName,
        p_new_password: sync.newPasswordPlain,
      });

      if (!error && (data as any)?.success) {
        delete acc.pendingPasswordSync;
        await saveOfflineVault(accounts);
        toast.success("Synchronisation du mot de passe réussie", {
          description: `Le mot de passe de l'atelier ${acc.businessName} a été mis à jour sur le serveur distant.`,
        });
      }
    } catch {
      // Réessaiera au prochain cycle de synchronisation
    }
  }
}
