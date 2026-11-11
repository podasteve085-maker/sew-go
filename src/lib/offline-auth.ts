/**
 * CouturPro — Système d'Authentification Hors-Ligne & Coffre-Fort Sécurisé Local
 * 
 * Permet aux artisans de :
 * 1. Se reconnecter à leur atelier même sans connexion Internet (avec leur mot de passe habituel).
 * 2. Modifier ou réinitialiser leur mot de passe en mode hors-ligne en cas d'oubli.
 * 3. Synchroniser automatiquement le nouveau mot de passe vers Supabase dès le retour du réseau.
 */

import { supabase } from "@/integrations/supabase/client";
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
 * Normalise une chaîne de caractères (retire accents, minuscules, espaces)
 */
export function normalizeText(txt: string | null | undefined): string {
  if (!txt) return "";
  return txt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

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
 * Auto-découverte des ateliers existants sur l'appareil si le coffre-fort est vide
 */
async function autoSeedVaultFromDevice(): Promise<OfflineAccountVault[]> {
  const seeded: OfflineAccountVault[] = [];
  if (typeof window === "undefined") return seeded;

  try {
    const cachedBizStr = localStorage.getItem("couturpro_cached_business");
    const currentBizId = localStorage.getItem("couturpro_current_business_id");
    const currentUserId = localStorage.getItem("couturpro_current_user_id");

    let business: any = null;
    if (cachedBizStr) {
      try {
        business = JSON.parse(cachedBizStr);
      } catch {}
    }

    // 1. Essayer de lire depuis IndexedDB workshop_data
    if (!business) {
      try {
        const { getAllLocalItems } = await import("@/lib/offline-storage");
        const items = await getAllLocalItems<any>("workshop_data");
        const found = items.find(
          (it) => it && it.id !== VAULT_IDB_KEY && (it.name || it.phone || it.owner_id || it.whatsapp)
        );
        if (found) business = found;
      } catch {}
    }

    // 2. Si pas d'atelier explicite, tenter de retrouver l'identifiant depuis clients ou commandes en local
    let foundBizId = business?.id || currentBizId;
    let foundUserId = business?.owner_id || currentUserId || foundBizId;

    if (!business) {
      try {
        const { getAllLocalItems } = await import("@/lib/offline-storage");
        const clients = await getAllLocalItems<any>("clients");
        if (clients && clients.length > 0 && clients[0]?.business_id) {
          foundBizId = clients[0].business_id;
        }
      } catch {}
    }

    if (business || foundBizId) {
      const bId = business?.id || foundBizId;
      const uId = business?.owner_id || foundUserId || bId;
      const phone = business?.phone || business?.whatsapp || "";
      const salt = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `salt_${Date.now()}`;

      const item: OfflineAccountVault = {
        id: bId,
        businessId: bId,
        userId: uId,
        phone: phone,
        email: business?.email || null,
        businessName: business?.name || "Mon Atelier",
        ownerName: business?.owner_name || null,
        salt,
        business: business || { id: bId, name: "Mon Atelier", phone, owner_id: uId },
        lastLoginAt: new Date().toISOString(),
      };

      seeded.push(item);

      // Sauvegarder immédiatement ce compte auto-découvert
      saveOfflineVault(seeded).catch(() => {});
    }
  } catch {}

  return seeded;
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
      try {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(item.accounts));
      } catch {}
      return item.accounts;
    }
  } catch {}

  // 2. Lecture de secours depuis localStorage
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  // 3. Si aucun compte dans le coffre-fort, auto-découverte des données de l'atelier sur l'appareil
  return await autoSeedVaultFromDevice();
}

/**
 * Enregistre le coffre-fort local dans IndexedDB ET localStorage
 */
export async function saveOfflineVault(accounts: OfflineAccountVault[]): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(accounts));
  } catch {}

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
 * Tentative de connexion hors-ligne avec vérification du mot de passe
 */
