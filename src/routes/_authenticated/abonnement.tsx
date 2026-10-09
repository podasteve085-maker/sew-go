import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Crown,
  Check,
  Zap,
  Sparkles,
  ShieldCheck,
  CreditCard,
  Users,
  Scissors,
  Receipt,
  Image as ImageIcon,
  BarChart2,
  Calendar,
  Lock,
  Flame,
  Ruler,
  AlertTriangle,
  Eye,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import {
  PLAN_CONFIG,
  FREE_LIMITS,
  isProOrAdmin,
  getSubscriptionStatus,
} from "@/lib/quotas";
import { fcfa } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle } from "@/components/bits";
import { UpgradeDialog } from "@/components/upgrade-dialog";

export const Route = createFileRoute("/_authenticated/abonnement")({
  head: () => ({
    meta: [
      { title: "Mon Abonnement & Quotas — CouturPro" },
      {
        name: "description",
        content: "Gérez votre forfait CouturPro, suivez vos quotas d'atelier et activez les fonctionnalités Pro.",
      },
    ],
  }),
  component: SubscriptionPage,
});

function SubscriptionPage() {
  const { data: business, isLoading } = useBusiness();
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // 1. Quota clients actuels
  const clientsCountQuery = useQuery({
    queryKey: ["clients-count", business?.id],
    enabled: Boolean(business?.id),
    queryFn: async () => {
      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const { count, error } = await supabase
            .from("clients")
            .select("id", { count: "exact", head: true })
            .eq("business_id", business!.id);
          if (!error && count !== null) return count;
        }
      } catch {
        // Fallback hors-ligne
      }
      const { getAllLocalItems } = await import("@/lib/offline-storage");
      const local = await getAllLocalItems<{ business_id: string }>("clients");
      return local.filter((c) => c.business_id === business!.id).length;
    },
  });

  // 2. Quota commandes actuelles
  const ordersCountQuery = useQuery({
    queryKey: ["orders-count", business?.id],
    enabled: Boolean(business?.id),
    queryFn: async () => {
      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const { count, error } = await supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("business_id", business!.id);
          if (!error && count !== null) return count;
        }
      } catch {
        // Fallback hors-ligne
      }
      const { getAllLocalItems } = await import("@/lib/offline-storage");
      const local = await getAllLocalItems<{ business_id: string }>("orders");
      return local.filter((o) => o.business_id === business!.id).length;
    },
  });

  // 3. Quota mesures actuelles
  const measurementsCountQuery = useQuery({
    queryKey: ["measurements-count", business?.id],
    enabled: Boolean(business?.id),
    queryFn: async () => {
      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const { count, error } = await supabase
            .from("measurement_sets")
            .select("id", { count: "exact", head: true })
            .eq("business_id", business!.id);
          if (!error && count !== null) return count;
        }
      } catch {
        // Fallback hors-ligne
      }
      const { getAllLocalItems } = await import("@/lib/offline-storage");
      const local = await getAllLocalItems<{ business_id: string }>("measurements");
      return local.filter((m) => m.business_id === business!.id).length;
    },
  });

  if (isLoading || !business) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const subInfo = getSubscriptionStatus(business);
  const isPro = isProOrAdmin(business);
  const isAdmin = business.is_admin === true;

  const clientCount = clientsCountQuery.data ?? 0;
  const orderCount = ordersCountQuery.data ?? 0;
  const measurementCount = measurementsCountQuery.data ?? 0;

  const maxClients = isPro ? Infinity : FREE_LIMITS.maxClients;
  const maxOrders = isPro ? Infinity : FREE_LIMITS.maxOrders;
  const maxMeasurements = isPro ? Infinity : FREE_LIMITS.maxMeasurements;

  const clientPercent = isPro ? 0 : Math.min(100, Math.round((clientCount / maxClients) * 100));
  const orderPercent = isPro ? 0 : Math.min(100, Math.round((orderCount / maxOrders) * 100));
  const measurePercent = isPro ? 0 : Math.min(100, Math.round((measurementCount / maxMeasurements) * 100));

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <CreditCard className="size-6 text-primary" /> Mon Forfait & Quotas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suivez la consommation de votre atelier et passez au niveau supérieur avec CouturPro.
        </p>
      </div>

      {/* Bannière spéciale pour les comptes Administrateur */}
      {isAdmin && (
        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-5 shadow-xs flex items-center gap-3.5 text-purple-900 dark:text-purple-200">
          <div className="size-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0">
            <Crown className="size-5" />
          </div>
          <div>
            <p className="font-bold text-sm">Compte Administrateur Plateforme — Exemption Totale</p>
            <p className="text-xs text-purple-800/80 dark:text-purple-300/80">
              Cet atelier bénéficie d'une exemption permanente. Toutes les fonctionnalités (Lookbook, Clients, Commandes, Mesures) sont débloquées en illimité et sans aucune date d'expiration.
            </p>
          </div>
        </div>
      )}

      {/* Carte Statut Actuel */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Formule Actuelle de votre Atelier
            </span>
            <div className="flex items-center gap-2.5">
              <h2 className="font-display text-xl sm:text-2xl font-extrabold text-foreground">
                {subInfo.planLabel}
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                  isAdmin
                    ? "bg-purple-600/20 text-purple-700 dark:text-purple-300 border-purple-500/30"
                    : isPro
                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                    : subInfo.status === "expired"
                    ? "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {isAdmin ? (
                  <>
                    <Crown className="size-3" /> EXONÉRÉ (ADMIN)
                  </>
                ) : isPro ? (
                  <>
                    <Sparkles className="size-3" /> ACTIF PRO
                  </>
                ) : subInfo.status === "expired" ? (
                  <>
                    <Eye className="size-3" /> MODE CONSULTATION
                  </>
                ) : (
                  <>DÉCOUVERTE (LIMITÉ)</>
                )}
              </span>
            </div>
          </div>

          {!isPro && (
            <Button onClick={() => setUpgradeOpen(true)} className="font-bold shadow-xs">
              <Crown className="mr-1.5 size-4" /> {subInfo.status === "expired" ? "Réactiver mon Pass (dès 2 000 F)" : "Passer à Pro (dès 2 000 F)"}
            </Button>
          )}

          {isPro && !isAdmin && (
            <Button
              variant="outline"
              onClick={() => setUpgradeOpen(true)}
              className="font-semibold text-xs border-primary/30 text-primary hover:bg-primary/10"
            >
              <Zap className="mr-1.5 size-3.5" /> Prolonger mon Pass
            </Button>
          )}
        </div>

        {/* Détail de l'échéance / Jours restants */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground border-t border-border/70 pt-4">
          <span className="flex items-center gap-1.5 font-medium">
            <Calendar className="size-4 text-primary" />
            {isAdmin ? (
              <span className="text-purple-700 dark:text-purple-300 font-bold">
                Accès permanent illimité
              </span>
            ) : isPro ? (
              <>
                Expire le {subInfo.formattedExpiresAt} (
                <strong className="text-foreground">{subInfo.daysRemaining} jour(s) restant(s)</strong>)
              </>
            ) : subInfo.status === "expired" ? (
              <span className="text-amber-800 dark:text-amber-300 font-semibold flex items-center gap-1">
                <Eye className="size-3.5" /> Pass échu ({subInfo.formattedExpiresAt}) — Mode Consultation bienveillant actif
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1">
                <AlertTriangle className="size-3.5" /> Formule Découverte limitée à 10 entrées
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-emerald-600" />
            Toutes vos données restent 100 % sauvegardées et consultables
          </span>
        </div>
      </div>

      {/* Carte d'explication du Mode Consultation bienveillant quand expiré */}
      {subInfo.status === "expired" && !isPro && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="size-10 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0">
              <Eye className="size-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">Mode Consultation Bienveillant Actif</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Votre atelier est en mode lecture seule : <strong>aucune donnée n'est perdue ni bloquée</strong>. Vous pouvez consulter vos clients, relire vos mesures, vérifier vos acomptes et imprimer vos reçus.
                Pour lancer de nouvelles confections ou modifier des fiches, il vous suffit de réactiver votre Pass.
              </p>
            </div>
          </div>
          <Button
            onClick={() => setUpgradeOpen(true)}
            className="font-bold shrink-0 shadow-xs h-9 text-xs sm:text-sm bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Crown className="mr-1.5 size-4" /> Réactiver mon Pass
          </Button>
        </div>
      )}

      {/* Jauges de Quotas en direct */}
      <section className="space-y-3">
        <SectionTitle>Consommation des Quotas de l'Atelier</SectionTitle>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* 1. Quota Clients */}
          <div className="card-soft p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600">
                  <Users className="size-4" />
                </span>
                <span className="font-semibold text-xs sm:text-sm">Clients</span>
              </div>
              <span className="font-display font-bold text-xs sm:text-sm">
                {isPro ? `${clientCount} (Illimité)` : `${clientCount} / ${maxClients}`}
              </span>
            </div>

            {!isPro ? (
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all duration-500 ${
                      clientPercent >= 100
                        ? "bg-destructive"
                        : clientPercent >= 80
                        ? "bg-amber-500"
                        : "bg-primary"
                    }`}
                    style={{ width: `${clientPercent}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {clientCount >= maxClients
                    ? "⚠️ Limite de 10 clients atteinte."
                    : `${maxClients - clientCount} place(s) restante(s).`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="size-3.5" /> Aucun plafond de clients
              </p>
            )}
          </div>

          {/* 2. Quota Commandes */}
          <div className="card-soft p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-orange-500/15 text-orange-600">
                  <Scissors className="size-4" />
                </span>
                <span className="font-semibold text-xs sm:text-sm">Commandes</span>
              </div>
              <span className="font-display font-bold text-xs sm:text-sm">
                {isPro ? `${orderCount} (Illimité)` : `${orderCount} / ${maxOrders}`}
              </span>
            </div>

            {!isPro ? (
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all duration-500 ${
                      orderPercent >= 100
                        ? "bg-destructive"
                        : orderPercent >= 80
                        ? "bg-amber-500"
                        : "bg-primary"
                    }`}
                    style={{ width: `${orderPercent}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {orderCount >= maxOrders
                    ? "⚠️ Limite de 10 commandes atteinte."
                    : `${maxOrders - orderCount} commande(s) restante(s).`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="size-3.5" /> Aucune limite de commandes
              </p>
            )}
          </div>

          {/* 3. Quota Fiches de Mesures */}
          <div className="card-soft p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-purple-500/15 text-purple-600">
                  <Ruler className="size-4" />
                </span>
                <span className="font-semibold text-xs sm:text-sm">Fiches Mesures</span>
              </div>
              <span className="font-display font-bold text-xs sm:text-sm">
                {isPro ? `${measurementCount} (Illimité)` : `${measurementCount} / ${maxMeasurements}`}
              </span>
            </div>

            {!isPro ? (
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all duration-500 ${
                      measurePercent >= 100
                        ? "bg-destructive"
                        : measurePercent >= 80
                        ? "bg-amber-500"
                        : "bg-primary"
                    }`}
                    style={{ width: `${measurePercent}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {measurementCount >= maxMeasurements
                    ? "⚠️ Limite de 10 fiches atteinte."
                    : `${maxMeasurements - measurementCount} fiche(s) restante(s).`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="size-3.5" /> Mesures illimitées
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Grille des 3 Formules Pro */}
      <section className="space-y-3">
        <SectionTitle>Choisissez votre Pass Pro d'Atelier</SectionTitle>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Formule Mensuelle */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4 flex flex-col justify-between hover:border-primary/40 transition-all">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Pro Mensuel
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  <Zap className="size-3" /> Liberté
                </span>
              </div>

              <div>
                <p className="font-display text-2xl font-extrabold text-foreground">
                  2 000 <span className="text-sm font-semibold">FCFA</span>
                </p>
                <p className="text-xs text-muted-foreground">pour 30 jours, sans engagement</p>
              </div>

              <div className="space-y-2 pt-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Clients & commandes illimités
                </p>
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Catalogue & Lookbook complet
                </p>
                <p className="flex items-center gap-2">
                  <Receipt className="size-4 text-primary shrink-0" /> Reçus imprimables & WhatsApp avec logo
                </p>
                <p className="flex items-center gap-2">
                  <BarChart2 className="size-4 text-primary shrink-0" /> Statistiques financières complètes
                </p>
              </div>
            </div>

            <Button
              className="w-full font-bold shadow-xs mt-4"
              variant={subInfo.planId === "monthly" ? "outline" : "default"}
              onClick={() => setUpgradeOpen(true)}
            >
              {subInfo.planId === "monthly" ? "Prolonger le mois" : "Activer pour 2 000 F"}
            </Button>
          </div>

          {/* Formule Trimestrielle - Spéciale Saison */}
          <div className="relative rounded-2xl border-2 border-amber-500 bg-card p-5 space-y-4 flex flex-col justify-between shadow-xs">
            <span className="absolute -top-3 right-4 rounded-full bg-amber-500 px-3 py-0.5 text-[10px] font-extrabold text-white shadow-xs">
              POPULAIRE (-17%)
            </span>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Pass Trimestriel
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                  <Flame className="size-3" /> Saison & Fêtes
                </span>
              </div>

              <div>
                <p className="font-display text-2xl font-extrabold text-foreground">
                  5 000 <span className="text-sm font-semibold">FCFA</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  soit 1 666 F/mois (90 jours complets)
                </p>
              </div>

              <div className="space-y-2 pt-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Tous les avantages Pro inclus
                </p>
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Sparkles className="size-4 text-amber-600 shrink-0 font-bold" /> 1 000 FCFA d'économie immédiate
                </p>
                <p className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0" /> Sérénité pour la Tabaski et fêtes
                </p>
                <p className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0" /> Sauvegarde Cloud continue
                </p>
              </div>
            </div>

            <Button
              className="w-full font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs mt-4"
              onClick={() => setUpgradeOpen(true)}
            >
              {subInfo.planId === "quarterly" ? "Prolonger de 3 mois" : "Choisir le Pass Saison (5 000 F)"}
            </Button>
          </div>

          {/* Formule Annuelle */}
          <div className="relative rounded-2xl border-2 border-emerald-600 bg-card p-5 space-y-4 flex flex-col justify-between shadow-xs">
            <span className="absolute -top-3 right-4 rounded-full bg-emerald-600 px-3 py-0.5 text-[10px] font-extrabold text-white shadow-xs">
              4,5 MOIS OFFERTS
            </span>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Pass Annuel VIP
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                  <Sparkles className="size-3" /> Maître Couturier
                </span>
              </div>

              <div>
                <p className="font-display text-2xl font-extrabold text-foreground">
                  15 000 <span className="text-sm font-semibold">FCFA</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  soit 1 250 F/mois (1 an complet)
                </p>
              </div>

              <div className="space-y-2 pt-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Tous les avantages Pro débloqués
                </p>
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Sparkles className="size-4 text-emerald-600 shrink-0 font-bold" /> 9 000 FCFA d'économie
                </p>
                <p className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0" /> Badge Atelier Certifié CouturPro
                </p>
                <p className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0" /> Assistance prioritaire WhatsApp
                </p>
              </div>
            </div>

            <Button
              className="w-full font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs mt-4"
              onClick={() => setUpgradeOpen(true)}
            >
              {subInfo.planId === "yearly" ? "Prolonger d'un an" : "Pass Annuel (15 000 F)"}
            </Button>
          </div>
        </div>
      </section>

      {/* Tableau comparatif précis Découverte vs Pro */}
      <section className="space-y-3">
        <SectionTitle>Comparatif des Fonctionnalités</SectionTitle>

        <div className="card-soft overflow-hidden p-0 border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="p-3 font-bold">Fonctionnalité d'Atelier</th>
                <th className="p-3 font-bold text-center">Découverte (Gratuit)</th>
                <th className="p-3 font-bold text-center text-primary">Formule Pro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                  <Users className="size-4 text-blue-600" /> Carnet de Clients
                </td>
                <td className="p-3 text-center text-muted-foreground">Limité à 10 clients</td>
                <td className="p-3 text-center font-bold text-emerald-600">Illimité</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                  <Scissors className="size-4 text-orange-600" /> Suivi des Commandes & Statuts
                </td>
                <td className="p-3 text-center text-muted-foreground">Limité à 10 commandes</td>
                <td className="p-3 text-center font-bold text-emerald-600">Illimité</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                  <Ruler className="size-4 text-purple-600" /> Fiches de Mesures Détaillées
                </td>
                <td className="p-3 text-center text-muted-foreground">Limité à 10 fiches</td>
                <td className="p-3 text-center font-bold text-emerald-600">Illimité</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                  <ImageIcon className="size-4 text-indigo-600" /> Catalogue Numérique & Lookbook
                </td>
                <td className="p-3 text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                    <Lock className="size-3" /> Verrouillé
                  </span>
                </td>
                <td className="p-3 text-center font-bold text-emerald-600">Illimité (Photos HD)</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                  <Receipt className="size-4 text-emerald-600" /> Reçus Imprimables & WhatsApp
                </td>
                <td className="p-3 text-center text-muted-foreground">Standard sans logo</td>
                <td className="p-3 text-center font-bold text-emerald-600">Personnalisés avec Logo Atelier</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                  <BarChart2 className="size-4 text-amber-600" /> Bilan Financier & Rentabilité
                </td>
                <td className="p-3 text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                    <Lock className="size-3" /> Verrouillé
                  </span>
                </td>
                <td className="p-3 text-center font-bold text-emerald-600">Complet & Exportable</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                  <ShieldCheck className="size-4 text-sky-600" /> Sauvegarde Cloud Sécurisée
                </td>
                <td className="p-3 text-center text-muted-foreground">Locale uniquement</td>
                <td className="p-3 text-center font-bold text-emerald-600">Automatique & Continue</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Garantie & Réassurance pour l'artisan */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h3 className="font-display font-bold text-sm text-foreground flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-600" /> Vos Données Restent Toujours Votre Propriété
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Même si votre Pass Pro arrive à expiration, <strong>vous ne perdez jamais vos clients ni vos mesures enregistrées</strong>. Vous conservez toujours l'accès à la consultation de votre carnet d'atelier. La recharge s'effectue facilement et instantanément par Orange Money, Moov Money ou Wave sans interruption de service.
        </p>
      </div>

      {/* Dialogue de paiement */}
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
}
