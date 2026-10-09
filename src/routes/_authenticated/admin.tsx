import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  Search,
  RefreshCw,
  Phone,
  Crown,
  Sparkles,
  Flame,
  Award,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { dateFr } from "@/lib/format";
import { PLAN_CONFIG, type SubscriptionPlan } from "@/lib/quotas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administration Centrale — CouturPro" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

type BusinessRow = {
  id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
  city: string | null;
  plan: SubscriptionPlan;
  plan_status: string;
  plan_expires_at: string | null;
  is_admin: boolean;
  created_at: string;
};

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentBusiness, isLoading: isAuthLoading } = useBusiness();
  const [term, setTerm] = useState("");
  const [filterPlan, setFilterPlan] = useState<string>("all");

  const isAdmin = currentBusiness?.is_admin === true;

  // 1. Liste de tous les ateliers de la plateforme
  const businessesQuery = useQuery({
    queryKey: ["admin", "businesses"],
    queryFn: async (): Promise<BusinessRow[]> => {
      const { data, error } = await (supabase.from("businesses") as any)
        .select("id, name, owner_name, phone, city, plan, plan_status, plan_expires_at, is_admin, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...row,
        plan: (row.plan as SubscriptionPlan) || "free",
        plan_status: row.plan_status || "active",
      })) as BusinessRow[];
    },
    enabled: isAdmin,
  });

  // 2. Statistiques globales
  const statsQuery = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async () => {
      try {
        const { data: rpcStats, error: rpcError } = await (supabase.rpc as any)("get_admin_platform_stats");
        if (!rpcError && rpcStats) {
          const parsed = (typeof rpcStats === "string" ? JSON.parse(rpcStats) : rpcStats) as Record<string, number>;
          return {
            totalClients: (() => { const v = Number(parsed["total_clients"] || 0); return isNaN(v) ? 0 : v; })(),
            totalOrders: (() => { const v = Number(parsed["total_orders"] || 0); return isNaN(v) ? 0 : v; })(),
          };
        }
      } catch {
        // Fallback si la fonction RPC n'est pas disponible
      }

      const [clientsRes, ordersRes] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("orders").select("id", { count: "exact", head: true }),
      ]);

      return {
        totalClients: clientsRes.count ?? 0,
        totalOrders: ordersRes.count ?? 0,
      };
    },
    enabled: isAdmin,
  });

  // 3. Mutation pour mettre à jour les droits ou le forfait d'un atelier
  const updateBusinessMutation = useMutation({
    mutationFn: async ({
      businessId,
      plan,
      isAdmin: newIsAdmin,
    }: {
      businessId: string;
      plan?: SubscriptionPlan;
      isAdmin?: boolean;
    }) => {
      const updates: Record<string, unknown> = {};

      if (plan !== undefined) {
        updates["plan"] = plan;
        updates["plan_status"] = "active";
        const expires = new Date();
        if (plan === "monthly") {
          expires.setDate(expires.getDate() + 30);
          updates["plan_expires_at"] = expires.toISOString();
        } else if (plan === "quarterly") {
          expires.setDate(expires.getDate() + 90);
          updates["plan_expires_at"] = expires.toISOString();
        } else if (plan === "yearly") {
          expires.setDate(expires.getDate() + 365);
          updates["plan_expires_at"] = expires.toISOString();
        } else {
          updates["plan_expires_at"] = null;
        }
      }

      if (newIsAdmin !== undefined) {
        updates["is_admin"] = newIsAdmin;
      }

      const { error } = await (supabase.from("businesses") as any)
        .update(updates)
        .eq("id", businessId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "businesses"] });
      toast.success("Atelier mis à jour avec succès");
    },
    onError: () => {
      toast.error("Erreur lors de la mise à jour de l'atelier");
    },
  });

  useEffect(() => {
    if (!isAuthLoading && currentBusiness && !isAdmin) {
      toast.error("Accès refusé", {
        description: "Cet espace est réservé aux administrateurs de CouturPro.",
      });
      navigate({ to: "/dashboard", replace: true });
    }
  }, [currentBusiness, isAdmin, isAuthLoading, navigate]);

  if (isAuthLoading || !currentBusiness || !isAdmin) {
    return null;
  }

  const businesses = businessesQuery.data ?? [];

  const filteredBusinesses = useMemo(() => {
    return businesses.filter((b) => {
      const matchesSearch =
        b.name.toLowerCase().includes(term.toLowerCase()) ||
        (b.owner_name && b.owner_name.toLowerCase().includes(term.toLowerCase())) ||
        (b.phone && b.phone.includes(term)) ||
        (b.city && b.city.toLowerCase().includes(term.toLowerCase()));

      const matchesPlan = filterPlan === "all" || b.plan === filterPlan;

      return matchesSearch && matchesPlan;
    });
  }, [businesses, term, filterPlan]);

  const proCount = businesses.filter(
    (b) => (b.plan === "monthly" || b.plan === "quarterly" || b.plan === "yearly") && !b.is_admin
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* En-tête administrateur */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-purple-600/15 text-purple-700 dark:text-purple-300">
            <ShieldAlert className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl sm:text-2xl font-bold">Administration Centrale</h1>
              <span className="rounded-md bg-purple-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
                ADMIN
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Supervision des ateliers, gestion des forfaits et des exemptions administrateurs.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            businessesQuery.refetch();
            statsQuery.refetch();
          }}
        >
          <RefreshCw className="mr-1.5 size-3.5" /> Actualiser
        </Button>
      </div>

      {/* KPI Plateforme */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card-soft p-4">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">Ateliers Inscrits</p>
          <p className="mt-1 font-display text-2xl font-bold text-foreground">
            {businessesQuery.isLoading ? "…" : businesses.length}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">ateliers enregistrés</p>
        </div>

        <div className="card-soft p-4">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">Abonnés Pro Actifs</p>
          <p className="mt-1 font-display text-2xl font-bold text-primary">
            {proCount}
          </p>
          <p className="mt-1 text-[11px] text-emerald-600 font-semibold">
            {businesses.length > 0 ? `${Math.round((proCount / businesses.length) * 100)}% de conversion` : "0%"}
          </p>
        </div>

        <div className="card-soft p-4">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">Clients Totaux</p>
          <p className="mt-1 font-display text-2xl font-bold text-foreground">
            {statsQuery.isLoading ? "…" : statsQuery.data?.totalClients}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">sur toute la plateforme</p>
        </div>

        <div className="card-soft p-4">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">Commandes Totales</p>
          <p className="mt-1 font-display text-2xl font-bold text-foreground">
            {statsQuery.isLoading ? "…" : statsQuery.data?.totalOrders}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">confections enregistrées</p>
        </div>
      </div>

      {/* Barre de recherche et filtrage */}
      <div className="card-soft p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par nom d'atelier, couturier, ville, téléphone..."
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="pl-9 h-11 text-base sm:text-sm rounded-xl"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-muted-foreground mr-1">Filtrer par formule :</span>
            {(["all", "free", "monthly", "quarterly", "yearly"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFilterPlan(p)}
                className={`rounded-full px-2.5 py-1 font-semibold transition-all ${
                  filterPlan === p
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "all" ? "Tous" : PLAN_CONFIG[p]?.name ?? p}
              </button>
            ))}
          </div>
        </div>

        {/* Tableau des ateliers */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="p-3 font-semibold">Atelier & Responsable</th>
                <th className="p-3 font-semibold">Contact & Ville</th>
                <th className="p-3 font-semibold">Formule / Statut</th>
                <th className="p-3 font-semibold">Expiration</th>
                <th className="p-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {businessesQuery.isLoading ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ) : filteredBusinesses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Aucun atelier trouvé.
                  </td>
                </tr>
              ) : (
                filteredBusinesses.map((b) => {
                  const planItem = PLAN_CONFIG[b.plan] ?? PLAN_CONFIG.free;
                  return (
                    <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground text-sm">{b.name}</span>
                          {b.is_admin && (
                            <span className="rounded bg-purple-500/20 px-1.5 py-0.2 text-[10px] font-extrabold text-purple-700 dark:text-purple-300">
                              ADMIN
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-[11px]">{b.owner_name || "Non renseigné"}</p>
                      </td>

                      <td className="p-3 text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Phone className="size-3" /> {b.phone || "—"}
                        </div>
                        <p className="text-[11px]">{b.city || "—"}</p>
                      </td>

                      <td className="p-3">
                        {b.is_admin ? (
                          <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 text-purple-700 dark:text-purple-300 px-2 py-0.5 font-bold">
                            <Crown className="size-3" /> Exonéré (Admin)
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${planItem.badgeColor}`}
                          >
                            {b.plan === "yearly" && <Sparkles className="size-3" />}
                            {b.plan === "quarterly" && <Flame className="size-3" />}
                            {planItem.badge}
                          </span>
                        )}
                      </td>

                      <td className="p-3 text-muted-foreground">
                        {b.is_admin
                          ? "Permanent"
                          : b.plan_expires_at
                          ? dateFr(b.plan_expires_at)
                          : "Illimité"}
                      </td>

                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7 text-xs font-semibold">
                              Gérer ▾
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 text-xs">
                            <DropdownMenuLabel>Gestion du Forfait</DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() =>
                                updateBusinessMutation.mutate({
                                  businessId: b.id,
                                  plan: "monthly",
                                })
                              }
                            >
                              ⭐ Activer Pro Mensuel (+30j)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                updateBusinessMutation.mutate({
                                  businessId: b.id,
                                  plan: "quarterly",
                                })
                              }
                            >
                              🔥 Activer Pro Trimestriel (+90j)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                updateBusinessMutation.mutate({
                                  businessId: b.id,
                                  plan: "yearly",
                                })
                              }
                            >
                              ✨ Activer Pro Annuel (+365j)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                updateBusinessMutation.mutate({
                                  businessId: b.id,
                                  plan: "free",
                                })
                              }
                              className="text-muted-foreground"
                            >
                              🔄 Rétablir en Découverte (Gratuit)
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Sécurité & Droits Admin</DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() =>
                                updateBusinessMutation.mutate({
                                  businessId: b.id,
                                  isAdmin: !b.is_admin,
                                })
                              }
                              className={b.is_admin ? "text-destructive font-semibold" : "font-semibold text-purple-700 dark:text-purple-300"}
                            >
                              {b.is_admin ? "Retirer droits Administrateur" : "👑 Nommer Administrateur (Exemption)"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
