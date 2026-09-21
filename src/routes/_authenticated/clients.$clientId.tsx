import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Ruler, Trash2, Loader2, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import {
  fetchClient,
  fetchMeasurementSets,
  fetchOrders,
  fetchAppointments,
  balance,
  paidTotal,
  deleteClientCascade,
  deleteMeasurementSetCascade,
  type MeasurementSetRow,
} from "@/lib/queries";
import { appointmentLabel } from "@/lib/domain";
import { fcfa, dateFr, fullName, initials, today, cleanPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  EmptyState,
  ContactButtons,
  StoredImage,
  OrderCard,
  SectionTitle,
} from "@/components/bits";
import { ClientFormDialog } from "@/components/client-form-dialog";
import { MeasurementDialog } from "@/components/measurement-dialog";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  head: () => ({
    meta: [
      { title: "Fiche client — CouturPro" },
      {
        name: "description",
        content:
          "Mesures datées, commandes, rendez-vous, paiements et notes : tout l'historique du client.",
      },
      { property: "og:title", content: "Fiche client — CouturPro" },
      { property: "og:description", content: "Mesures, commandes et paiements d'un client." },
    ],
  }),
  component: ClientDetail,
});

function ClientDetail() {
  const { clientId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();
  const [edit, setEdit] = useState(false);
  const [newMeasure, setNewMeasure] = useState(false);
  const [deleteClientOpen, setDeleteClientOpen] = useState(false);
  const [selectedMeasureSet, setSelectedMeasureSet] = useState<MeasurementSetRow | null>(null);
  const [measureMode, setMeasureMode] = useState<"create" | "edit" | "copy">("create");
  const [deleteMeasureSetId, setDeleteMeasureSetId] = useState<string | null>(null);

  const client = useQuery({
    queryKey: ["client", clientId, business?.id],
    queryFn: () => fetchClient(clientId, business?.id),
    enabled: Boolean(clientId && business?.id),
  });
  const sets = useQuery({
    queryKey: ["measurements", clientId, business?.id],
    queryFn: () => fetchMeasurementSets(clientId, business?.id),
    enabled: Boolean(clientId && business?.id),
  });
  const orders = useQuery({
    queryKey: ["orders", business?.id, { clientId }],
    queryFn: () => fetchOrders(business?.id ?? "", { clientId }),
    enabled: Boolean(business?.id),
  });
  const appointments = useQuery({
    queryKey: ["appointments", business?.id, { clientId }],
    queryFn: () => fetchAppointments(business?.id ?? "", { clientId }),
    enabled: Boolean(business?.id),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await deleteClientCascade(clientId, business?.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["measurements"] });
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["clients-count"] });
      toast.success("Client et données associées supprimés");
      navigate({ to: "/clients" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Suppression impossible";
      toast.error(`Erreur : ${msg}`);
    },
  });

  const deleteMeasureSet = useMutation({
    mutationFn: async (setId: string) => {
      await deleteMeasurementSetCascade(setId, business?.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["measurements"] });
      toast.success("Relevé de mesures supprimé");
      setDeleteMeasureSetId(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Suppression impossible";
      toast.error(`Erreur : ${msg}`);
    },
  });

  if (client.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }
  if (!client.data) {
    return <EmptyState title="Client introuvable" />;
  }

  const c = client.data;
  const allOrders = orders.data ?? [];
  const totalPaid = allOrders.reduce((s, o) => s + paidTotal(o), 0);
  const totalDue = allOrders.reduce((s, o) => s + Math.max(0, balance(o)), 0);
  const lastSet = sets.data?.[0];

  function shareViaWhatsApp(set: MeasurementSetRow) {
    const phone = cleanPhone(c.whatsapp || c.phone || "");
    const atelier = business?.name ?? "votre atelier";
    const values = (set.measurement_values ?? [])
      .sort((a, b) => a.position - b.position)
      .map((v) => `• ${v.name} : ${v.value ?? "—"} ${v.unit}`)
      .join("\n");

    const message = `Bonjour ${c.first_name},\nVoici votre fiche de mesures enregistrée chez *${atelier}* (${set.template_name || set.label || "Relevé"} du ${dateFr(set.recorded_at)}) :\n\n${values}\n\n${set.notes ? `_Note : ${set.notes}_\n\n` : ""}Merci de votre confiance ! ✂️`;

    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    window.open(url, "_blank");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Clients
      </Link>

      <header className="card-soft p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="flex items-start gap-3 min-w-0">
            {c.photo_url ? (
              <StoredImage
                path={c.photo_url}
                alt={fullName(c)}
                className="size-13 sm:size-16 shrink-0 rounded-2xl object-cover"
              />
            ) : (
              <span className="flex size-13 sm:size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-display text-base sm:text-lg font-bold text-primary">
                {initials(c.first_name, c.last_name)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-lg sm:text-xl font-bold">{fullName(c)}</h1>
                {c.city && (
                  <span className="hidden sm:inline-block rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                    {c.city}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {c.phone ?? "Sans téléphone"}
                {c.city ? ` · ${c.city}` : ""}
              </p>
              <div className="mt-2.5">
                <ContactButtons
                  phone={c.phone}
                  whatsapp={c.whatsapp}
                  message={`Bonjour ${c.first_name}, c'est ${business?.name ?? "votre atelier"}.`}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-start">
            <Button variant="outline" size="sm" onClick={() => setEdit(true)} className="h-8 text-xs font-semibold">
              <Pencil className="mr-1 size-3.5" /> Modifier
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4">
          <MiniStat label="Commandes" value={String(allOrders.length)} />
          <MiniStat label="Total payé" value={fcfa(totalPaid, business?.currency)} />
          <MiniStat label="Reste à payer" value={fcfa(totalDue, business?.currency)} />
          <MiniStat label="Mesures" value={lastSet ? dateFr(lastSet.recorded_at) : "Aucune"} />
        </div>
      </header>

      <Tabs defaultValue="mesures">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="mesures">Mesures</TabsTrigger>
          <TabsTrigger value="commandes">Commandes</TabsTrigger>
          <TabsTrigger value="rdv">Rendez-vous</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="mesures" className="mt-5 space-y-4">
          <SectionTitle
            action={
              <Button
                size="sm"
                onClick={() => {
                  setSelectedMeasureSet(null);
                  setMeasureMode("create");
                  setNewMeasure(true);
                }}
              >
                <Plus className="size-4" /> Nouveau relevé
              </Button>
            }
          >
            Carnet de mesures
          </SectionTitle>
          {sets.isLoading ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : (sets.data ?? []).length === 0 ? (
            <EmptyState
              title="Aucune mesure enregistrée"
              text="Choisissez un modèle (Homme, Femme, Enfant) et saisissez les mesures. Chaque relevé est daté et conservé."
              action={
                <Button
                  onClick={() => {
                    setSelectedMeasureSet(null);
                    setMeasureMode("create");
                    setNewMeasure(true);
                  }}
                >
                  Prendre les mesures
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {(sets.data ?? []).map((set) => (
                <div key={set.id} className="card-soft p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-display text-sm font-semibold">
                        Mesures du {dateFr(set.recorded_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {set.label || set.template_name || "Relevé"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs text-success hover:bg-success/10 hover:text-success"
                        title="Partager ce relevé par WhatsApp"
                        onClick={() => shareViaWhatsApp(set)}
                      >
                        <MessageCircle className="mr-1 size-3.5" /> WhatsApp
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                        title="Reprendre ce relevé comme base pour de nouvelles mesures"
                        onClick={() => {
                          setSelectedMeasureSet(set);
                          setMeasureMode("copy");
                          setNewMeasure(true);
                        }}
                      >
                        <Copy className="mr-1 size-3.5" /> Reprendre
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        title="Modifier ce relevé"
                        onClick={() => {
                          setSelectedMeasureSet(set);
                          setMeasureMode("edit");
                          setNewMeasure(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        title="Supprimer ce relevé"
                        onClick={() => setDeleteMeasureSetId(set.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                      <Ruler className="ml-1 size-4 text-primary" />
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                    {[...(set.measurement_values ?? [])]
                      .sort((a, b) => a.position - b.position)
                      .map((v) => (
                        <div key={v.id} className="flex items-baseline justify-between gap-2 border-b border-dashed border-border pb-1">
                          <dt className="text-xs text-muted-foreground">{v.name}</dt>
                          <dd className="text-sm font-semibold">
                            {v.value ?? "—"} {v.value !== null ? v.unit : ""}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  {set.notes && (
                    <p className="mt-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                      {set.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="commandes" className="mt-5 space-y-4">
          <SectionTitle
            action={
              <Button size="sm" asChild>
                <Link to="/commandes/nouvelle" search={{ client: clientId }}>
                  <Plus className="size-4" /> Commande
                </Link>
              </Button>
            }
          >
            Commandes
          </SectionTitle>
          {allOrders.length === 0 ? (
            <EmptyState title="Aucune commande" text="Créez une commande pour ce client." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {allOrders.map((o) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="rdv" className="mt-5 space-y-4">
          <SectionTitle
            action={
              <Button size="sm" asChild>
                <Link to="/rendez-vous" search={{ nouveau: true }}>
                  <Plus className="size-4" /> Nouveau RDV
                </Link>
              </Button>
            }
          >
            Rendez-vous
          </SectionTitle>
          {(appointments.data ?? []).length === 0 ? (
            <EmptyState title="Aucun rendez-vous" />
          ) : (
            <div className="space-y-3">
              {(appointments.data ?? []).map((a) => (
                <div key={a.id} className="card-soft flex items-center gap-3 p-4">
                  <span className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-bold text-primary">
                    {dateFr(a.scheduled_date)}
                  </span>
                  <span className="text-sm">{appointmentLabel(a.type)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {a.scheduled_time?.slice(0, 5) ?? ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes" className="mt-5 space-y-4">
          <SectionTitle>Notes sur le client</SectionTitle>
          <div className="card-soft whitespace-pre-line p-4 text-sm">
            {c.notes || "Aucune note. Utilisez « Modifier » pour ajouter les préférences du client."}
          </div>
          <div className="card-soft space-y-1 p-4 text-sm">
            <p>
              <span className="text-muted-foreground">Sexe : </span>
              {c.gender ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Naissance : </span>
              {dateFr(c.birth_date)}
            </p>
            <p>
              <span className="text-muted-foreground">Adresse : </span>
              {c.address ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Client depuis : </span>
              {dateFr(c.created_at)}
            </p>
          </div>
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteClientOpen(true)}
          >
            <Trash2 className="size-4" /> Supprimer le client
          </Button>
        </TabsContent>
      </Tabs>

      {/* Confirmation suppression client */}
      <AlertDialog open={deleteClientOpen} onOpenChange={setDeleteClientOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce client ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action supprimera définitivement {fullName(c)} ainsi que l'ensemble de son
              historique de mesures, commandes et rendez-vous.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Suppression en cours…" : "Supprimer définitivement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation suppression relevé de mesures */}
      <AlertDialog
        open={Boolean(deleteMeasureSetId)}
        onOpenChange={(v) => !v && setDeleteMeasureSetId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce relevé de mesures ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ce relevé sera définitivement retiré du carnet de mesures de ce client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteMeasureSetId) deleteMeasureSet.mutate(deleteMeasureSetId);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {business && (
        <>
          <ClientFormDialog
            open={edit}
            onOpenChange={setEdit}
            businessId={business.id}
            client={c}
          />
          <MeasurementDialog
            open={newMeasure}
            onOpenChange={setNewMeasure}
            businessId={business.id}
            clientId={clientId}
            initialSet={selectedMeasureSet}
            mode={measureMode}
          />
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 sm:p-3">
      <p className="text-[0.65rem] sm:text-[0.7rem] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs sm:text-sm font-extrabold text-foreground truncate">{value}</p>
    </div>
  );
}
