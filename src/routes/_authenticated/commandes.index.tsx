import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Scissors, AlertCircle, Crown, Eye } from "lucide-react";

import { useBusiness } from "@/hooks/use-business";
import { fetchOrders } from "@/lib/queries";
import { ORDER_STATUS, isLate, isActive, type OrderStatus } from "@/lib/domain";
import { fullName } from "@/lib/format";
import { isProOrAdmin, checkOrderQuota, isSubscriptionExpired, FREE_LIMITS } from "@/lib/quotas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, OrderCard, SectionTitle } from "@/components/bits";
import { UpgradeDialog } from "@/components/upgrade-dialog";

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
  const navigate = useNavigate();
  const { data: business } = useBusiness();
  const [filter, setFilter] = useState<string>("actives");
  const [term, setTerm] = useState("");
  const deferredTerm = useDeferredValue(term);

  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => fetchOrders(),
    enabled: true,
  });

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [quotaReason, setQuotaReason] = useState("");
  const isPro = isProOrAdmin(business);
  const isExpired = isSubscriptionExpired(business);
  const totalOrders = (orders.data ?? []).length;
  const orderQuota = checkOrderQuota(business, totalOrders);

  function handleNewOrder() {
    if (isExpired && !isPro) {
      setQuotaReason("Mode Consultation actif. Vos confections restent sécurisées et consultables. Réactivez votre Pass Atelier pour lancer de nouvelles confections.");
      setUpgradeOpen(true);
      return;
    }
    if (!orderQuota.allowed) {
      setQuotaReason(orderQuota.message || "Limite de commandes atteinte pour la formule actuelle.");
      setUpgradeOpen(true);
    } else {
      navigate({ to: "/commandes/nouvelle" });
    }
  }

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
    const q = deferredTerm.trim().toLowerCase();
    if (!q) return byFilter;
    return byFilter.filter(
      (o) =>
        o.reference.toLowerCase().includes(q) ||
        o.garment_type.toLowerCase().includes(q) ||
        fullName(o.clients).toLowerCase().includes(q),
    );
  }, [orders.data, filter, deferredTerm]);

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
          <Button onClick={handleNewOrder} className="h-10 text-sm font-bold shadow-xs">
            {isExpired && !isPro ? (
              <><Eye className="mr-1 size-4.5" /> Mode Consultation</>
            ) : (
              <><Plus className="mr-1 size-4.5" /> Nouvelle commande</>
            )}
          </Button>
        }
      >
        Commandes
      </SectionTitle>

      {/* Bannière Mode Consultation (abonnement expiré) — Reassuring & jamais bloquante sur la lecture */}
      {isExpired && !isPro && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs flex flex-wrap items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <Eye className="size-4.5 shrink-0 text-amber-600" />
            <span className="text-amber-800 dark:text-amber-300">
              <strong>Mode Consultation :</strong> Toutes vos confections, acomptes et reçus restent sauvegardés et accessibles.
              Réactivez votre Pass Atelier pour lancer de nouvelles confections.
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setQuotaReason("Réactivez votre Pass Atelier pour lancer de nouvelles confections et enregistrer de nouveaux paiements.");
              setUpgradeOpen(true);
            }}
            className="h-8 px-3 rounded-lg text-xs font-bold shadow-xs ml-auto"
          >
            <Crown className="mr-1 size-3.5" /> Réactiver mon Pass
          </Button>
        </div>
      )}

      {/* Jauge Quota pour la Formule Découverte */}
      {!isPro && !isExpired && (
        <div
          className={`rounded-2xl border p-3.5 text-xs flex flex-wrap items-center justify-between gap-3 shadow-2xs ${
            !orderQuota.allowed
              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              : totalOrders >= 8
              ? "border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 text-amber-800 dark:text-amber-300"
              : "border-border bg-card text-muted-foreground"
          }`}
        >
          <div className="flex items-center gap-2">
            <Scissors className="size-4 shrink-0 text-primary" />
            <span>
              Formule Découverte :{" "}
              <strong className="text-foreground">
                {totalOrders} / {FREE_LIMITS.maxOrders} commandes
              </strong>
              {!orderQuota.allowed
                ? " — Quota atteint. Vos commandes restent consultables. Passez à Pro pour en ajouter."
                : ` (${orderQuota.remaining} restante${orderQuota.remaining > 1 ? "s" : ""})`}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setQuotaReason("Passez à CouturPro Pro pour enregistrer des commandes en illimité.");
              setUpgradeOpen(true);
            }}
            className="h-8 px-3 rounded-lg text-xs font-bold text-primary border-primary/30 hover:bg-primary/10 ml-auto"
          >
            <Crown className="mr-1 size-3.5" /> Passer à Pro (Illimité)
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Rechercher référence, client ou habit…"
            className="pl-10 h-11 sm:h-12 text-base sm:text-sm rounded-xl bg-card border-border/80 shadow-2xs"
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

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        triggerReason={quotaReason}
      />
    </div>
  );
}
