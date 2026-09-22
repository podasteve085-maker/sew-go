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

import { useBusiness } from "@/hooks/use-business";
import { fetchClients, fetchOrders, paidTotal, balance, type OrderRow } from "@/lib/queries";
import { ORDER_STATUS, isActive, isLate, type OrderStatus } from "@/lib/domain";
import { fcfa } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle, StatCard } from "@/components/bits";

export const Route = createFileRoute("/_authenticated/statistiques")({
  head: () => ({
    meta: [
      { title: "Statistiques — CouturPro" },
      {
        name: "description",
        content:
          "Chiffre d'affaires, commandes livrées, impayés et vêtements les plus demandés, mois par mois.",
      },
      { property: "og:title", content: "Statistiques — CouturPro" },
      { property: "og:description", content: "Les chiffres clés de votre atelier de couture." },
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

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders.data ?? []) set.add(monthKey(o.ordered_at));
    set.add(new Date().toISOString().slice(0, 7));
    return [...set].sort().reverse();
  }, [orders.data]);

  const stats = useMemo(() => {
    const all: OrderRow[] = orders.data ?? [];
    const inMonth = all.filter((o) => monthKey(o.ordered_at) === month);
    const revenue = inMonth.reduce((s, o) => s + Number(o.price), 0);
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
      byClient.set(name, (byClient.get(name) ?? 0) + Number(o.price));
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
      const rev = inM.reduce((s, o) => s + Number(o.price), 0);
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
            className="h-9 rounded-md border border-input bg-card px-3 text-sm"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        }
      >
        Statistiques
      </SectionTitle>

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

        <div className="mt-4 h-64 w-full">
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
    </div>
  );
}
