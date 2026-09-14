import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

import { fetchOrders } from "@/lib/queries";
import { ORDER_STATUS, isLate, isActive, type OrderStatus } from "@/lib/domain";
import { fullName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, OrderCard, SectionTitle } from "@/components/bits";

const FILTERS = [
  { value: "actives", label: "En cours" },
  { value: "retard", label: "En retard" },
  { value: "prete", label: "Prêtes" },
  { value: "livree", label: "Livrées" },
  { value: "toutes", label: "Toutes" },
] as const;

export const Route = createFileRoute("/_authenticated/commandes/")({
  head: () => ({
    meta: [
      { title: "Commandes — CouturPro" },
      {
        name: "description",
        content:
          "Suivez toutes vos commandes de couture : statut, délai, retards et paiements en un coup d'œil.",
      },
      { property: "og:title", content: "Commandes — CouturPro" },
      { property: "og:description", content: "Suivi des commandes de votre atelier de couture." },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const [filter, setFilter] = useState<string>("actives");
  const [term, setTerm] = useState("");
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => fetchOrders() });

  const list = useMemo(() => {
    const all = orders.data ?? [];
    const byFilter = all.filter((o) => {
      if (filter === "actives") return isActive(o.status);
      if (filter === "retard") return isLate(o);
      if (filter === "prete") return o.status === "prete";
      if (filter === "livree") return o.status === "livree";
      if (filter === "toutes") return true;
      return o.status === filter;
    });
    const q = term.trim().toLowerCase();
    if (!q) return byFilter;
    return byFilter.filter(
      (o) =>
        o.reference.toLowerCase().includes(q) ||
        o.garment_type.toLowerCase().includes(q) ||
        fullName(o.clients).toLowerCase().includes(q),
    );
  }, [orders.data, filter, term]);

  const counts = useMemo(() => {
    const all = orders.data ?? [];
    const map = {} as Record<OrderStatus, number>;
    for (const o of all) map[o.status] = (map[o.status] ?? 0) + 1;
    return map;
  }, [orders.data]);

  return (
    <div className="space-y-6">
      <SectionTitle
        action={
          <Button asChild className="h-10 text-sm font-bold shadow-xs">
            <Link to="/commandes/nouvelle">
              <Plus className="mr-1 size-4.5" /> Nouvelle commande
            </Link>
          </Button>
        }
      >
        Commandes
      </SectionTitle>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Référence, client ou vêtement…"
            className="pl-9 h-10 text-base sm:text-sm"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all active:scale-95 ${
                filter === f.value
                  ? "border-transparent bg-primary text-primary-foreground shadow-xs"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Puces de filtres par statut interactives */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => {
          const isSelected = filter === s;
          const count = counts[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(isSelected ? "toutes" : s)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                isSelected
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className={`size-2 rounded-full ${isSelected ? "bg-primary-foreground" : ORDER_STATUS[s].dot}`} />
              <span>{ORDER_STATUS[s].label}</span>
              <span className={`rounded-full px-1.5 py-0.2 text-[0.68rem] ${isSelected ? "bg-primary-foreground/25" : "bg-muted"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {orders.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title="Aucune commande dans cette vue"
          text="Créez une commande pour un client existant et suivez-la jusqu'à la livraison."
          action={
            <Button asChild>
              <Link to="/commandes/nouvelle">Nouvelle commande</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}
