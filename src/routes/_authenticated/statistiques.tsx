import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { BarChart3, Receipt, Crown, Lock, Sparkles, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { isProOrAdmin, isSubscriptionExpired, getPlanWhatsAppUrl } from "@/lib/quotas";

import { useBusiness } from "@/hooks/use-business";
import { fetchClients, fetchOrders, paidTotal, balance, type OrderRow } from "@/lib/queries";
import { ORDER_STATUS, isActive, isLate, type OrderStatus } from "@/lib/domain";
import { fcfa } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle, StatCard } from "@/components/bits";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ExpensesManagement } from "@/components/expenses-management";

export const Route = createFileRoute("/_authenticated/statistiques")({
  head: () => ({
    meta: [
      { title: "Statistiques & Finances — CouturPro" },
      {
        name: "description",
        content:
          "Chiffre d'affaires, comptabilité d'atelier, gestion des charges, bénéfice net et commandes livrées mois par mois.",
      },
      { property: "og:title", content: "Statistiques & Finances — CouturPro" },
      { property: "og:description", content: "Les chiffres clés et la comptabilité de votre atelier de couture." },
    ],
  }),
  component: StatsPage,
});

function monthKey(d: string) {
  return d.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function StatsPage() {
  const { data: business } = useBusiness();
  const currency = business?.currency ?? "FCFA";
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => fetchOrders(),
    enabled: true,
  });
  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: () => fetchClients(),
    enabled: true,
  });
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const isPro = isProOrAdmin(business);
  const isExpired = isSubscriptionExpired(business);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<"ventes" | "charges">(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "charges" || params.get("view") === "compta") {
        return "charges";
      }
    }
    return "ventes";
  });

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders.data ?? []) set.add(monthKey(o.ordered_at));
    set.add(new Date().toISOString().slice(0, 7));
    return [...set].sort().reverse();
  }, [orders.data]);

  const stats = useMemo(() => {
    const all: OrderRow[] = orders.data ?? [];
    const inMonth = all.filter((o) => monthKey(o.ordered_at) === month);
    const revenue = inMonth.reduce((s, o) => { const v = Number(o.price); return s + (isNaN(v) ? 0 : v); }, 0);
    const collected = inMonth.reduce((s, o) => s + paidTotal(o), 0);
    const unpaid = all.reduce((s, o) => s + Math.max(0, balance(o)), 0);
    const delivered = inMonth.filter((o) => o.status === "livree").length;
    const late = all.filter(isLate).length;
    const active = all.filter((o) => isActive(o.status)).length;

    const byGarment = new Map<string, number>();
    for (const o of inMonth) byGarment.set(o.garment_type, (byGarment.get(o.garment_type) ?? 0) + 1);
    const topGarments = [...byGarment.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    const byStatus = {} as Record<OrderStatus, number>;
    for (const o of all) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

    const byClient = new Map<string, number>();
    for (const o of all) {
      const name = o.clients ? `${o.clients.first_name} ${o.clients.last_name}`.trim() : "—";
      byClient.set(name, (byClient.get(name) ?? 0) + (isNaN(Number(o.price)) ? 0 : Number(o.price)));
    }
    const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      count: inMonth.length,
      revenue,
      collected,
      unpaid,
      delivered,
      late,
      active,
      topGarments,
      byStatus,
      topClients,
      average: inMonth.length ? revenue / inMonth.length : 0,
    };
  }, [orders.data, month]);

  // Évolution mensuelle (derniers 6 mois)
  const monthlyEvolution = useMemo(() => {
    const all = orders.data ?? [];
    const sortedChronological = [...months].sort().slice(-6);
    return sortedChronological.map((m) => {
      const inM = all.filter((o) => monthKey(o.ordered_at) === m);
      const rev = inM.reduce((s, o) => { const v = Number(o.price); return s + (isNaN(v) ? 0 : v); }, 0);
      const col = inM.reduce((s, o) => s + paidTotal(o), 0);
      const [y, mm] = m.split("-");
      const d = new Date(Number(y), Number(mm) - 1, 1);
      const shortName = d.toLocaleDateString("fr-FR", { month: "short" });
      return {
        mois: shortName,
        nomComplet: monthLabel(m),
        "Chiffre d'affaires": rev,
        Encaissé: col,
      };
    });
  }, [orders.data, months]);

  if (orders.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  const maxGarment = stats.topGarments[0]?.[1] ?? 1;

  return (
    <div className="space-y-6">
      <SectionTitle
        action={
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Mois"
            className="h-11 rounded-xl border border-input bg-card px-3 text-base sm:text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring cursor-pointer shadow-2xs"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        }
      >
        Statistiques & Finances
      </SectionTitle>


      {/* Verrouillage Anti-Fraude Mode Découverte : Réservé aux Abonnés Pro */}
      {!isPro && !isExpired && (
        <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-amber-500/5 p-6 sm:p-8 text-center shadow-lg relative overflow-hidden">
          <div className="mx-auto size-14 rounded-2xl bg-primary/20 text-primary flex items-center justify-center mb-4 ring-8 ring-primary/5">
            <Lock className="size-7" />
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-1 text-xs font-bold mb-3">
            <Crown className="size-3.5" /> FONCTIONNALITÉ PRO EXCLUSIVE
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-foreground max-w-lg mx-auto">
            Débloquez la Comptabilité & les Statistiques Financières de votre Atelier
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
            En formule Découverte, le module d'analyses financières et de gestion des charges est désactivé. Passez au Pass Pro pour suivre votre chiffre d'affaires en direct, vos encaissements réels, vos charges fixes et votre bénéfice net.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 max-w-xl mx-auto text-left text-xs">
            <div className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-card p-3 shadow-2xs">
              <span className="size-5 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 font-bold">✓</span>
              <div>
                <p className="font-bold text-foreground">Bénéfice Net Automatique</p>
                <p className="text-muted-foreground text-[11px]">Calcul immédiat : Recettes encaissées - Charges payées.</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-card p-3 shadow-2xs">
              <span className="size-5 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 font-bold">✓</span>
              <div>
                <p className="font-bold text-foreground">Gestion des Salaires & Loyer</p>
                <p className="text-muted-foreground text-[11px]">Enregistrez chaque dépense par catégorie avec justificatifs.</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-card p-3 shadow-2xs">
              <span className="size-5 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 font-bold">✓</span>
              <div>
                <p className="font-bold text-foreground">Évolution sur 6 Mois</p>
                <p className="text-muted-foreground text-[11px]">Graphiques comparatifs d'activité et saisonnalité.</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-card p-3 shadow-2xs">
              <span className="size-5 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 font-bold">✓</span>
              <div>
                <p className="font-bold text-foreground">Top Vêtements & Clients VIP</p>
                <p className="text-muted-foreground text-[11px]">Identifiez vos modèles les plus demandés et rentables.</p>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              onClick={() => setUpgradeOpen(true)}
              className="rounded-2xl font-bold shadow-md h-12 px-6 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Crown className="mr-2 size-5" /> Activer mon Pass Pro (dès 3 000 F)
            </Button>
            <a
              href={getPlanWhatsAppUrl("monthly", business?.name, business?.phone || undefined)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 px-5 h-12 text-sm font-bold text-white shadow-xs transition-all active:scale-95"
            >
              <MessageCircle className="size-4.5" /> Souscrire par WhatsApp
            </a>
          </div>
        </div>
      )}

      {(isPro || isExpired) && (
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "ventes" | "charges")}
        className="w-full"
      >
        <TabsList className="grid grid-cols-2 w-full max-w-md h-11 p-1 bg-muted/70 rounded-xl">
          <TabsTrigger
            value="ventes"
            className="gap-2 text-xs sm:text-sm font-semibold rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-xs"
          >
            <BarChart3 className="size-4" />
            <span>Activité & Ventes</span>
          </TabsTrigger>
          <TabsTrigger
            value="charges"
            className="gap-2 text-xs sm:text-sm font-semibold rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-xs"
          >
            <Receipt className="size-4" />
            <span>Comptabilité & Charges</span>
          </TabsTrigger>
        </TabsList>

        {/* ONGLET 1 : ACTIVITÉ & COMMANDES (100% CONSERVÉ SANS MODIFICATION DE STRUCTURE) */}
        <TabsContent value="ventes" className="space-y-6 mt-6">
          {/* KPI Cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Commandes du mois" value={String(stats.count)} />
            <StatCard label="Chiffre d'affaires du mois" value={fcfa(stats.revenue, currency)} />
            <StatCard label="Encaissé ce mois" value={fcfa(stats.collected, currency)} />
            <StatCard label="Impayés (toutes commandes)" value={fcfa(stats.unpaid, currency)} />
            <StatCard label="Livrées ce mois" value={String(stats.delivered)} />
            <StatCard label="Commandes en cours" value={String(stats.active)} />
            <StatCard label="En retard" value={String(stats.late)} />
            <StatCard label="Panier moyen" value={fcfa(stats.average, currency)} />
          </div>

          {/* Graphique d'évolution mensuelle */}
          <section className="card-soft p-5">
            <h2 className="font-display text-sm font-bold">
              Évolution du chiffre d'affaires et des encaissements
            </h2>
            <p className="text-xs text-muted-foreground">Historique des 6 derniers mois d'activité.</p>

            <div className="mt-4 h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyEvolution} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="mois" fontSize={12} />
                  <YAxis
                    fontSize={11}
                    tickFormatter={(val) => `${Math.round(val / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(val) => [fcfa(Number(val ?? 0), currency), ""]}
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      borderColor: "var(--border)",
                      borderRadius: "0.75rem",
                      fontSize: "0.75rem",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "0.5rem" }} />
                  <Bar dataKey="Chiffre d'affaires" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Encaissé" fill="var(--success)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card-soft p-5">
              <h2 className="font-display text-sm font-bold">Vêtements les plus demandés</h2>
              {stats.topGarments.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Aucune commande sur ce mois.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {stats.topGarments.map(([name, count]) => (
                    <li key={name}>
                      <div className="flex items-center justify-between text-sm">
                        <span>{name}</span>
                        <span className="font-semibold">{count}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.round((count / maxGarment) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card-soft p-5">
              <h2 className="font-display text-sm font-bold">Répartition par statut</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => (
                  <li key={s} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${ORDER_STATUS[s].dot}`} />
                      {ORDER_STATUS[s].label}
                    </span>
                    <span className="font-semibold">{stats.byStatus[s] ?? 0}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card-soft p-5">
              <h2 className="font-display text-sm font-bold">Meilleurs clients</h2>
              {stats.topClients.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Pas encore de données.</p>
              ) : (
                <ul className="mt-4 space-y-2 text-sm">
                  {stats.topClients.map(([name, total]) => (
                    <li key={name} className="flex items-center justify-between">
                      <span className="truncate">{name}</span>
                      <span className="font-semibold">{fcfa(total, currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card-soft p-5">
              <h2 className="font-display text-sm font-bold">Clientèle</h2>
              <p className="mt-4 text-3xl font-bold">{(clients.data ?? []).length}</p>
              <p className="text-sm text-muted-foreground">clients enregistrés dans votre atelier</p>
            </section>
          </div>
        </TabsContent>

        {/* ONGLET 2 : COMPTABILITÉ & CHARGES (GESTION DES SALAIRES, CHARGES & BÉNÉFICE NET) */}
        <TabsContent value="charges" className="mt-6">
          <ExpensesManagement
            orders={orders.data ?? []}
            month={month}
            currency={currency}
            monthLabel={monthLabel(month)}
          />
        </TabsContent>
      </Tabs>
      )}

      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} triggerReason="Débloquez la comptabilité d'atelier, le calcul du bénéfice net et le suivi de chiffre d'affaires dès 3 000 FCFA/mois." />
    </div>
  );
}
