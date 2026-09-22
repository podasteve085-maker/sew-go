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
  CloudCheck,
  Calendar,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { PLAN_CONFIG, isProOrAdmin } from "@/lib/quotas";
import { dateFr, fcfa } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle } from "@/components/bits";
import { UpgradeDialog } from "@/components/upgrade-dialog";

// Type pour les transactions de paiement d'abonnement
type PaymentTransaction = {
  id: string;
  business_id: string;
  plan: string;
  provider: string;
  customer_phone: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/abonnement")({
  head: () => ({
    meta: [
      { title: "Mon Abonnement & Quotas — CouturPro" },
      {
        name: "description",
        content: "Gérez votre abonnement CouturPro, suivez vos quotas et découvrez nos formules Pro.",
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

  // 2. Quota commandes du mois
  const ordersMonthlyQuery = useQuery({
    queryKey: ["orders-monthly-count", business?.id],
    enabled: Boolean(business?.id),
    queryFn: async () => {
      const currentMonthStart = new Date().toISOString().slice(0, 7) + "-01";
      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const { count, error } = await supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("business_id", business!.id)
            .gte("ordered_at", currentMonthStart);
          if (!error && count !== null) return count;
        }
      } catch {
        // Fallback hors-ligne
      }
      const { getAllLocalItems } = await import("@/lib/offline-storage");
      const local = await getAllLocalItems<{ business_id: string; ordered_at: string | null }>("orders");
      return local.filter(
        (o) => o.business_id === business!.id && (o.ordered_at ?? "") >= currentMonthStart,
      ).length;
    },
  });

  // 3. Historique des paiements d'abonnement
  const transactionsQuery = useQuery({
    queryKey: ["my-transactions"],
    queryFn: async () => {
      if (!business?.id) return [] as PaymentTransaction[];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from("payment_transactions")
          .select("*")
          .eq("business_id", business.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data ?? []) as unknown as PaymentTransaction[];
      } catch {
        return [] as PaymentTransaction[];
      }
    },
    enabled: Boolean(business?.id),
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

  const isPro = isProOrAdmin(business);
  const currentPlan = business.plan || "free";
  const planInfo = PLAN_CONFIG[currentPlan] ?? PLAN_CONFIG.free;

  const clientCount = clientsCountQuery.data ?? 0;
  const orderCount = ordersMonthlyQuery.data ?? 0;

  const maxClients = isPro ? Infinity : PLAN_CONFIG.free.maxClients;
  const maxOrders = isPro ? Infinity : PLAN_CONFIG.free.maxMonthlyOrders;

  const clientPercent = isPro ? 0 : Math.min(100, Math.round((clientCount / maxClients) * 100));
  const orderPercent = isPro ? 0 : Math.min(100, Math.round((orderCount / maxOrders) * 100));

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <CreditCard className="size-6 text-primary" /> Mon Abonnement & Quotas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suivez votre consommation en temps réel et activez CouturPro pour votre atelier.
        </p>
      </div>

      {/* Carte Statut Actuel */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Formule Active
            </span>
            <div className="flex items-center gap-2.5">
              <h2 className="font-display text-xl sm:text-2xl font-extrabold text-foreground">
                {planInfo.label}
              </h2>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${planInfo.badge}`}>
                {isPro && <Crown className="size-3" />}
                {business.is_admin ? "ADMIN" : business.plan_status === "active" ? "Actif" : business.plan_status}
              </span>
            </div>
          </div>

          {!isPro ? (
            <Button onClick={() => setUpgradeOpen(true)} className="font-bold shadow-xs">
              <Crown className="mr-1.5 size-4" /> Passer à Pro (dès 2 500 F)
            </Button>
          ) : (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Sparkles className="size-4" /> Toutes les limites sont levées
            </div>
          )}
        </div>

        {/* Détail de l'échéance */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground border-t border-border/70 pt-4">
          <span className="flex items-center gap-1.5">
            <Calendar className="size-4 text-primary" />
            {business.plan_expires_at
              ? `Renouvellement le ${dateFr(business.plan_expires_at)}`
              : isPro
              ? "Abonnement permanent illimité"
              : "Formule d'essai gratuite permanente"}
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-emerald-600" />
            Données protégées et sauvegardées
          </span>
        </div>
      </div>

      {/* Jauges de Quotas en direct */}
      <section className="space-y-3">
        <SectionTitle>Consommation des Quotas</SectionTitle>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Quota Clients */}
          <div className="card-soft p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600">
                  <Users className="size-4" />
                </span>
                <span className="font-semibold text-sm">Clients enregistrés</span>
              </div>
              <span className="font-display font-bold text-sm">
                {isPro ? `${clientCount} clients (Illimité)` : `${clientCount} / ${maxClients}`}
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
                    ? "⚠️ Limite atteinte. Passez à Pro pour continuer à enregistrer vos clients."
                    : `${maxClients - clientCount} client(s) restant(s) avant la limite.`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="size-3.5" /> Aucun plafond de clients
              </p>
            )}
          </div>

          {/* Quota Commandes du mois */}
          <div className="card-soft p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-orange-500/15 text-orange-600">
                  <Scissors className="size-4" />
                </span>
                <span className="font-semibold text-sm">Commandes ce mois</span>
              </div>
              <span className="font-display font-bold text-sm">
                {isPro ? `${orderCount} commandes (Illimité)` : `${orderCount} / ${maxOrders}`}
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
                    ? "⚠️ Limite mensuelle atteinte. Passez à Pro pour enregistrer sans interruption."
                    : `${maxOrders - orderCount} commande(s) restante(s) ce mois.`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="size-3.5" /> Aucun plafond de commandes
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Tableau comparatif des formules */}
      <section className="space-y-3">
        <SectionTitle>Formules & Tarifs</SectionTitle>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Formule Mensuelle */}
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4 flex flex-col justify-between hover:border-primary/40 transition-all">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Pro Mensuel
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  <Zap className="size-3" /> Liberté
                </span>
              </div>

              <div>
                <p className="font-display text-3xl font-extrabold text-foreground">
                  2 500 <span className="text-sm font-semibold">FCFA</span>
                </p>
                <p className="text-xs text-muted-foreground">par mois, sans engagement</p>
              </div>

              <div className="space-y-2 pt-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Clients illimités
                </p>
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Commandes illimitées
                </p>
                <p className="flex items-center gap-2">
                  <Receipt className="size-4 text-primary shrink-0" /> Reçus imprimables & WhatsApp
                </p>
                <p className="flex items-center gap-2">
                  <ImageIcon className="size-4 text-primary shrink-0" /> Photos modèles & tissus illimitées
                </p>
                <p className="flex items-center gap-2">
                  <BarChart2 className="size-4 text-primary shrink-0" /> Statistiques & analyses financières
                </p>
                <p className="flex items-center gap-2">
                  <CloudCheck className="size-4 text-primary shrink-0" /> Sauvegarde Cloud continue
                </p>
              </div>
            </div>

            <Button
              className="w-full font-bold shadow-xs mt-4"
              variant={currentPlan === "pro_monthly" ? "outline" : "default"}
              onClick={() => setUpgradeOpen(true)}
            >
              {currentPlan === "pro_monthly" ? "Prolonger mon mois" : "Choisir le forfait Mensuel"}
            </Button>
          </div>

          {/* Formule Annuelle */}
          <div className="relative rounded-2xl border-2 border-emerald-600 bg-card p-5 sm:p-6 space-y-4 flex flex-col justify-between shadow-sm">
            <span className="absolute -top-3 right-4 rounded-full bg-emerald-600 px-3 py-0.5 text-[11px] font-extrabold text-white shadow-xs">
              2 MOIS OFFERTS
            </span>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Pro Annuel
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                  <Sparkles className="size-3" /> Le plus avantageux
                </span>
              </div>

              <div>
                <p className="font-display text-3xl font-extrabold text-foreground">
                  25 000 <span className="text-sm font-semibold">FCFA</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  au lieu de <span className="line-through">30 000 FCFA</span> / an (soit 2 083 F/mois)
                </p>
              </div>

              <div className="space-y-2 pt-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Tous les avantages Pro inclus
                </p>
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Sparkles className="size-4 text-emerald-600 shrink-0 font-bold" /> Économie immédiate de 5 000 FCFA
                </p>
                <p className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0" /> Sérénité totale pendant 1 an complet
                </p>
                <p className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-600 shrink-0" /> Support prioritaire
                </p>
              </div>
            </div>

            <Button
              className="w-full font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs mt-4"
              onClick={() => setUpgradeOpen(true)}
            >
              {currentPlan === "pro_yearly" ? "Prolonger d'un an" : "Choisir le forfait Annuel (25 000 F)"}
            </Button>
          </div>
        </div>
      </section>

      {/* Historique des paiements d'abonnement */}
      <section className="space-y-3">
        <SectionTitle>Historique de Facturation</SectionTitle>

        <div className="card-soft p-4">
          {(transactionsQuery.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Aucun paiement d'abonnement enregistré pour le moment.
            </p>
          ) : (
            <div className="divide-y divide-border/70 text-xs">
              {(transactionsQuery.data ?? []).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-semibold text-foreground">
                      Abonnement {tx.plan === "pro_yearly" ? "Pro Annuel" : "Pro Mensuel"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {dateFr(tx.created_at)} · {tx.provider} {tx.customer_phone ? `(${tx.customer_phone})` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-foreground">{fcfa(tx.amount, tx.currency)}</span>
                    <span className="block text-[10px] text-emerald-600 font-semibold uppercase">{tx.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Dialogue de paiement */}
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
}
