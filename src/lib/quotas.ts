import type { Business, SubscriptionPlan } from "@/hooks/use-business";

export const PLAN_CONFIG = {
  free: {
    label: "Gratuit",
    badge: "bg-muted text-muted-foreground border-border",
    maxClients: 10,
    maxMonthlyOrders: 10,
    maxCatalogModels: 5,
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      "Jusqu'à 10 clients enregistrés",
      "Jusqu'à 10 commandes par mois",
      "Jusqu'à 5 modèles au catalogue",
      "Carnet de mesures complet",
      "Gestion des rendez-vous",
      "Suivi des statuts de commandes",
    ],
  },
  pro_monthly: {
    label: "Pro Mensuel",
    badge: "bg-primary/15 text-primary border-primary/30",
    maxClients: Infinity,
    maxMonthlyOrders: Infinity,
    maxCatalogModels: Infinity,
    priceMonthly: 2500,
    priceYearly: 30000,
    features: [
      "Clients illimités",
      "Commandes illimitées",
      "Catalogue & Lookbook illimités",
      "Mesures & Gabarits illimités",
      "Historique complet",
      "Paiements, acomptes & soldes",
      "Reçus d'atelier imprimables & WhatsApp",
      "Photos des modèles & tissus illimitées",
      "Statistiques & analyses du chiffre d'affaires",
      "Sauvegarde cloud sécurisée",
    ],
  },
  pro_yearly: {
    label: "Pro Annuel",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    maxClients: Infinity,
    maxMonthlyOrders: Infinity,
    maxCatalogModels: Infinity,
    priceMonthly: 2083,
    priceYearly: 25000, // 25 000 FCFA / an au lieu de 30 000 FCFA (2 mois offerts)
    features: [
      "Tous les avantages Pro",
      "Facturation annuelle avantageuse (-17%)",
      "2 mois d'abonnement offerts",
      "Support prioritaire",
    ],
  },
  unlimited: {
    label: "VIP / Illimité",
    badge: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
    maxClients: Infinity,
    maxMonthlyOrders: Infinity,
    maxCatalogModels: Infinity,
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      "Accès VIP permanent",
      "Exemption totale de tout abonnement",
      "Toutes les fonctionnalités actuelles et futures",
    ],
  },
} as const;

/** Vérifie si l'atelier a un abonnement Pro actif ou des droits illimités / Admin */
export function isProOrAdmin(business: Business | null | undefined): boolean {
  if (!business) return false;
  if (business.is_admin) return true;
  if (business.plan === "unlimited") return true;
  if (
    (business.plan === "pro_monthly" || business.plan === "pro_yearly") &&
    business.plan_status === "active"
  ) {
    // Vérifie si l'abonnement n'a pas expiré
    if (business.plan_expires_at) {
      return new Date(business.plan_expires_at).getTime() > Date.now();
    }
    return true;
  }
  return false;
}

/** Vérifie si l'atelier peut ajouter un nouveau client selon son quota */
export function checkClientQuota(
  business: Business | null | undefined,
  currentClientsCount: number,
): {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string | undefined;
} {
  if (isProOrAdmin(business)) {
    return { allowed: true, limit: Infinity, current: currentClientsCount, remaining: Infinity };
  }

  const limit = PLAN_CONFIG.free.maxClients;
  const remaining = Math.max(0, limit - currentClientsCount);
  const allowed = currentClientsCount < limit;

  return {
    allowed,
    limit,
    current: currentClientsCount,
    remaining,
    message: allowed
      ? undefined
      : `Vous avez atteint la limite de ${limit} clients du plan Gratuit. Passez à CouturPro pour ajouter des clients en illimité.`,
  };
}

/** Vérifie si l'atelier peut enregistrer une nouvelle commande pour le mois en cours */
export function checkOrderQuota(
  business: Business | null | undefined,
  currentMonthlyOrdersCount: number,
): {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string | undefined;
} {
  if (isProOrAdmin(business)) {
    return {
      allowed: true,
      limit: Infinity,
      current: currentMonthlyOrdersCount,
      remaining: Infinity,
    };
  }

  const limit = PLAN_CONFIG.free.maxMonthlyOrders;
  const remaining = Math.max(0, limit - currentMonthlyOrdersCount);
  const allowed = currentMonthlyOrdersCount < limit;

  return {
    allowed,
    limit,
    current: currentMonthlyOrdersCount,
    remaining,
    message: allowed
      ? undefined
      : `Vous avez atteint la limite de ${limit} commandes ce mois-ci sur le plan Gratuit. Passez à CouturPro pour enregistrer vos commandes sans limite.`,
  };
}

/** Vérifie si l'atelier peut enregistrer un nouveau modèle au catalogue selon son quota */
export function checkCatalogQuota(
  business: Business | null | undefined,
  currentCatalogCount: number,
): {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string | undefined;
} {
  if (isProOrAdmin(business)) {
    return {
      allowed: true,
      limit: Infinity,
      current: currentCatalogCount,
      remaining: Infinity,
    };
  }

  const limit = PLAN_CONFIG.free.maxCatalogModels;
  const remaining = Math.max(0, limit - currentCatalogCount);
  const allowed = currentCatalogCount < limit;

  return {
    allowed,
    limit,
    current: currentCatalogCount,
    remaining,
    message: allowed
      ? undefined
      : `Vous avez atteint la limite de ${limit} modèles du plan Gratuit. Passez à CouturPro pour enrichir votre catalogue sans aucune restriction.`,
  };
}
