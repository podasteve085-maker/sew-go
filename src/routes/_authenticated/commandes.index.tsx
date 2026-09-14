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

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Rechercher référence, client ou habit…"
            className="pl-9 h-9 text-xs sm:text-sm"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {[
            { value: "actives", label: "En cours", count: (orders.data ?? []).filter(o => isActive(o.status)).length },
            { value: "retard", label: "En retard", count: (orders.data ?? []).filter(isLate).length },
            { value: "prete", label: "Prêtes", count: counts["prete"] ?? 0 },
            { value: "livree", label: "Livrées", count: counts["livree"] ?? 0 },
            { value: "toutes", label: "Toutes", count: (orders.data ?? []).length },
          ].map((f) => {
            const isSelected = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "border border-border/70 bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>{f.label}</span>
                <span className={`rounded-full px-1.5 py-0.2 text-[0.65rem] ${isSelected ? "bg-primary-foreground/25 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>
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
