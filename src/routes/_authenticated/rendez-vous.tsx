import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fetchAppointments, fetchClients, type AppointmentRow } from "@/lib/queries";
import { APPOINTMENT_TYPES, APPOINTMENT_STATUS, appointmentLabel } from "@/lib/domain";
import { dateLongFr, fullName, today } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import { EmptyState, SectionTitle, ContactButtons } from "@/components/bits";

export const Route = createFileRoute("/_authenticated/rendez-vous")({
  validateSearch: (search: Record<string, unknown>): { nouveau?: boolean } =>
    search["nouveau"] === true || search["nouveau"] === "true" ? { nouveau: true } : {},
  head: () => ({
    meta: [
      { title: "Rendez-vous — CouturPro" },
      {
        name: "description",
        content:
          "Planifiez essayages, prises de mesures et livraisons, et prévenez vos clients par WhatsApp.",
      },
      { property: "og:title", content: "Rendez-vous — CouturPro" },
      { property: "og:description", content: "Agenda de votre atelier de couture." },
    ],
  }),
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const { nouveau } = Route.useSearch();
  const [open, setOpen] = useState(Boolean(nouveau));
  const [editingAppointment, setEditingAppointment] = useState<AppointmentRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"prevu" | "honore" | "annule" | "tous">("prevu");

  const queryClient = useQueryClient();
  const { data: business } = useBusiness();
  const appointments = useQuery({
    queryKey: ["appointments"],
    queryFn: () => fetchAppointments(),
  });

  const groups = useMemo(() => {
    const all = appointments.data ?? [];
    const list =
      filter === "tous"
        ? all
        : filter === "prevu"
        ? all.filter((a) => a.status === "prevu")
        : filter === "honore"
        ? all.filter((a) => a.status === "honore")
        : all.filter((a) => a.status === "annule");

    const map = new Map<string, typeof list>();
    for (const a of list) {
      const arr = map.get(a.scheduled_date) ?? [];
      arr.push(a);
      map.set(a.scheduled_date, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [appointments.data, filter]);

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Statut mis à jour");
    },
    onError: () => toast.error("Mise à jour impossible"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("appointments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Rendez-vous supprimé");
      setDeletingId(null);
    },
    onError: () => toast.error("Suppression impossible"),
  });

  const todayStr = today();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Rendez-vous</SectionTitle>
        <Button onClick={() => setOpen(true)}>
          <CalendarPlus className="size-4" /> Nouveau rendez-vous
        </Button>
      </div>

      {/* Filter Chips */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("prevu")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            filter === "prevu"
              ? "bg-primary text-primary-foreground"
              : "bg-surface text-muted-foreground hover:bg-muted"
          }`}
        >
          À venir / Prévus
        </button>
        <button
          type="button"
          onClick={() => setFilter("honore")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            filter === "honore"
              ? "bg-primary text-primary-foreground"
              : "bg-surface text-muted-foreground hover:bg-muted"
          }`}
        >
          Honorés
        </button>
        <button
          type="button"
          onClick={() => setFilter("annule")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            filter === "annule"
              ? "bg-primary text-primary-foreground"
              : "bg-surface text-muted-foreground hover:bg-muted"
          }`}
        >
          Annulés
        </button>
        <button
          type="button"
          onClick={() => setFilter("tous")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            filter === "tous"
              ? "bg-primary text-primary-foreground"
              : "bg-surface text-muted-foreground hover:bg-muted"
          }`}
        >
          Tous ({(appointments.data ?? []).length})
        </button>
      </div>

      {appointments.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Aucun rendez-vous"
          text={
            filter === "prevu"
              ? "Aucun rendez-vous prévu pour le moment. Planifiez un essayage ou une prise de mesures."
              : "Aucun rendez-vous dans cette catégorie."
          }
          action={<Button onClick={() => setOpen(true)}>Planifier</Button>}
        />
      ) : (
        <div className="space-y-6">
          {groups.map(([date, items]) => (
            <section key={date} className="space-y-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {dateLongFr(date)}
                {date === todayStr ? " · aujourd'hui" : ""}
              </h2>
              <div className="space-y-3">
                {items.map((a) => (
                  <div key={a.id} className="card-soft flex flex-wrap items-center gap-3 p-4">
                    <span className="rounded-lg bg-primary/10 px-2.5 py-1.5 font-display text-sm font-bold text-primary">
                      {a.scheduled_time ? a.scheduled_time.slice(0, 5) : "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold">
                        {appointmentLabel(a.type)}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {a.clients ? fullName(a.clients) : "Sans client"}
                        {a.notes ? ` · ${a.notes}` : ""}
                      </p>
                    </div>

                    {/* Status badge */}
                    {a.status === "honore" && (
                      <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                        Honoré
                      </span>
                    )}
                    {a.status === "annule" && (
                      <span className="rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive">
                        Annulé
                      </span>
                    )}

                    {a.clients && (
                      <ContactButtons
                        phone={a.clients.phone}
                        whatsapp={a.clients.whatsapp}
                        message={rappelMessage(a, business?.name)}
                      />
                    )}

                    <div className="flex items-center gap-1">
                      {a.status === "prevu" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => update.mutate({ id: a.id, status: "honore" })}
                        >
                          <Check className="mr-1 size-3.5" /> Honoré
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => update.mutate({ id: a.id, status: "prevu" })}
                        >
                          Repasser en prévu
                        </Button>
                      )}

                      {a.status !== "annule" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => update.mutate({ id: a.id, status: "annule" })}
                          aria-label="Annuler le rendez-vous"
                          title="Marquer comme annulé"
                        >
                          <X className="size-4" />
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingAppointment(a)}
                        aria-label="Modifier le rendez-vous"
                        title="Modifier"
                      >
                        <Pencil className="size-3.5" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setDeletingId(a.id)}
                        aria-label="Supprimer le rendez-vous"
                        title="Supprimer"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Confirmation suppression */}
      <AlertDialog open={Boolean(deletingId)} onOpenChange={(v) => !v && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce rendez-vous ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ce rendez-vous sera définitivement supprimé de votre calendrier.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletingId) remove.mutate(deletingId);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog Nouveau RDV */}
      {business && (
        <AppointmentDialog open={open} onOpenChange={setOpen} businessId={business.id} />
      )}

      {/* Dialog Modifier RDV */}
      {business && editingAppointment && (
        <EditAppointmentDialog
          open={Boolean(editingAppointment)}
          onOpenChange={(v) => !v && setEditingAppointment(null)}
          appointment={editingAppointment}
        />
      )}
    </div>
  );
}

