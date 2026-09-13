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
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("actives");
  const [term, setTerm] = useState("");
  const orders = useQuery({ queryKey: ["orders", {}], queryFn: () => fetchOrders() });

  const list = useMemo(() => {
    const all = orders.data ?? [];
    const byFilter = all.filter((o) => {
      if (filter === "actives") return isActive(o.status);
      if (filter === "retard") return isLate(o);
      if (filter === "prete") return o.status === "prete";
      if (filter === "livree") return o.status === "livree";
      return true;
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
          <Button asChild>
            <Link to="/commandes/nouvelle">
              <Plus className="size-4" /> Nouvelle commande
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
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                filter === f.value
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => (
          <span key={s} className="rounded-full bg-surface px-2.5 py-1 text-muted-foreground">
            {ORDER_STATUS[s].label} · {counts[s] ?? 0}
          </span>
        ))}
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
            <OrderCard key={o.id} order={o} showClient />
          ))}
        </div>
      )}
    </div>
  );
}
