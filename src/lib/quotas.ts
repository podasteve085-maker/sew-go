import type { Business } from "@/hooks/use-business";

export type SubscriptionPlan = "free" | "monthly" | "quarterly" | "yearly";
export type SubscriptionStatus = "active" | "expired" | "admin";

export interface PlanConfigItem {
  id: SubscriptionPlan;
  name: string;
  tagline: string;
  priceFcfa: number;
  durationDays: number;
  badge: string;
  badgeColor: string;
  popular?: boolean;
  savingsBadge?: string;
  features: string[];
}

export const PLAN_CONFIG: Record<SubscriptionPlan, PlanConfigItem> = {
  free: {
    id: "free",
    name: "Découverte (Gratuit)",
    tagline: "Pour débuter et tester votre atelier digital",
    priceFcfa: 0,
    durationDays: Infinity,
    badge: "Formule Découverte",
    badgeColor: "bg-muted text-muted-foreground border-border",
    features: [
      "Jusqu'à 10 clients enregistrés",
      "Jusqu'à 10 commandes en cours",
      "Jusqu'à 10 fiches de mesures",
      "Reçus standards sans logo",
      "Fonctionnement hors-ligne PWA",
      "Catalogue Lookbook désactivé",
      "Statistiques financières désactivées",
    ],
  },
  monthly: {
    id: "monthly",
    name: "Pro Mensuel (Liberté)",
    tagline: "Sans engagement, flexibilité totale",
    priceFcfa: 2000,
    durationDays: 30,
    badge: "Pro Mensuel",
    badgeColor: "bg-primary/15 text-primary border-primary/30",
    features: [
      "Clients illimités",
      "Commandes illimitées",
      "Fiches de mesures illimitées",
      "Catalogue avec jusqu'à 200 photos de confections",
      "Reçus WhatsApp & impression avec logo de l'atelier",
      "Statistiques & analyses financières détaillées",
      "Sauvegarde Cloud continue et sécurisée",
      "Support d'assistance prioritaire",
    ],
  },
  quarterly: {
    id: "quarterly",
    name: "Pro Trimestriel (Pass Saison)",
    tagline: "Idéal pour les périodes de fêtes & mariages",
    priceFcfa: 5000, // ~1 666 F / mois au lieu de 2 000 F
    durationDays: 90,
    popular: true,
    savingsBadge: "1 000 F d'économie (-17%)",
    badge: "Pro Trimestriel",
    badgeColor: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    features: [
      "3 mois complets (90 jours) de sérénité",
      "Toutes les fonctionnalités Pro débloquées",
      "Catalogue & Lookbook avec photos 100% ILLIMITÉES (à l'infini)",
      "Économie immédiate de 1 000 FCFA",
      "Parfait pour la Tabaski, fêtes de fin d'année et mariages",
      "Sauvegarde Cloud continue de votre carnet d'atelier",
      "Reçus personnalisés pour rassurer vos clients",
    ],
  },
  yearly: {
    id: "yearly",
    name: "Pro Annuel (Maître Couturier)",
    tagline: "Tranquillité absolue pendant 1 an complet",
    priceFcfa: 15000, // 1 250 F / mois au lieu de 2 000 F (9 000 F d'économie)
    durationDays: 365,
    savingsBadge: "4,5 mois offerts (-37%)",
    badge: "Pro Annuel VIP",
    badgeColor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    features: [
      "12 mois complets (365 jours) sans interruption",
      "Meilleur tarif : seulement 1 250 FCFA / mois (9 000 F d'économie)",
      "Toutes les fonctionnalités Pro débloquées",
      "Catalogue avec photos 100% ILLIMITÉES haute définition",
      "Badge numérique « Atelier Certifié CouturPro »",
      "Assistance VIP directe par WhatsApp et téléphone",
    ],
  },
};

export const FREE_LIMITS = {
  maxClients: 10,
  maxOrders: 10,
  maxMeasurements: 10,
} as const;

