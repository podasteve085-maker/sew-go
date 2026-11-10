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
  KeyRound,
  Plus,
  Copy,
  Check,
  MessageCircle,
  Clock,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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


type AdminLicenseRow = {
  id: string;
  license_key: string;
  plan: SubscriptionPlan;
  duration_days: number;
  assigned_phone: string | null;
  assigned_business_id: string | null;
  status: "active" | "used" | "revoked" | "expired";
  used_by_business_id: string | null;
  used_at: string | null;
  notes: string | null;
  created_at: string;
};

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
  const [activeTab, setActiveTab] = useState<"ateliers" | "licences">("ateliers");
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [newPlan, setNewPlan] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [assignedPhone, setAssignedPhone] = useState("");
  const [targetBusinessId, setTargetBusinessId] = useState("");
  const [licenseNotes, setLicenseNotes] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // 1b. Liste des licences générées
  const licensesQuery = useQuery({
    queryKey: ["admin", "licenses"],
    queryFn: async (): Promise<AdminLicenseRow[]> => {
      const { data, error } = await (supabase.from("licenses") as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        // Table non encore migrée ou vide
        return [];
      }
      return (data ?? []) as AdminLicenseRow[];
    },
    enabled: isAdmin,
  });

  // Mutation génération de clé de licence
  const generateLicenseMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_generate_license_key", {
        p_plan: newPlan,
        p_duration_days: newPlan === "monthly" ? 30 : newPlan === "quarterly" ? 90 : 365,
        p_assigned_phone: assignedPhone.trim() || null,
        p_assigned_business_id: targetBusinessId || null,
        p_notes: licenseNotes.trim() || null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "licenses"] });
      setGeneratedKey(data.license_key);
      toast.success("Clé de licence générée avec succès !");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erreur lors de la génération de la clé.");
    },
  });

  // Mutation activation directe depuis l'admin (cumul des jours)
  const directActivateMutation = useMutation({
    mutationFn: async ({
      businessId,
      plan,
      durationDays,
    }: {
      businessId: string;
      plan: string;
      durationDays: number;
    }) => {
      const { data, error } = await (supabase.rpc as any)("admin_activate_business_plan", {
        p_business_id: businessId,
        p_plan: plan,
        p_duration_days: durationDays,
      });

      if (error) {
        // Fallback si RPC pas encore dispo
        return updateBusinessMutation.mutateAsync({
          businessId,
          plan: plan as SubscriptionPlan,
        });
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "businesses"] });
      toast.success("Forfait de l'atelier mis à jour et prolongé avec succès !");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erreur lors de la mise à jour de l'atelier.");
    },
  });


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

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setGeneratedKey(null);
              setGenerateDialogOpen(true);
            }}
            className="font-bold shadow-xs"
          >
            <Plus className="mr-1.5 size-4" /> Générer une Licence
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              businessesQuery.refetch();
              statsQuery.refetch();
              licensesQuery.refetch();
            }}
          >
            <RefreshCw className="mr-1.5 size-3.5" /> Actualiser
          </Button>
        </div>
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
      </div>

      {/* Onglets Ateliers & Licences */}
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="space-y-4">
        <TabsList className="bg-muted p-1 rounded-xl">
          <TabsTrigger value="ateliers" className="font-bold text-xs sm:text-sm">
            Ateliers & Abonnements ({businesses.length})
          </TabsTrigger>
          <TabsTrigger value="licences" className="font-bold text-xs sm:text-sm">
            <KeyRound className="mr-1.5 size-3.5" /> Clés de Licences ({(licensesQuery.data ?? []).length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ateliers" className="space-y-4">
          <div className="card-soft p-4 space-y-4">
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
                                directActivateMutation.mutate({
                                  businessId: b.id,
                                  plan: "monthly",
                                  durationDays: 30,
                                })
                              }
                            >
                              ⭐ Activer / Prolonger Pro Mensuel (+30j)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                directActivateMutation.mutate({
                                  businessId: b.id,
                                  plan: "quarterly",
                                  durationDays: 90,
                                })
                              }
                            >
                              🔥 Activer / Prolonger Pass Saison (+90j)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                directActivateMutation.mutate({
                                  businessId: b.id,
                                  plan: "yearly",
                                  durationDays: 365,
                                })
                              }
                            >
                              ✨ Activer / Prolonger Pass VIP (+365j)
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
      </TabsContent>

      {/* Onglet 2 : Gestion des Clés de Licence */}
      <TabsContent value="licences" className="space-y-4">
        <div className="card-soft p-5 border border-border space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-lg">Registre des Clés de Licence</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Clés d'activation cryptographiques infalsifiables. Chaque clé ne peut être utilisée qu'une seule fois.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setGeneratedKey(null);
                setGenerateDialogOpen(true);
              }}
              className="font-bold shadow-xs shrink-0"
            >
              <Plus className="mr-1.5 size-4" /> Nouvelle Clé
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/50 font-bold uppercase tracking-wider text-muted-foreground text-[10px]">
                <tr>
                  <th className="p-3">Clé de Licence</th>
                  <th className="p-3">Formule</th>
                  <th className="p-3">Téléphone Scellé</th>
                  <th className="p-3">Statut</th>
                  <th className="p-3">Date Création</th>
                  <th className="p-3">Date Utilisation</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {licensesQuery.isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      Chargement des licences…
                    </td>
                  </tr>
                ) : (licensesQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      Aucune clé de licence générée pour le moment. Cliquez sur « Nouvelle Clé » pour en créer une.
                    </td>
                  </tr>
                ) : (
                  (licensesQuery.data ?? []).map((lic) => {
                    const isUsed = lic.status === "used";
                    const isRevoked = lic.status === "revoked";

                    return (
                      <tr key={lic.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-mono font-bold text-xs text-foreground tracking-wider select-all">
                          {lic.license_key}
                        </td>
                        <td className="p-3">
                          <span className="rounded bg-primary/10 text-primary px-2 py-0.5 font-bold uppercase text-[10px]">
                            {lic.plan} ({lic.duration_days}j)
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {lic.assigned_phone ? (
                            <span className="inline-flex items-center gap-1 text-foreground font-semibold">
                              <ShieldCheck className="size-3 text-emerald-600" /> {lic.assigned_phone}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">Universelle (tout atelier)</span>
                          )}
                        </td>
                        <td className="p-3">
                          {isUsed ? (
                            <span className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground px-2 py-0.5 font-semibold text-[10px]">
                              <CheckCircle2 className="size-3 text-emerald-600" /> Consommée
                            </span>
                          ) : isRevoked ? (
                            <span className="inline-flex items-center gap-1 rounded bg-destructive/15 text-destructive px-2 py-0.5 font-semibold text-[10px]">
                              <XCircle className="size-3" /> Révoquée
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 font-bold text-[10px]">
                              ● Active & Valide
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {dateFr(lic.created_at)}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {lic.used_at ? dateFr(lic.used_at) : "—"}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(lic.license_key);
                                toast.success("Clé copiée dans le presse-papier !");
                              }}
                              className="size-7 inline-flex items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Copier la clé"
                            >
                              <Copy className="size-3.5" />
                            </button>
                            {lic.assigned_phone && !isUsed && (
                              <a
                                href={`https://wa.me/${lic.assigned_phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                                  `Bonjour,\nVoici votre Clé de Licence officielle CouturPro (*${lic.plan.toUpperCase()} - ${lic.duration_days} jours*) :\n\n🔑 *${lic.license_key}*\n\nPour l'activer : rendez-vous dans l'application CouturPro > menu « Mon Abonnement » > entrez cette clé dans l'encadré « Clé de Licence » et validez. Merci de votre confiance ! ✂️`
                                )}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="size-7 inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                                title="Envoyer par WhatsApp à l'artisan"
                              >
                                <MessageCircle className="size-3.5" />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </TabsContent>
      </Tabs>

      {/* Boîte de dialogue : Génération de Clé de Licence */}
      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" /> Générateur de Licence Officielle
            </DialogTitle>
            <DialogDescription>
              Créez une clé d'activation sécurisée et scellez-la éventuellement avec le numéro WhatsApp de l'artisan.
            </DialogDescription>
          </DialogHeader>

          {generatedKey ? (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl border-2 border-emerald-500/50 bg-emerald-500/10 p-4 text-center space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                  Clé Générée avec Succès
                </span>
                <p className="font-mono text-xl sm:text-2xl font-extrabold text-foreground tracking-widest select-all">
                  {generatedKey}
                </p>
                <p className="text-xs text-muted-foreground">
                  Formule {newPlan.toUpperCase()} (
                  {newPlan === "monthly" ? "30 jours" : newPlan === "quarterly" ? "90 jours" : "365 jours"})
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedKey);
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 2000);
                    toast.success("Clé copiée !");
                  }}
                  className="flex-1 font-bold"
                  variant="outline"
                >
                  {copiedKey ? <Check className="mr-1.5 size-4" /> : <Copy className="mr-1.5 size-4" />}
                  {copiedKey ? "Copié !" : "Copier la clé"}
                </Button>

                {assignedPhone && (
                  <a
                    href={`https://wa.me/${assignedPhone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                      `Bonjour,\nVoici votre Clé de Licence officielle CouturPro (*${newPlan.toUpperCase()}*) :\n\n🔑 *${generatedKey}*\n\nPour l'activer : rendez-vous dans l'application CouturPro > menu « Mon Abonnement » > entrez cette clé dans l'encadré « Clé de Licence » et validez. Merci de votre confiance ! ✂️`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                  >
                    <MessageCircle className="size-4" /> WhatsApp
                  </a>
                )}
              </div>

              <Button
                variant="ghost"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setGenerateDialogOpen(false)}
              >
                Fermer
              </Button>
            </div>
          ) : (
            <div className="space-y-4 py-2 text-xs">
              <div className="space-y-1.5">
                <Label className="font-bold">Formule d'abonnement</Label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewPlan("monthly")}
                    className={`rounded-xl border p-2.5 text-center transition-all ${
                      newPlan === "monthly"
                        ? "border-primary bg-primary/10 font-bold text-primary ring-1 ring-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="text-xs font-bold">Mensuel</div>
                    <div className="text-[10px] text-muted-foreground">3 000 F (30j)</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewPlan("quarterly")}
                    className={`rounded-xl border p-2.5 text-center transition-all ${
                      newPlan === "quarterly"
                        ? "border-amber-500 bg-amber-500/10 font-bold text-amber-700 dark:text-amber-400 ring-1 ring-amber-500"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="text-xs font-bold">Trimestriel</div>
                    <div className="text-[10px] text-muted-foreground">7 500 F (90j)</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewPlan("yearly")}
                    className={`rounded-xl border p-2.5 text-center transition-all ${
                      newPlan === "yearly"
                        ? "border-emerald-600 bg-emerald-500/10 font-bold text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-600"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="text-xs font-bold">Annuel VIP</div>
                    <div className="text-[10px] text-muted-foreground">35 000 F (365j)</div>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="font-bold">
                  Téléphone de l'artisan (Recommandé anti-fraude)
                </Label>
                <Input
                  placeholder="Ex : +226 70 00 00 00"
                  value={assignedPhone}
                  onChange={(e) => setAssignedPhone(e.target.value)}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  Si renseigné, seul l'atelier possédant ce numéro pourra activer la clé.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="font-bold">Note administrative (optionnel)</Label>
                <Input
                  placeholder="Ex : Payé par Orange Money au guichet"
                  value={licenseNotes}
                  onChange={(e) => setLicenseNotes(e.target.value)}
                  className="h-9"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setGenerateDialogOpen(false)}
                >
                  Annuler
                </Button>
                <Button
                  size="sm"
                  onClick={() => generateLicenseMutation.mutate()}
                  disabled={generateLicenseMutation.isPending}
                  className="font-bold shadow-xs"
                >
                  {generateLicenseMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 size-3.5 animate-spin" /> Génération…
                    </>
                  ) : (
                    <>
                      <KeyRound className="mr-1.5 size-3.5" /> Créer la Clé Officielle
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
