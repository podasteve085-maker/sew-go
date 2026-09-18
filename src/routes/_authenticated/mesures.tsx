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
      if (!business?.id) throw new Error("Atelier non identifié");
      const { error } = await supabase
        .from("measurement_sets")
        .delete()
        .eq("id", setId)
        .eq("business_id", business.id);
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
    <div className="mx-auto max-w-5xl space-y-4 sm:space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Ruler className="size-5" />
            </span>
            <div className="flex items-center gap-2">
              <h1 className="page-title text-lg sm:text-2xl">Carnet de mesures</h1>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                {measurementsQuery.data?.length ?? 0}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Mensurations et fiches clients prêtes à partager sur WhatsApp.
          </p>
        </div>

        <Button
          onClick={() => {
            setSelectedSet(null);
            setModalMode("create");
            setOpenModal(true);
          }}
          className="h-9 font-bold text-xs sm:h-10 sm:text-sm shadow-xs"
        >
          <Plus className="mr-1 size-4" /> Nouveau relevé
        </Button>
      </header>

      {/* Barre de recherche et filtres */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Rechercher un client, téléphone ou modèle…"
            className="h-10 pl-9 pr-8 text-xs sm:text-sm"
          />
          {term && (
            <button
              onClick={() => setTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="size-3.5 hidden" />
              <span className="text-xs font-bold">✕</span>
            </button>
          )}
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedTemplate("all")}
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
              selectedTemplate === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            Tous les relevés
          </button>
          {(templatesQuery.data ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTemplate(t.name)}
              className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                selectedTemplate === t.name
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              Modèle {t.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedTemplate("custom")}
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
              selectedTemplate === "custom"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
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
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
          {filteredSets.map((set) => {
            const client = set.clients;
            const values = [...(set.measurement_values ?? [])].sort(
              (a, b) => a.position - b.position,
            );
            const initials = client
              ? `${client.first_name?.[0] ?? ""}${client.last_name?.[0] ?? ""}`.toUpperCase()
              : "CL";

            return (
              <div
                key={set.id}
                className="card-soft flex flex-col justify-between p-3.5 sm:p-5 transition-all hover:border-primary/40 hover:shadow-xs"
              >
                <div>
                  {/* Top bar with client info */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        {client ? (
                          <Link
                            to="/clients/$clientId"
                            params={{ clientId: client.id }}
                            className="block truncate font-display text-sm sm:text-base font-bold text-foreground hover:text-primary"
                          >
                            {fullName(client)}
                          </Link>
                        ) : (
                          <span className="block truncate font-display text-sm sm:text-base font-bold text-muted-foreground">
                            Client inconnu
                          </span>
                        )}
                        <p className="truncate text-[0.7rem] sm:text-xs text-muted-foreground">
                          {client?.phone ? `${client.phone} · ` : ""}
                          {dateFr(set.recorded_at)}
                        </p>
                      </div>
                    </div>

                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[0.7rem] sm:text-xs font-bold text-primary">
                      {set.template_name || set.label || "Sur mesure"}
                    </span>
                  </div>

                  {/* Measurement Values Grid */}
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border/70 pt-2.5 sm:grid-cols-3">
                    {values.slice(0, 9).map((v) => (
                      <div
                        key={v.id}
                        className="flex items-baseline justify-between gap-1.5 border-b border-dashed border-border/50 pb-1"
                      >
                        <dt className="truncate text-[0.7rem] sm:text-xs text-muted-foreground" title={v.name}>
                          {v.name}
                        </dt>
                        <dd className="font-mono text-xs font-bold text-foreground">
                          {v.value ?? "—"} {v.value !== null ? v.unit : ""}
                        </dd>
                      </div>
                    ))}
                    {values.length > 9 && (
                      <div className="col-span-2 text-right sm:col-span-3">
                        <span className="text-[0.65rem] italic text-muted-foreground">
                          +{values.length - 9} autre(s) mesure(s)…
                        </span>
                      </div>
                    )}
                  </dl>

                  {set.notes && (
                    <p className="mt-2.5 rounded-lg bg-surface px-2.5 py-1.5 text-[0.7rem] sm:text-xs text-muted-foreground">
                      💬 {set.notes}
                    </p>
                  )}
                </div>

                {/* Actions Footer */}
                <div className="mt-3.5 flex items-center justify-between gap-1.5 border-t border-border/70 pt-2.5">
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 sm:h-8 px-2.5 text-xs text-success border-success/30 bg-success/10 hover:bg-success/20 hover:text-success"
                      onClick={() => shareViaWhatsApp(set)}
                      title="Partager par WhatsApp au client"
                    >
                      <MessageCircle className="mr-1 size-3.5" /> WhatsApp
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 sm:h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedSet(set);
                        setModalMode("copy");
                        setOpenModal(true);
                      }}
                      title="Reprendre ce relevé pour de nouvelles mesures"
                    >
                      <Copy className="mr-1 size-3" /> Reprendre
                    </Button>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-7 sm:size-8 p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                      className="size-7 sm:size-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