export async function verifyAndLoginOffline(
  identifier: string,
  passwordVal: string,
): Promise<{ success: boolean; message?: string; account?: OfflineAccountVault }> {
  let accounts = await getOfflineVault();

  // Si le coffre est vide, tentative ultime de chargement depuis l'appareil
  if (accounts.length === 0) {
    accounts = await autoSeedVaultFromDevice();
  }

  const digits = extractDigits(identifier);
  const cleanLast8 = digits.length >= 8 ? digits.slice(-8) : "";
  const lowerIdent = identifier.trim().toLowerCase();

  // Recherche tolérante et multi-critères de l'atelier
  let account = accounts.find((a) => {
    // 1. Correspondance par les 8 derniers chiffres du téléphone (standard Afrique de l'Ouest)
    if (cleanLast8 && extractDigits(a.phone).slice(-8) === cleanLast8) return true;
    if (cleanLast8 && extractDigits(a.business?.whatsapp || "").slice(-8) === cleanLast8) return true;
    if (cleanLast8 && extractDigits(a.business?.phone || "").slice(-8) === cleanLast8) return true;

    // 2. Correspondance stricte sur l'ensemble des chiffres
    if (digits.length > 0 && extractDigits(a.phone) === digits) return true;
    if (digits.length > 0 && extractDigits(a.business?.whatsapp || "") === digits) return true;

    // 3. Correspondance email ou identifiant texte
    if (a.email && a.email.toLowerCase() === lowerIdent) return true;
    if (a.phone && a.phone.toLowerCase() === lowerIdent) return true;

    // 4. Sous-chaîne de chiffres (avec ou sans indicatif international +226, 00226, etc.)
    const accDigits = extractDigits(a.phone);
    if (digits.length >= 6 && accDigits.length >= 6) {
      if (digits.endsWith(accDigits) || accDigits.endsWith(digits)) return true;
    }

    return false;
  });

  // Si toujours pas trouvé mais qu'un seul atelier existe sur cet appareil (mono-atelier typique)
  if (!account && accounts.length === 1) {
    account = accounts[0];
  }

  if (!account) {
    return {
      success: false,
      message:
        accounts.length === 0
          ? "Aucun atelier n'est encore enregistré hors-ligne sur cet appareil. Connectez-vous une première fois avec connexion Internet pour mémoriser vos accès, ou utilisez « Mot de passe oublié ? » pour déverrouiller votre atelier."
          : "Atelier introuvable hors-ligne pour ce numéro ou email sur cet appareil. Vérifiez votre saisie ou utilisez « Mot de passe oublié ? ».",
    };
  }

  // Si le mot de passe n'a pas encore été mémorisé en local pour cet atelier existant
  if (!account.passwordHash) {
    // Initialisation immédiate du mot de passe pour cet atelier sur cet appareil
    account.passwordHash = await hashPasswordOffline(passwordVal, account.salt);
    account.pendingPasswordSync = {
      newPasswordPlain: passwordVal,
      phone: account.phone || identifier,
      businessName: account.businessName,
      ownerName: account.ownerName || "",
      requestedAt: new Date().toISOString(),
    };
    await saveOfflineVault(accounts);
    applyOfflineSession(account);
    return { success: true, account };
  }

  // Vérification de l'empreinte du mot de passe
  const computedHash = await hashPasswordOffline(passwordVal, account.salt);
  if (computedHash !== account.passwordHash) {
    return {
      success: false,
      message: "Mot de passe incorrect pour cet atelier en mode hors-ligne. Utilisez « Mot de passe oublié ? » ci-dessous pour le réinitialiser.",
    };
  }

  // Mot de passe correct : activation de la session locale
  applyOfflineSession(account);
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
  let accounts = await getOfflineVault();
  if (accounts.length === 0) {
    accounts = await autoSeedVaultFromDevice();
  }

  const digits = extractDigits(params.phone);
  const cleanLast8 = digits.length >= 8 ? digits.slice(-8) : "";

  let account = accounts.find((a) => {
    if (cleanLast8 && extractDigits(a.phone).slice(-8) === cleanLast8) return true;
    if (cleanLast8 && extractDigits(a.business?.whatsapp || "").slice(-8) === cleanLast8) return true;
    if (digits && extractDigits(a.phone) === digits) return true;
    return false;
  });

  if (!account && accounts.length === 1) {
    account = accounts[0];
  }

  // Si aucun atelier n'est trouvé dans le coffre (ex: premier usage hors-ligne ou cache nettoyé),
  // on crée et déverrouille l'atelier localement avec les informations fournies par l'artisan
  // et on prépare la synchronisation automatique dès que le réseau sera disponible.
  if (!account) {
    const salt = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `salt_${Date.now()}`;
    const newHash = await hashPasswordOffline(params.newPassword, salt);
    const newId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `biz_offline_${Date.now()}`;

    const newAccount: OfflineAccountVault = {
      id: newId,
      businessId: newId,
      userId: newId,
      phone: params.phone,
      email: null,
      businessName: params.businessName.trim(),
      ownerName: params.ownerName ? params.ownerName.trim() : null,
      salt,
      passwordHash: newHash,
      business: {
        id: newId,
        name: params.businessName.trim(),
        owner_name: params.ownerName ? params.ownerName.trim() : null,
        phone: params.phone,
        owner_id: newId,
      },
      lastLoginAt: new Date().toISOString(),
      pendingPasswordSync: {
        newPasswordPlain: params.newPassword,
        phone: params.phone,
        businessName: params.businessName.trim(),
        ownerName: params.ownerName ? params.ownerName.trim() : "",
        requestedAt: new Date().toISOString(),
      },
    };

    accounts.push(newAccount);
    await saveOfflineVault(accounts);
    applyOfflineSession(newAccount);
    return { success: true };
  }

  // Vérification de sécurité tolérante (insensible aux accents et majuscules)
  const normInputBiz = normalizeText(params.businessName);
  const normSavedBiz = normalizeText(account.businessName);
  const normInputOwner = normalizeText(params.ownerName);
  const normSavedOwner = normalizeText(account.ownerName);

  const bizMatches =
    normSavedBiz.length > 0 &&
    (normSavedBiz.includes(normInputBiz) || normInputBiz.includes(normSavedBiz));
  const ownerMatches =
    normSavedOwner.length > 0 &&
    normInputOwner.length > 1 &&
    (normSavedOwner.includes(normInputOwner) || normInputOwner.includes(normSavedOwner));

  if (!bizMatches && !ownerMatches && accounts.length > 1) {
    return {
      success: false,
      message: "Le nom de l'atelier ou du propriétaire ne correspond pas aux données mémorisées sur cet appareil.",
    };
  }

  // Mise à jour locale du mot de passe
  const newHash = await hashPasswordOffline(params.newPassword, account.salt);
  account.passwordHash = newHash;

  account.pendingPasswordSync = {
    newPasswordPlain: params.newPassword,
    phone: account.phone || params.phone,
    businessName: account.businessName || params.businessName,
    ownerName: account.ownerName || params.ownerName || "",
    requestedAt: new Date().toISOString(),
  };

  await saveOfflineVault(accounts);
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
        toast.success("Synchronisation réussie", {
          description: `Le mot de passe de l'atelier ${acc.businessName} a été synchronisé sur les serveurs sécurisés.`,
        });
      }
    } catch {}
  }
}
