import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useDeferredValue } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, MapPin, Phone, MessageCircle, Crown, AlertCircle, Users, Trash2 } from "lucide-react";

import { fetchClients, deleteClientCascade, type ClientRow } from "@/lib/queries";
import { useBusiness } from "@/hooks/use-business";
import { fullName, initials, dateFr, cleanPhone } from "@/lib/format";
import { isProOrAdmin, checkClientQuota } from "@/lib/quotas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, StoredImage } from "@/components/bits";
import { ClientFormDialog } from "@/components/client-form-dialog";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/clients/")({
  validateSearch: (search: Record<string, unknown>): { nouveau?: boolean } => ({
    nouveau: search["nouveau"] === true || search["nouveau"] === "true",
  }),
  head: () => ({
    meta: [
      { title: "Clients — CouturPro" },
      {
        name: "description",
        content: "Tous vos clients avec téléphone, WhatsApp, quartier, mesures et historique.",
      },
      { property: "og:title", content: "Clients — CouturPro" },
      { property: "og:description", content: "Le carnet d'adresses de votre atelier de couture." },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const { nouveau } = Route.useSearch();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const deferredTerm = useDeferredValue(term);
  const [openNew, setOpenNew] = useState(Boolean(nouveau));
  const [genderFilter, setGenderFilter] = useState<string>("all");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [quotaReason, setQuotaReason] = useState("");
  const [clientToDelete, setClientToDelete] = useState<ClientRow | null>(null);

  const { data: business } = useBusiness();
  const clients = useQuery({
    queryKey: ["clients", deferredTerm],
    queryFn: () => fetchClients(deferredTerm),
    enabled: true,
  });

  const deleteMutation = useMutation({
    mutationFn: async (clientId: string) => {
      await deleteClientCascade(clientId, business?.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["measurements"] });
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["clients-count"] });
      toast.success("Client et données associées supprimés");
      setClientToDelete(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Suppression impossible";
      toast.error(`Erreur : ${msg}`);
    },
  });

  const isPro = isProOrAdmin(business);
  const totalClients = (clients.data ?? []).length;
  const clientQuota = checkClientQuota(business, totalClients);

  const filteredClients = useMemo(() => {
    const list = clients.data ?? [];
    if (genderFilter === "all") return list;
    return list.filter((c) => c.gender?.toLowerCase() === genderFilter.toLowerCase());
  }, [clients.data, genderFilter]);

  function handleOpenNew() {
    if (!clientQuota.allowed) {
      setQuotaReason(clientQuota.message || "Limite de 10 clients atteinte.");
      setUpgradeOpen(true);
    } else {
      setOpenNew(true);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="page-title">Clients</h1>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
            {filteredClients.length}
          </span>
        </div>
        <Button size="sm" onClick={handleOpenNew} className="shadow-xs">
          <Plus className="size-4" /> Nouveau
        </Button>
      </header>

      {/* Jauge Quota pour le Plan Gratuit */}
      {!isPro && (
        <div
          className={`rounded-xl border p-3 text-xs flex flex-wrap items-center justify-between gap-2.5 ${
            !clientQuota.allowed
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : totalClients >= 8
              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              : "border-border bg-card text-muted-foreground"
          }`}
        >
          <div className="flex items-center gap-2">
            <Users className="size-4 shrink-0 text-primary" />
            <span>
              Quota formule Gratuite :{" "}
              <strong className="text-foreground">
                {totalClients} / 10 clients
              </strong>
              {!clientQuota.allowed
                ? " — Limite atteinte ! Passez à Pro pour continuer."
                : ` (${10 - totalClients} restants)`}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setQuotaReason("Passez à CouturPro pour enregistrer un nombre illimité de clients.");
              setUpgradeOpen(true);
            }}
            className="h-7 text-xs font-bold text-primary border-primary/30 hover:bg-primary/10 ml-auto"
          >
            <Crown className="mr-1 size-3.5" /> Passer à Pro (Illimité)
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Rechercher nom ou téléphone…"
            className="pl-9 h-9 text-xs sm:text-sm"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: "all", label: "Tous" },
            { id: "homme", label: "Hommes" },
            { id: "femme", label: "Femmes" },
            { id: "enfant", label: "Enfants" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setGenderFilter(f.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                genderFilter === f.id
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "border border-border/70 bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {clients.isLoading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredClients.length === 0 ? (
        <EmptyState
          title={term || genderFilter !== "all" ? "Aucun client trouvé" : "Aucun client enregistré"}
          action={<Button size="sm" onClick={() => setOpenNew(true)}>Ajouter un client</Button>}
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {filteredClients.map((c) => (
            <div
              key={c.id}
              className="card-soft list-card-fast flex flex-col justify-between p-3 sm:p-3.5 transition-all hover:border-primary/40 hover:shadow-xs"
            >
              <Link
                to="/clients/$clientId"
                params={{ clientId: c.id }}
                className="flex items-center gap-3 min-w-0"
              >
                {c.photo_url ? (
                  <StoredImage
                    path={c.photo_url}
                    alt={fullName(c)}
                    className="size-11 shrink-0 rounded-full object-cover ring-1 ring-border"
                  />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-sm font-bold text-primary">
                    {initials(c.first_name, c.last_name)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="truncate font-display text-sm font-bold text-foreground hover:text-primary">
                      {fullName(c)}
                    </p>
                    {c.gender && (
                      <span
                        className={`rounded-full px-1.5 py-0.2 text-[0.6rem] font-bold uppercase shrink-0 ${
                          c.gender === "homme"
                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                            : c.gender === "femme"
                            ? "bg-purple-500/10 text-purple-700 dark:text-purple-400"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        }`}
                      >
                        {c.gender}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs font-semibold text-muted-foreground">
                    {c.phone ?? "Sans téléphone"}
                  </p>
                  {c.city && (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[0.7rem] text-muted-foreground">
                      <MapPin className="size-2.5 text-muted-foreground/70" /> {c.city}
                    </p>
                  )}
                </div>
              </Link>

              {/* Actions tactiles directes (Appel / WhatsApp / Fiche / Supprimer) */}
              <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-border/70 pt-2">
                {c.phone && (
                  <a
                    href={`tel:${cleanPhone(c.phone)}`}
                    className="inline-flex h-7.5 items-center justify-center gap-1 rounded-lg border border-border px-2 text-[0.75rem] font-semibold text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95"
                    title={`Appeler ${c.first_name}`}
                  >
                    <Phone className="size-3 text-primary" />
                    <span>Appel</span>
                  </a>
                )}
                {(c.whatsapp || c.phone) && (
                  <a
                    href={`https://wa.me/${cleanPhone(c.whatsapp || c.phone)}?text=${encodeURIComponent(
                      `Bonjour ${c.first_name}, c'est ${business?.name ?? "votre atelier"}.`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7.5 items-center gap-1 rounded-lg border border-success/30 bg-success/10 px-2 text-[0.75rem] font-semibold text-success transition-all hover:bg-success/20 active:scale-95"
                    title={`WhatsApp ${c.first_name}`}
                  >
                    <MessageCircle className="size-3" />
                    <span>WhatsApp</span>
                  </a>
                )}
                <Button size="sm" variant="ghost" className="h-7.5 text-xs font-semibold px-2" asChild>
                  <Link to="/clients/$clientId" params={{ clientId: c.id }}>
                    Fiche →
                  </Link>
                </Button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setClientToDelete(c);
                  }}
                  className="inline-flex size-7.5 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive active:scale-95 cursor-pointer"
                  title={`Supprimer ${c.first_name}`}
                  aria-label={`Supprimer ${c.first_name}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Boîte de dialogue de confirmation de suppression */}
      <AlertDialog
        open={Boolean(clientToDelete)}
        onOpenChange={(v) => !v && setClientToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {clientToDelete ? fullName(clientToDelete) : "ce client"} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action supprimera définitivement le client ainsi que l'ensemble de son
              historique de mesures, commandes, paiements et rendez-vous associés.
              Cette opération est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (clientToDelete) deleteMutation.mutate(clientToDelete.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Suppression en cours…" : "Supprimer définitivement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {business && (
        <ClientFormDialog open={openNew} onOpenChange={setOpenNew} businessId={business.id} />
      )}

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        triggerReason={quotaReason}
      />
    </div>
  );
}