function rappelMessage(a: { scheduled_date: string; scheduled_time: string | null; type: string }, atelier?: string | null) {
  const heure = a.scheduled_time ? ` à ${a.scheduled_time.slice(0, 5)}` : "";
  return `Bonjour, rappel de votre ${appointmentLabel(a.type).toLowerCase()} le ${dateLongFr(
    a.scheduled_date,
  )}${heure}. — ${atelier ?? "Votre atelier"}`;
}

function AppointmentDialog({
  open,
  onOpenChange,
  businessId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: string;
}) {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => fetchClients(), enabled: open });

  const create = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const { error } = await supabase.from("appointments").insert({
        business_id: businessId,
        client_id: values["client_id"] || null,
        scheduled_date: values["scheduled_date"] || today(),
        scheduled_time: values["scheduled_time"] || null,
        type: values["type"] || "essayage",
        notes: values["notes"] || null,
        status: "prevu",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Rendez-vous planifié");
      onOpenChange(false);
    },
    onError: () => toast.error("Enregistrement impossible"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau rendez-vous</DialogTitle>
          <DialogDescription>
            Essayage, prise de mesures, retouche ou livraison : gardez la trace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const values: Record<string, string> = {};
            fd.forEach((v, k) => {
              values[k] = String(v).trim();
            });
            create.mutate(values);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="client_id">Client</Label>
            <select
              id="client_id"
              name="client_id"
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="">Sans client</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="scheduled_date">Date *</Label>
              <Input
                id="scheduled_date"
                name="scheduled_date"
                type="date"
                required
                defaultValue={today()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scheduled_time">Heure</Label>
              <Input id="scheduled_time" name="scheduled_time" type="time" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="type">Motif</Label>
            <select
              id="type"
              name="type"
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Planifier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAppointmentDialog({
  open,
  onOpenChange,
  appointment,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  appointment: AppointmentRow;
}) {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => fetchClients(), enabled: open });

  const update = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const { error } = await supabase
        .from("appointments")
        .update({
          client_id: values["client_id"] || null,
          scheduled_date: values["scheduled_date"] || today(),
          scheduled_time: values["scheduled_time"] || null,
          type: values["type"] || "essayage",
          notes: values["notes"] || null,
          status: values["status"] || "prevu",
        })
        .eq("id", appointment.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Rendez-vous modifié");
      onOpenChange(false);
    },
    onError: () => toast.error("Modification impossible"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le rendez-vous</DialogTitle>
          <DialogDescription>
            Ajustez la date, l'heure ou le motif du rendez-vous.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const values: Record<string, string> = {};
            fd.forEach((v, k) => {
              values[k] = String(v).trim();
            });
            update.mutate(values);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="edit-client_id">Client</Label>
            <select
              id="edit-client_id"
              name="client_id"
              defaultValue={appointment.client_id ?? ""}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="">Sans client</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-scheduled_date">Date *</Label>
              <Input
                id="edit-scheduled_date"
                name="scheduled_date"
                type="date"
                required
                defaultValue={appointment.scheduled_date}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-scheduled_time">Heure</Label>
              <Input
                id="edit-scheduled_time"
                name="scheduled_time"
                type="time"
                defaultValue={appointment.scheduled_time ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-type">Motif</Label>
              <select
                id="edit-type"
                name="type"
                defaultValue={appointment.type}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                {APPOINTMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-status">Statut</Label>
              <select
                id="edit-status"
                name="status"
                defaultValue={appointment.status}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                {APPOINTMENT_STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea id="edit-notes" name="notes" rows={2} defaultValue={appointment.notes ?? ""} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
