import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fetchAppointments, fetchClients } from "@/lib/queries";
import { APPOINTMENT_TYPES, appointmentLabel } from "@/lib/domain";
import { dateLongFr, fullName, today, waLink } from "@/lib/format";
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
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();
  const appointments = useQuery({
    queryKey: ["appointments", {}],
    queryFn: () => fetchAppointments(),
  });

  const groups = useMemo(() => {
    const list = (appointments.data ?? []).filter((a) => a.status !== "annule");
    const map = new Map<string, typeof list>();
    for (const a of list) {
      const arr = map.get(a.scheduled_date) ?? [];
      arr.push(a);
      map.set(a.scheduled_date, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [appointments.data]);

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
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
    },
  });

  const todayStr = today();

  return (
    <div className="space-y-6">
      <SectionTitle
        action={
          <Button onClick={() => setOpen(true)}>
            <CalendarPlus className="size-4" /> Nouveau rendez-vous
          </Button>
        }
      >
        Rendez-vous
      </SectionTitle>

      {appointments.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Aucun rendez-vous"
          text="Planifiez un essayage ou une prise de mesures pour ne rien oublier."
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
                          <Check className="size-4" /> Honoré
                        </Button>
                      ) : (
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">Honoré</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => update.mutate({ id: a.id, status: "annule" })}
                        aria-label="Annuler"
                      >
                        <X className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => remove.mutate(a.id)}
                        aria-label="Supprimer"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {business && (
        <AppointmentDialog open={open} onOpenChange={setOpen} businessId={business.id} />
      )}
    </div>
  );
}

function rappelMessage(
  a: { type: string; scheduled_date: string; scheduled_time: string | null },
  atelier?: string,
) {
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
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
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
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
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
              {create.isPending && <Loader2 className="size-4 animate-spin" />} Planifier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { waLink };
