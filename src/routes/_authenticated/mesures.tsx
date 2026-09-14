import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ruler,
  Plus,
  Search,
  MessageCircle,
  Copy,
  Pencil,
  Trash2,
  Printer,
  User,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import {
  fetchAllMeasurementSets,
  fetchTemplates,
  type FullMeasurementSetRow,
} from "@/lib/queries";
import { dateFr, fullName, cleanPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { EmptyState, SectionTitle } from "@/components/bits";
import { MeasurementDialog } from "@/components/measurement-dialog";

export const Route = createFileRoute("/_authenticated/mesures")({
  head: () => ({
    meta: [
      { title: "Carnet de mesures — CouturPro" },
      {
        name: "description",
        content:
          "Carnet de mesures numérique de votre atelier : mensurations de vos clients, modèles Homme, Femme, Enfant, et partage WhatsApp.",
      },
      { property: "og:title", content: "Carnet de mesures — CouturPro" },
      {
        property: "og:description",
        content: "Consultez, enregistrez et partagez les mesures de vos clients.",
      },
    ],
  }),
  component: MeasurementsPage,
});

function MeasurementsPage() {
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();

  const [term, setTerm] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("all");
  const [openModal, setOpenModal] = useState(false);
  const [selectedSet, setSelectedSet] = useState<FullMeasurementSetRow | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit" | "copy">("create");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const measurementsQuery = useQuery({
    queryKey: ["measurements"],
    queryFn: fetchAllMeasurementSets,
  });

  const templatesQuery = useQuery({
    queryKey: ["templates"],
    queryFn: fetchTemplates,
  });

  const deleteSetMutation = useMutation({
    mutationFn: async (setId: string) => {
      const { error } = await supabase.from("measurement_sets").delete().eq("id", setId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["measurements"] });
      toast.success("Relevé de mesures supprimé");
      setDeletingId(null);
    },
    onError: () => toast.error("Impossible de supprimer ce relevé"),
  });

  const filteredSets = useMemo(() => {
    const list = measurementsQuery.data ?? [];
    return list.filter((set) => {
      // Filter by template
      if (selectedTemplate !== "all") {
        if (selectedTemplate === "custom" && set.template_name) return false;
        if (selectedTemplate !== "custom" && set.template_name !== selectedTemplate) return false;
      }

      // Filter by search query
      if (term.trim()) {
        const q = term.trim().toLowerCase();
        const clientName = fullName(set.clients).toLowerCase();
        const clientPhone = (set.clients?.phone ?? "").toLowerCase();
        const label = (set.label ?? "").toLowerCase();
        const tpl = (set.template_name ?? "").toLowerCase();
        return (
          clientName.includes(q) ||
          clientPhone.includes(q) ||
          label.includes(q) ||
          tpl.includes(q)
        );
      }

      return true;
    });
  }, [measurementsQuery.data, selectedTemplate, term]);

  // Génération du texte WhatsApp des mesures
  function shareViaWhatsApp(set: FullMeasurementSetRow) {
    const client = set.clients;
    const phone = cleanPhone(client?.whatsapp || client?.phone || "");
    const atelier = business?.name ?? "votre atelier";
    const values = (set.measurement_values ?? [])
      .sort((a, b) => a.position - b.position)
      .map((v) => `• ${v.name} : ${v.value ?? "—"} ${v.unit}`)
      .join("\n");

    const message = `Bonjour ${client?.first_name ?? ""},\nVoici votre fiche de mesures enregistrée chez *${atelier}* (${set.template_name || set.label || "Relevé"} du ${dateFr(set.recorded_at)}) :\n\n${values}\n\n${set.notes ? `_Note : ${set.notes}_\n\n` : ""}Merci de votre fidélité ! ✂️`;

    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    window.open(url, "_blank");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Ruler className="size-6 text-primary" /> Carnet de mesures
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {measurementsQuery.data?.length ?? 0} relevé(s) de mesures enregistré(s)
          </p>
        </div>

        <Button
          onClick={() => {
            setSelectedSet(null);
            setModalMode("create");
            setOpenModal(true);
          }}
        >
          <Plus className="size-4" /> Nouveau relevé
        </Button>
      </header>

      {/* Barre de recherche et filtres */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Rechercher par client, téléphone ou modèle…"
            className="pl-9"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedTemplate("all")}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              selectedTemplate === "all"
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            Tous les relevés
          </button>
          {(templatesQuery.data ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTemplate(t.name)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                selectedTemplate === t.name
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              Modèle {t.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedTemplate("custom")}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              selectedTemplate === "custom"
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            Sur mesure
          </button>
        </div>
      </div>

      {/* Liste des relevés */}
      {measurementsQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : filteredSets.length === 0 ? (
        <EmptyState
          title={term ? "Aucun relevé trouvé" : "Aucun relevé de mesures"}
          text={
            term
              ? "Essayez une autre recherche."
              : "Prenez les mesures d'un client avec l'un de vos modèles (Homme, Femme, Enfant) pour commencer son carnet numérique."
          }
          action={
            <Button
              onClick={() => {
                setSelectedSet(null);
                setModalMode("create");
                setOpenModal(true);
              }}
            >
              <Plus className="size-4" /> Prendre les mesures
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredSets.map((set) => {
            const client = set.clients;
            const values = [...(set.measurement_values ?? [])].sort(
              (a, b) => a.position - b.position,
            );

            return (
              <div
                key={set.id}
                className="card-soft flex flex-col justify-between p-5 transition-colors hover:border-primary/40"
              >
                <div>
                  {/* Top bar with client info */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {client ? (
                        <Link
                          to="/clients/$clientId"
                          params={{ clientId: client.id }}
                          className="font-display text-base font-bold text-foreground hover:text-primary"
                        >
                          {fullName(client)}
                        </Link>
                      ) : (
                        <span className="font-display text-base font-bold text-muted-foreground">
                          Client inconnu
                        </span>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {client?.phone ? `${client.phone} · ` : ""}
                        Relevé du {dateFr(set.recorded_at)}
                      </p>
                    </div>

                    <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      {set.template_name || set.label || "Sur mesure"}
                    </span>
                  </div>

                  {/* Measurement Values Grid */}
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-3">
                    {values.slice(0, 9).map((v) => (
                      <div
                        key={v.id}
                        className="flex items-baseline justify-between gap-2 border-b border-dashed border-border/70 pb-1"
                      >
                        <dt className="truncate text-xs text-muted-foreground" title={v.name}>
                          {v.name}
                        </dt>
                        <dd className="font-mono text-xs font-bold text-foreground">
                          {v.value ?? "—"} {v.value !== null ? v.unit : ""}
                        </dd>
                      </div>
                    ))}
                    {values.length > 9 && (
                      <div className="col-span-2 text-right sm:col-span-3">
                        <span className="text-[0.7rem] italic text-muted-foreground">
                          +{values.length - 9} autre(s) mesure(s)…
                        </span>
                      </div>
                    )}
                  </dl>

                  {set.notes && (
                    <p className="mt-3 rounded-lg bg-surface p-2.5 text-xs text-muted-foreground">
                      💬 {set.notes}
                    </p>
                  )}
                </div>

                {/* Actions Footer */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs text-success hover:bg-success/10 hover:text-success"
                      onClick={() => shareViaWhatsApp(set)}
                      title="Partager par WhatsApp au client"
                    >
                      <MessageCircle className="mr-1.5 size-3.5" /> WhatsApp
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedSet(set);
                        setModalMode("copy");
                        setOpenModal(true);
                      }}
                      title="Reprendre ce relevé pour de nouvelles mesures"
                    >
                      <Copy className="mr-1 size-3.5" /> Reprendre
                    </Button>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedSet(set);
                        setModalMode("edit");
                        setOpenModal(true);
                      }}
                      title="Modifier les valeurs"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeletingId(set.id)}
                      title="Supprimer ce relevé"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation de suppression */}
      <AlertDialog open={Boolean(deletingId)} onOpenChange={(v) => !v && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce relevé de mesures ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ce relevé sera définitivement effacé du carnet de mesures de votre atelier.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletingId) deleteSetMutation.mutate(deletingId);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modale de gestion des mesures */}
      {business && (
        <MeasurementDialog
          open={openModal}
          onOpenChange={setOpenModal}
          businessId={business.id}
          initialSet={selectedSet}
          mode={modalMode}
        />
      )}
    </div>
  );
}