/**
 * RÈGLE D'OR : Les comptes Administrateurs sont EXONÉRÉS À 100% de toute limitation,
 * de tout paiement, et de toute expiration d'abonnement.
 * 
 * Pour les comptes non-administrateurs, vérifie si l'atelier a un Pass Pro valide et non expiré.
 */
export function isProOrAdmin(business: Business | null | undefined): boolean {
  if (!business) return false;
  
  // 1. Exemption totale pour les administrateurs
  if (business.is_admin === true) {
    return true;
  }

  // 2. Vérification du plan payant
  const plan = business.plan;
  if (!plan || plan === "free") {
    return false;
  }

  // Si le plan est payant, vérifier si la date d'expiration est encore valide
  if (business.plan_expires_at) {
    const expiresTime = new Date(business.plan_expires_at).getTime();
    if (!isNaN(expiresTime)) {
      return expiresTime > Date.now();
    }
  }

  // Si plan payant sans date d'expiration définie (cas exceptionnel), considérer actif
  return true;
}

/**
 * Analyse détaillée de l'état d'abonnement de l'atelier
 */
export function getSubscriptionStatus(business: Business | null | undefined): {
  isPro: boolean;
  isAdmin: boolean;
  planId: SubscriptionPlan;
  status: SubscriptionStatus;
  daysRemaining: number;
  formattedExpiresAt: string | null;
  planLabel: string;
} {
  if (!business) {
    return {
      isPro: false,
      isAdmin: false,
      planId: "free",
      status: "expired",
      daysRemaining: 0,
      formattedExpiresAt: null,
      planLabel: PLAN_CONFIG.free.name,
    };
  }

  if (business.is_admin === true) {
    return {
      isPro: true,
      isAdmin: true,
      planId: "yearly",
      status: "admin",
      daysRemaining: 9999,
      formattedExpiresAt: "Permanent (Exemption Administrateur)",
      planLabel: "Administrateur Plateforme (Illimité)",
    };
  }

  const planId: SubscriptionPlan = business.plan || "free";
  const planConfig = PLAN_CONFIG[planId] ?? PLAN_CONFIG.free;

  if (planId === "free") {
    return {
      isPro: false,
      isAdmin: false,
      planId: "free",
      status: "active",
      daysRemaining: 0,
      formattedExpiresAt: null,
      planLabel: planConfig.name,
    };
  }

  let daysRemaining = 0;
  let isExpired = false;
  let formattedExpiresAt: string | null = null;

  if (business.plan_expires_at) {
    const expDate = new Date(business.plan_expires_at);
    const expTime = expDate.getTime();
    if (!isNaN(expTime)) {
      const diffMs = expTime - Date.now();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      isExpired = diffMs <= 0;
      formattedExpiresAt = expDate.toLocaleDateString("fr-FR");
    }
  }

  return {
    isPro: !isExpired,
    isAdmin: false,
    planId,
    status: isExpired ? "expired" : "active",
    daysRemaining,
    formattedExpiresAt,
    planLabel: planConfig.name,
  };
}

export function isSubscriptionExpired(business: Business | null | undefined): boolean {
  if (!business || business.is_admin === true) return false;
  if (!business.plan || business.plan === "free") return false;
  if (business.plan_expires_at) {
    const time = new Date(business.plan_expires_at).getTime();
    if (!isNaN(time)) {
      return time <= Date.now();
    }
  }
  return false;
}

/**
 * Détermine si l'atelier est en Mode Consultation (Lecture Seule bienveillante).
 * RÈGLE FONDAMENTALE : En mode consultation, l'artisan peut TOUJOURS lire, voir,
 * chercher, imprimer et partager ses données sans aucune interruption.
 * Seules la création et la modification de nouvelles données sont suspendues.
 */
