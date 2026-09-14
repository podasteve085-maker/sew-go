import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Plus,
  Search,
  Scissors,
  Coins,
  Share2,
  Trash2,
  Edit,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import {
  fetchCatalogModels,
  deleteCatalogModel,
  type CatalogModelRow,
} from "@/lib/queries";
import { CATALOG_CATEGORIES, catalogCategoryLabel } from "@/lib/domain";
import { fcfa } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StoredImage, EmptyState, SectionTitle } from "@/components/bits";
import { CatalogModelDialog } from "@/components/catalog-model-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/catalogue")({
  head: () => ({
    meta: [
      { title: "Catalogue & Lookbook — CouturPro" },
      {
        name: "description",
        content:
          "Catalogue de modèles, créations et lookbook pour atelier de couture au Burkina Faso.",
      },
    ],
  }),
  component: CataloguePage,
});

export function CataloguePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<CatalogModelRow | null>(null);

  // Mode Présentation Plein Écran pour le client
  const [presentationModel, setPresentationModel] = useState<CatalogModelRow | null>(null);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  const modelsQuery = useQuery({
    queryKey: ["catalog-models", selectedCategory],
    queryFn: () => fetchCatalogModels(selectedCategory),
  });

  const allModels = modelsQuery.data ?? [];

  // Filtrage par texte de recherche
  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return allModels;
    const q = searchQuery.toLowerCase().trim();
    return allModels.filter((m) => {
      const matchName = m.name.toLowerCase().includes(q);
      const matchDesc = (m.description ?? "").toLowerCase().includes(q);
      const matchFabric = (m.fabric_needed ?? "").toLowerCase().includes(q);
      const matchTags = (m.tags ?? []).some((t) => t.toLowerCase().includes(q));
      const matchCategory = catalogCategoryLabel(m.category).toLowerCase().includes(q);
      return matchName || matchDesc || matchFabric || matchTags || matchCategory;
    });
  }, [allModels, searchQuery]);

  // Compteurs par catégorie
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allModels.length };
    for (const m of allModels) {
      counts[m.category] = (counts[m.category] || 0) + 1;
    }
    return counts;
  }, [allModels]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCatalogModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-models"] });
      toast.success("Modèle retiré du catalogue");
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Erreur lors de la suppression";
      toast.error(msg);
    },
  });

  function handleEdit(model: CatalogModelRow) {
    setEditingModel(model);
    setDialogOpen(true);
  }

  function handleCreate() {
    setEditingModel(null);
    setDialogOpen(true);
  }

  function openPresentation(model: CatalogModelRow) {
    setPresentationModel(model);
    setCurrentPhotoIndex(0);
  }

  function handleShareWhatsApp(model: CatalogModelRow) {
    const priceText = model.default_price ? ` — ${fcfa(model.default_price)}` : "";
    const fabricText = model.fabric_needed ? `\nTissu recommandé : ${model.fabric_needed}` : "";
    const descText = model.description ? `\n${model.description}` : "";
    const text = `✨ *${business?.name ?? "CouturPro"} — Modèle : ${model.name}*${priceText}${fabricText}${descText}\n\nConfection sur mesure disponible dans notre atelier !`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  }

  function handleOrderFromModel(model: CatalogModelRow) {
    const search: {
      client?: string | undefined;
      model?: string | undefined;
      garment?: string | undefined;
      price?: string | undefined;
      fabric?: string | undefined;
    } = {
      model: model.id,
      garment: model.name,
    };
    if (model.default_price) {
      search.price = String(model.default_price);
    }
    if (model.fabric_needed) {
      search.fabric = model.fabric_needed;
    }
    navigate({
      to: "/commandes/nouvelle",
      search,
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6">
      {/* En-tête de la page */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpen className="size-5" />
            </span>
            <div className="flex items-center gap-2">
              <h1 className="page-title text-lg sm:text-2xl">Catalogue & Lookbook</h1>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                {allModels.length}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Vos modèles confections prêts à présenter et à commander en 1 clic.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {allModels.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openPresentation(allModels[0]!)}
              className="h-9 text-xs font-semibold sm:h-10 sm:text-sm"
            >
              <Eye className="mr-1.5 size-4 text-primary" /> Mode Client
            </Button>
          )}
          <Button
            onClick={handleCreate}
            size="sm"
            className="h-9 text-xs font-bold sm:h-10 sm:text-sm shadow-xs"
          >
            <Plus className="mr-1.5 size-4" /> Nouveau modèle
          </Button>
        </div>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par nom, tissu (ex: Bazin, Faso Dan Fani, Robe)..."
            className="h-10 pl-9 pr-8 text-xs sm:text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Puces de filtrage par catégorie */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
              selectedCategory === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            <span>🌟 Tous</span>
            <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[0.68rem]">
              {categoryCounts["all"] ?? 0}
            </span>
          </button>

          {CATALOG_CATEGORIES.map((c) => {
            const count = categoryCounts[c.value] ?? 0;
            const active = selectedCategory === c.value;
            return (
              <button
                key={c.value}
                onClick={() => setSelectedCategory(c.value)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <span>
                  {c.icon} {c.label.split("&")[0]?.trim()}
                </span>
                {count > 0 && (
                  <span className="rounded-full bg-background/20 px-1.5 py-0.2 text-[0.68rem]">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grille des modèles */}
      {modelsQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 sm:gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="card-soft h-52 sm:h-64 animate-pulse bg-muted/60" />
          ))}
        </div>
      ) : filteredModels.length === 0 ? (
        <EmptyState
          title={
            searchQuery
              ? "Aucun modèle ne correspond"
              : "Votre catalogue est encore vide"
          }
          text={
            searchQuery
              ? "Essayez un autre mot-clé ou réinitialisez la recherche."
              : "Ajoutez vos plus belles confections (Boubou, Faso Dan Fani, Robes...) pour les présenter facilement à vos clients."
          }
          action={
            <Button onClick={handleCreate} className="font-bold">
              <Plus className="mr-1.5 size-4" /> Ajouter un modèle
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 sm:gap-4">
          {filteredModels.map((model) => {
            const hasPhotos = model.photo_paths && model.photo_paths.length > 0;
            const coverPhoto = hasPhotos ? model.photo_paths[0] : null;

            return (
              <div
                key={model.id}
                className="card-soft group flex flex-col justify-between overflow-hidden border border-border transition-all hover:border-primary/50 hover:shadow-md"
              >
                {/* Image de couverture ou visuel par défaut */}
                <div
                  onClick={() => openPresentation(model)}
                  className="relative aspect-square sm:aspect-4/3 w-full cursor-pointer overflow-hidden bg-muted transition-transform group-hover:opacity-95"
                >
                  {coverPhoto ? (
                    <StoredImage
                      path={coverPhoto}
                      alt={model.name}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-1 bg-primary/5 text-primary/70">
                      <Scissors className="size-6 sm:size-8 stroke-[1.5]" />
                      <span className="text-[0.65rem] sm:text-[0.7rem] font-bold">Sans photo</span>
                    </div>
                  )}

                  {/* Badge de catégorie */}
                  <span className="absolute top-1.5 left-1.5 rounded-full bg-black/60 backdrop-blur px-2 py-0.5 text-[0.62rem] font-bold text-white shadow-xs">
                    {catalogCategoryLabel(model.category)}
                  </span>

                  {/* Indicateur multi-photos */}
                  {model.photo_paths && model.photo_paths.length > 1 && (
                    <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[0.6rem] font-bold text-white backdrop-blur">
                      +{model.photo_paths.length - 1}
                    </span>
                  )}

                  {/* Bouton rapide d'agrandissement */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPresentation(model);
                    }}
                    className="absolute top-1.5 right-1.5 flex size-6.5 items-center justify-center rounded-full bg-black/50 text-white opacity-90 sm:opacity-0 transition-opacity hover:bg-black group-hover:opacity-100"
                    title="Voir en plein écran"
                  >
                    <Eye className="size-3" />
                  </button>
                </div>

                {/* Contenu de la fiche modèle */}
                <div className="flex flex-1 flex-col p-2.5 sm:p-3.5">
                  <div className="flex-1">
                    <h3 className="font-display text-xs sm:text-sm font-bold text-foreground line-clamp-1">
                      {model.name}
                    </h3>

                    {model.description && (
                      <p className="mt-0.5 text-[0.7rem] sm:text-xs text-muted-foreground line-clamp-1">
                        {model.description}
                      </p>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[0.7rem] sm:text-xs">
                      {model.default_price ? (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-bold text-primary">
                          <Coins className="size-2.5 sm:size-3" /> {fcfa(model.default_price)}
                        </span>
                      ) : null}

                      {model.fabric_needed && (
                        <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground truncate max-w-[110px]">
                          🧵 {model.fabric_needed}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Boutons d'action sous la carte */}
                  <div className="mt-2.5 flex items-center justify-between gap-1 border-t border-border/70 pt-2">
                    <Button
                      size="sm"
                      onClick={() => handleOrderFromModel(model)}
                      className="h-7 sm:h-8 flex-1 text-[0.7rem] sm:text-xs font-bold px-1.5"
                    >
                      <Scissors className="mr-1 size-3" /> Commander
                    </Button>

                    <button
                      type="button"
                      onClick={() => handleShareWhatsApp(model)}
                      title="WhatsApp"
                      className="flex size-7 sm:size-8 shrink-0 items-center justify-center rounded-md border border-success/30 bg-success/10 text-success transition-all hover:bg-success/20 active:scale-95"
                    >
                      <Share2 className="size-3 sm:size-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleEdit(model)}
                      title="Modifier"
                      className="flex size-7 sm:size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95"
                    >
                      <Edit className="size-3 sm:size-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Voulez-vous retirer le modèle "${model.name}" ?`)) {
                          deleteMutation.mutate(model.id);
                        }
                      }}
                      title="Supprimer"
                      className="flex size-7 sm:size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-all hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive active:scale-95"
                    >
                      <Trash2 className="size-3 sm:size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog d'ajout / édition */}
      <CatalogModelDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setEditingModel(null);
        }}
        model={editingModel}
      />

      {/* Mode Présentation Plein Écran pour le client */}
      {presentationModel && (
        <Dialog open={Boolean(presentationModel)} onOpenChange={() => setPresentationModel(null)}>
          <DialogContent className="max-h-[95vh] max-w-2xl overflow-hidden p-0 bg-card border-border">
            <div className="relative flex flex-col">
              {/* Grand affichage photo */}
              <div className="relative aspect-4/3 sm:aspect-16/10 w-full bg-black/90 flex items-center justify-center overflow-hidden">
                {presentationModel.photo_paths && presentationModel.photo_paths.length > 0 ? (
                  <StoredImage
                    path={presentationModel.photo_paths[currentPhotoIndex] || presentationModel.photo_paths[0]}
                    alt={presentationModel.name}
                    className="size-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-white/60">
                    <Scissors className="size-16" />
                    <p className="text-sm">Pas de photo disponible</p>
                  </div>
                )}

                {/* Navigation entre photos */}
                {presentationModel.photo_paths && presentationModel.photo_paths.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPhotoIndex((prev) =>
                          prev === 0 ? presentationModel.photo_paths.length - 1 : prev - 1,
                        )
                      }
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black"
                    >
                      <ChevronLeft className="size-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPhotoIndex((prev) =>
                          prev === presentationModel.photo_paths.length - 1 ? 0 : prev + 1,
                        )
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black"
                    >
                      <ChevronRight className="size-5" />
                    </button>

                    {/* Indicateurs pastilles */}
                    <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
                      {presentationModel.photo_paths.map((_, i) => (
                        <span
                          key={i}
                          className={`size-2 rounded-full transition-all ${
                            i === currentPhotoIndex ? "bg-white scale-125" : "bg-white/40"
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Bouton fermer */}
                <button
                  type="button"
                  onClick={() => setPresentationModel(null)}
                  className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Détails du modèle */}
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                      {catalogCategoryLabel(presentationModel.category)}
                    </span>
                    <h2 className="mt-1 font-display text-lg sm:text-xl font-bold text-foreground">
                      {presentationModel.name}
                    </h2>
                  </div>
                  {presentationModel.default_price && (
                    <div className="text-right">
                      <p className="text-[0.65rem] uppercase font-bold text-muted-foreground">
                        Prix indicatif
                      </p>
                      <p className="font-display text-lg sm:text-xl font-bold text-primary">
                        {fcfa(presentationModel.default_price)}
                      </p>
                    </div>
                  )}
                </div>

                {presentationModel.fabric_needed && (
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <span>🧵 Tissu recommandé :</span>
                    <span className="font-bold text-foreground">
                      {presentationModel.fabric_needed}
                    </span>
                  </p>
                )}

                {presentationModel.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                    {presentationModel.description}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                  <Button
                    size="lg"
                    onClick={() => {
                      setPresentationModel(null);
                      handleOrderFromModel(presentationModel);
                    }}
                    className="flex-1 font-bold h-11"
                  >
                    <Scissors className="mr-2 size-4" /> Choisir ce modèle pour une commande
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => handleShareWhatsApp(presentationModel)}
                    className="h-11 font-semibold"
                  >
                    <Share2 className="mr-1.5 size-4 text-success" /> Partager
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
