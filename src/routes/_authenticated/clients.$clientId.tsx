import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Ruler, Trash2, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import {
  fetchClient,
  fetchMeasurementSets,
  fetchOrders,
  fetchAppointments,
  fetchTemplates,
  balance,
  paidTotal,
  type MeasurementSetRow,
} from "@/lib/queries";
import { appointmentLabel } from "@/lib/domain";
import { fcfa, dateFr, fullName, initials, today } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

  const client = useQuery({ queryKey: ["client", clientId], queryFn: () => fetchClient(clientId) });
  const sets = useQuery({
    queryKey: ["measurements", clientId],
    queryFn: () => fetchMeasurementSets(clientId),
  });
  const orders = useQuery({
    queryKey: ["orders", { clientId }],
    queryFn: () => fetchOrders({ clientId }),
  });
  const appointments = useQuery({
    queryKey: ["appointments", { clientId }],
    queryFn: () => fetchAppointments({ clientId }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("clients").delete().eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client supprimé");
      navigate({ to: "/clients" });
    },
    onError: () => toast.error("Suppression impossible"),
  });

  const deleteMeasureSet = useMutation({
    mutationFn: async (setId: string) => {
      const { error } = await supabase.from("measurement_sets").delete().eq("id", setId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["measurements", clientId] });
      toast.success("Relevé de mesures supprimé");
      setDeleteMeasureSetId(null);
    },
    onError: () => toast.error("Suppression impossible"),
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Clients
      </Link>

      <header className="card-soft p-5">
        <div className="flex items-start gap-4">
          {c.photo_url ? (
            <StoredImage
              path={c.photo_url}
              alt={fullName(c)}
              className="size-16 shrink-0 rounded-2xl object-cover"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-secondary font-display text-lg font-bold text-secondary-foreground">
              {initials(c.first_name, c.last_name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-bold">{fullName(c)}</h1>
            <p className="text-sm text-muted-foreground">
              {c.phone ?? "Sans téléphone"}
              {c.city ? ` · ${c.city}` : ""}
            </p>
            <div className="mt-3">
              <ContactButtons
                phone={c.phone}
                whatsapp={c.whatsapp}
                message={`Bonjour ${c.first_name}, c'est ${business?.name ?? "votre atelier"}.`}
              />
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
            <Pencil className="size-4" /> Modifier
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Commandes" value={String(allOrders.length)} />
          <MiniStat label="Total payé" value={fcfa(totalPaid, business?.currency)} />
          <MiniStat label="Reste à payer" value={fcfa(totalDue, business?.currency)} />
          <MiniStat label="Dernières mesures" value={lastSet ? dateFr(lastSet.recorded_at) : "—"} />
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
          <SectionTitle>Rendez-vous</SectionTitle>
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
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate()}
            >
              Supprimer
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
    <div className="rounded-xl bg-surface p-3">
      <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function MeasurementDialog({
  open,
  onOpenChange,
  businessId,
  clientId,
  initialSet,
  mode = "create",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: string;
  clientId: string;
  initialSet?: MeasurementSetRow | null;
  mode?: "create" | "edit" | "copy";
}) {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates, enabled: open });
  const [templateName, setTemplateName] = useState("");
  const [fields, setFields] = useState<{ name: string; value: string }[]>([]);
  const [extraName, setExtraName] = useState("");
  const [notes, setNotes] = useState("");
  const [recordedAt, setRecordedAt] = useState(today());

  // Synchronise les valeurs lorsque la modale s'ouvre ou change de mode
  useEffect(() => {
    if (!open) return;
    if (initialSet && (mode === "edit" || mode === "copy")) {
      setTemplateName(initialSet.template_name ?? "");
      setRecordedAt(mode === "edit" ? initialSet.recorded_at : today());
      setNotes(initialSet.notes ?? "");
      const existing = (initialSet.measurement_values ?? [])
        .sort((a, b) => a.position - b.position)
        .map((v) => ({
          name: v.name,
          value: v.value !== null ? String(v.value) : "",
        }));
      setFields(existing);
    } else {
      setTemplateName("");
      setFields([]);
      setNotes("");
      setRecordedAt(today());
    }
  }, [open, initialSet, mode]);

  function pickTemplate(name: string) {
    setTemplateName(name);
    const tpl = templates.data?.find((t) => t.name === name);
    setFields((tpl?.fields ?? []).map((f) => ({ name: f, value: "" })));
  }

  const save = useMutation({
    mutationFn: async () => {
      let targetSetId = initialSet?.id;

      if (mode === "edit" && targetSetId) {
        const { error: setErr } = await supabase
          .from("measurement_sets")
          .update({
            template_name: templateName || null,
            label: templateName || "Relevé",
            notes: notes || null,
            recorded_at: recordedAt,
          })
          .eq("id", targetSetId);
        if (setErr) throw setErr;

        const { error: delErr } = await supabase
          .from("measurement_values")
          .delete()
          .eq("set_id", targetSetId);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await supabase
          .from("measurement_sets")
          .insert({
            business_id: businessId,
            client_id: clientId,
            template_name: templateName || null,
            label: templateName || "Relevé",
            notes: notes || null,
            recorded_at: recordedAt,
          })
          .select("id")
          .single();
        if (error) throw error;
        targetSetId = (data as { id: string }).id;
      }

      const values = fields
        .filter((f) => f.name.trim())
        .map((f, i) => ({
          business_id: businessId,
          set_id: targetSetId!,
          name: f.name.trim(),
          value: f.value === "" ? null : Number(f.value.replace(",", ".")),
          unit: "cm",
          position: i,
        }));
      if (values.length) {
        const { error: valueError } = await supabase.from("measurement_values").insert(values);
        if (valueError) throw valueError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["measurements", clientId] });
      toast.success(mode === "edit" ? "Mesures modifiées" : "Mesures enregistrées");
      onOpenChange(false);
      setFields([]);
      setTemplateName("");
    },
    onError: () => toast.error("Enregistrement impossible"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit"
              ? "Modifier le relevé de mesures"
              : mode === "copy"
              ? "Reprendre et actualiser les mesures"
              : "Nouveau relevé de mesures"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Corrigez les valeurs de ce relevé."
              : mode === "copy"
              ? "Crée un nouveau relevé daté avec les valeurs pré-remplies de l'ancien relevé."
              : "Les anciennes mesures sont conservées : ce relevé s'ajoute à l'historique."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="template">Modèle</Label>
              <select
                id="template"
                value={templateName}
                onChange={(e) => pickTemplate(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="">Choisir…</option>
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recorded_at">Date du relevé</Label>
              <Input
                id="recorded_at"
                name="recorded_at"
                type="date"
                value={recordedAt}
                onChange={(e) => setRecordedAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{f.name}</span>
                <Input
                  inputMode="decimal"
                  value={f.value}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.map((item, idx) =>
                        idx === i ? { ...item, value: e.target.value } : item,
                      ),
                    )
                  }
                  className="w-24"
                  placeholder="cm"
                />
                <button
                  type="button"
                  onClick={() => setFields((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Retirer ${f.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}

            <div className="flex items-center gap-2 pt-2">
              <Input
                value={extraName}
                onChange={(e) => setExtraName(e.target.value)}
                placeholder="Ajouter une mesure (ex. Tour de poitrine)"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!extraName.trim()) return;
                  setFields((prev) => [...prev, { name: extraName.trim(), value: "" }]);
                  setExtraName("");
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="measure-notes">Remarques</Label>
            <Textarea
              id="measure-notes"
              name="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Remarques spécifiques à ce relevé..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending || fields.length === 0}>
              {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