export function getReadOnlyStatus(
  business: Business | null | undefined,
  context?: {
    entity?: "client" | "order" | "measurement" | "catalogue";
    currentCount?: number;
    isEdit?: boolean;
  }
): {
  isReadOnly: boolean;
  message?: string | undefined;
} {
  if (!business || business.is_admin === true) {
    return { isReadOnly: false };
  }

  // 1. Abonnement Pro expiré : Mode Consultation bienveillante
  if (isSubscriptionExpired(business)) {
    return {
      isReadOnly: true,
      message:
        "Votre atelier est actuellement en mode Consultation (lecture seule). Toutes vos mesures, commandes et fiches clients restent sauvegardées et consultables à tout moment. Réactivez votre Pass Atelier (dès 2 000 FCFA) pour créer ou modifier de nouvelles fiches.",
    };
  }

  // 2. Formule Découverte
  if (!business.plan || business.plan === "free") {
    if (context?.entity === "catalogue" && context?.isEdit) {
      return {
        isReadOnly: true,
        message:
          "En formule Découverte, vous pouvez librement consulter et présenter le Lookbook à vos clients. L'ajout et la personnalisation de vos propres modèles est réservé aux ateliers abonnés Pro.",
      };
    }

    if (context?.currentCount !== undefined) {
      const limit = 10;
      if (context.currentCount >= limit) {
        const entityLabel =
          context.entity === "client"
            ? "clients"
            : context.entity === "order"
            ? "commandes"
            : "fiches de mesures";
        return {
          isReadOnly: true,
          message: `Votre atelier a atteint le quota de ${limit} ${entityLabel} de la formule Découverte. Vos données restent intégralement consultables sans restriction. Passez à Pro pour débloquer les ajouts illimités.`,
        };
      }
    }
  }

  return { isReadOnly: false };
}

/**
 * Contrôle rigoureux du quota de clients (Mode Consultation respectueux)
 */
export function checkClientQuota(
  business: Business | null | undefined,
  currentCount: number,
): {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string | undefined;
} {
  if (isProOrAdmin(business)) {
    return { allowed: true, limit: Infinity, current: currentCount, remaining: Infinity };
  }

  if (isSubscriptionExpired(business)) {
    return {
      allowed: false,
      limit: currentCount,
      current: currentCount,
      remaining: 0,
      message:
        "Votre atelier est en mode Consultation : vous pouvez consulter vos clients en toute tranquillité. Pour enregistrer de nouveaux clients, réactivez votre Pass Atelier (dès 2 000 FCFA).",
    };
  }

  const limit = FREE_LIMITS.maxClients;
  const remaining = Math.max(0, limit - currentCount);
  const allowed = currentCount < limit;

  return {
    allowed,
    limit,
    current: currentCount,
    remaining,
    message: allowed
      ? undefined
      : `Vous avez atteint la limite de ${limit} clients de la formule Découverte. Vos clients enregistrés restent toujours consultables. Activez un Pass Pro pour enregistrer en illimité.`,
  };
}

/**
 * Contrôle rigoureux du quota de commandes (Mode Consultation respectueux)
 */
export function checkOrderQuota(
  business: Business | null | undefined,
  currentCount: number,
): {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string | undefined;
} {
  if (isProOrAdmin(business)) {
    return { allowed: true, limit: Infinity, current: currentCount, remaining: Infinity };
  }

  if (isSubscriptionExpired(business)) {
    return {
      allowed: false,
      limit: currentCount,
      current: currentCount,
      remaining: 0,
      message:
        "Votre atelier est en mode Consultation : l'historique de vos confections et acomptes reste accessible. Pour lancer de nouvelles commandes, réactivez votre Pass Atelier (dès 2 000 FCFA).",
    };
  }

  const limit = FREE_LIMITS.maxOrders;
  const remaining = Math.max(0, limit - currentCount);
  const allowed = currentCount < limit;

  return {
    allowed,
    limit,
    current: currentCount,
    remaining,
    message: allowed
      ? undefined
      : `Vous avez atteint le plafond de ${limit} commandes de la formule Découverte. Vos commandes en cours restent parfaitement consultables. Passez à Pro pour continuer sans interruption.`,
  };
}

/**
 * Contrôle rigoureux du quota de fiches de mesures (Mode Consultation respectueux)
 */
export function checkMeasurementQuota(
  business: Business | null | undefined,
  currentCount: number,
): {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string | undefined;
} {
  if (isProOrAdmin(business)) {
    return { allowed: true, limit: Infinity, current: currentCount, remaining: Infinity };
  }

  if (isSubscriptionExpired(business)) {
    return {
      allowed: false,
      limit: currentCount,
      current: currentCount,
      remaining: 0,
      message:
        "Votre carnet de mesures reste 100 % consultable et protégé. Pour enregistrer ou modifier de nouvelles fiches de mesures, réactivez votre forfait (dès 2 000 FCFA).",
    };
  }

  const limit = FREE_LIMITS.maxMeasurements;
  const remaining = Math.max(0, limit - currentCount);
  const allowed = currentCount < limit;

  return {
    allowed,
    limit,
    current: currentCount,
    remaining,
    message: allowed
      ? undefined
      : `Vous avez atteint la limite de ${limit} fiches de mesures de la formule Découverte. Vos mesures enregistrées restent toujours consultables. Passez à Pro pour un carnet illimité.`,
  };
}

export const MONTHLY_CATALOG_PHOTO_LIMIT = 200;

/**
 * Contrôle rigoureux du quota de photos catalogue / lookbook :
 * - Mensuel : 200 photos max tous catalogues et modèles confondus.
 * - Trimestriel & Annuel : Illimité à l'infini (argument décisif d'abonnement).
 * - Administrateurs : Illimité à 100%.
 * - Découverte (Gratuit) : Création de modèles et ajout de photos non autorisés.
 */
export function checkCatalogPhotosQuota(
  business: Business | null | undefined,
  currentCount: number,
  additionalCount: number = 0,
): {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  isUnlimited: boolean;
  message?: string | undefined;
} {
  // 1. Exemption totale pour les comptes Administrateur
  if (business?.is_admin === true) {
    return {
      allowed: true,
      limit: Infinity,
      current: currentCount,
      remaining: Infinity,
      isUnlimited: true,
    };
  }

  // 2. Mode Consultation / Abonnement expiré
  if (isSubscriptionExpired(business)) {
    return {
      allowed: false,
      limit: currentCount,
      current: currentCount,
      remaining: 0,
      isUnlimited: false,
      message:
        "Votre atelier est en mode Consultation : vos modèles et photos restent consultables. Réactivez votre Pass Atelier pour ajouter de nouvelles confections.",
    };
  }

  // 3. Formule Découverte (Gratuit) : L'ajout de modèles personnels est réservé aux abonnés Pro
  const plan = business?.plan || "free";
  if (plan === "free") {
    return {
      allowed: false,
      limit: 0,
      current: currentCount,
      remaining: 0,
      isUnlimited: false,
      message:
        "L'ajout et la personnalisation de vos propres modèles de catalogue est réservé aux ateliers abonnés Pro.",
    };
  }

  // 4. Formules Trimestrielle et Annuelle : Photos illimitées à l'infini !
  if (
    plan === "quarterly" ||
    plan === "yearly" ||
    plan === "unlimited" ||
    plan === "pro_yearly"
  ) {
    return {
      allowed: true,
      limit: Infinity,
      current: currentCount,
      remaining: Infinity,
      isUnlimited: true,
    };
  }

  // 5. Formule Mensuelle : Plafond strict de 200 photos tous catalogues confondus
  const limit = MONTHLY_CATALOG_PHOTO_LIMIT;
  const remaining = Math.max(0, limit - currentCount);
  const targetCount = currentCount + additionalCount;
  const allowed = targetCount <= limit;

  return {
    allowed,
    limit,
    current: currentCount,
    remaining,
    isUnlimited: false,
    message: allowed
      ? undefined
      : `Plafond de ${limit} photos de catalogue atteint pour la formule Pro Mensuel (${currentCount} photos insérées). Passez au Pass Trimestriel ou Annuel pour débloquer les photos illimitées à l'infini !`,
  };
}

