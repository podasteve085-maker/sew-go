import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  ChevronLeft,
  ChevronRight,
  X,
  Copy,
  MessageCircle,
  ExternalLink,
  Sparkles,
  Zap,
  LayoutGrid,
  Grid3X3,
  ArrowUpDown,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useBusiness } from "@/hooks/use-business";
import { checkCatalogPhotosQuota } from "@/lib/quotas";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import {
  fetchCatalogModels,
  deleteCatalogModel,
  type CatalogModelRow,
} from "@/lib/queries";
import {
  CATALOG_CATEGORIES,
  catalogCategoryLabel,
  catalogShareMessage,
  copyTextToClipboard,
  lookbookAbsoluteUrl,
  openWhatsAppShare,
} from "@/lib/domain";
import { fcfa } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StoredImage, EmptyState } from "@/components/bits";
import { CatalogModelDialog } from "@/components/catalog-model-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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

export const Route = createFileRoute("/_authenticated/catalogue")({
  head: () => ({
    meta: [
      { title: "Catalogue & Lookbook — CouturPro" },
      {
        name: "description",
        content:
          "Catalogue de modèles, créations et lookbook pour ateliers de couture et créateurs de mode.",
      },
    ],
  }),
  component: CataloguePage,
});

function CataloguePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<CatalogModelRow | null>(null);
  const [modelToDelete, setModelToDelete] = useState<CatalogModelRow | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"grid" | "compact">("grid");
  const [sortBy, setSortBy] = useState<"newest" | "name" | "price_asc" | "price_desc">("newest");
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  // Mode Présentation Plein Écran pour le client
  const [presentationModel, setPresentationModel] = useState<CatalogModelRow | null>(null);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  const modelsQuery = useQuery({
    queryKey: ["catalog-models", business?.id],
    queryFn: () => fetchCatalogModels("all", business?.id),
    enabled: Boolean(business?.id),
  });

  const allModels = modelsQuery.data ?? [];

  // Calcul du nombre total de photos insérées tous modèles et catalogues confondus
  const totalCatalogPhotos = useMemo(() => {
    return allModels.reduce((acc, m) => acc + (m.photo_paths?.length || 0), 0);
  }, [allModels]);

  const quotaInfo = checkCatalogPhotosQuota(business, totalCatalogPhotos);

  // Filtrage par texte de recherche et catégorie
  const filteredModels = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allModels.filter((m) => {
      const matchCategory = selectedCategory === "all" || m.category === selectedCategory;
      if (!matchCategory) return false;
      if (!q) return true;
      const matchName = m.name.toLowerCase().includes(q);
      const matchDesc = (m.description ?? "").toLowerCase().includes(q);
      const matchFabric = (m.fabric_needed ?? "").toLowerCase().includes(q);
      const matchTags = (m.tags ?? []).some((t) => t.toLowerCase().includes(q));
      const matchCategoryLabel = catalogCategoryLabel(m.category).toLowerCase().includes(q);
      return matchName || matchDesc || matchFabric || matchTags || matchCategoryLabel;
    });
  }, [allModels, searchQuery, selectedCategory]);

  // Tri multi-critères
  const sortedAndFilteredModels = useMemo(() => {
    const list = [...filteredModels];
    if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "price_asc") {
      list.sort((a, b) => (Number(a.default_price) || 0) - (Number(b.default_price) || 0));
    } else if (sortBy === "price_desc") {
      list.sort((a, b) => (Number(b.default_price) || 0) - (Number(a.default_price) || 0));
    } else {
      // plus récents
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [filteredModels, sortBy]);

  // Compteurs par catégorie
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allModels.length };
    for (const m of allModels) {
      counts[m.category] = (counts[m.category] || 0) + 1;
    }
    return counts;
  }, [allModels]);

  // Handlers pour le swipe tactile sur smartphone dans la visionneuse
  function handleTouchStart(e: React.TouchEvent) {
    setTouchStartX(e.touches[0]?.clientX ?? null);
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX === null || !presentationModel || !presentationModel.photo_paths || presentationModel.photo_paths.length <= 1) {
      setTouchStartX(null);
      return;
    }
    const touchEndX = e.changedTouches[0]?.clientX ?? 0;
    const diff = touchEndX - touchStartX;
    const SWIPE_THRESHOLD = 45;

    if (diff > SWIPE_THRESHOLD) {
      // Glissement droite -> photo précédente
      setCurrentPhotoIndex((prev) => (prev === 0 ? presentationModel.photo_paths.length - 1 : prev - 1));
    } else if (diff < -SWIPE_THRESHOLD) {
      // Glissement gauche -> photo suivante
      setCurrentPhotoIndex((prev) => (prev === presentationModel.photo_paths.length - 1 ? 0 : prev + 1));
    }
    setTouchStartX(null);
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCatalogModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-models"] });
      queryClient.invalidateQueries({ queryKey: ["public-catalog-models"] });
      toast.success("Modèle supprimé avec succès du catalogue");
      setModelToDelete(null);
      if (presentationModel) setPresentationModel(null);
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

  function catalogPublicUrl(modelId?: string) {
    if (!business?.id) {
      toast.error("Atelier introuvable. Rechargez la page puis réessayez.");
      return null;
    }
    return lookbookAbsoluteUrl(business.id, modelId);
  }

  async function handleShareWhatsApp(model: CatalogModelRow) {
    const publicUrl = catalogPublicUrl(model.id);
    if (!publicUrl) return;
    const priceText = model.default_price
      ? `Prix indicatif : ${fcfa(model.default_price, business?.currency)}`
      : null;
    const text = catalogShareMessage({
      atelierName: business?.name ?? "Notre atelier",
      publicUrl,
      modelName: model.name,
      priceText,
    });
    await openWhatsAppShare(text, publicUrl);
    toast.success("WhatsApp ouvert. Le message contient le lien du lookbook.");
  }

  async function handleShareFullCatalogWhatsApp() {
    const publicUrl = catalogPublicUrl();
    if (!publicUrl) return;
    const text = catalogShareMessage({
      atelierName: business?.name ?? "Notre atelier",
      publicUrl,
    });
    await openWhatsAppShare(text, publicUrl);
    toast.success("WhatsApp ouvert. Le message contient le lien du catalogue.");
  }

  async function handleCopyCatalogLink(modelId?: string) {
    const publicUrl = catalogPublicUrl(modelId);
    if (!publicUrl) return;
    const ok = await copyTextToClipboard(publicUrl);
    if (ok) {
      toast.success("Lien copié. Envoyez-le au client : il ouvre le lookbook.");
    } else {
      toast.error("Impossible de copier le lien");
    }
  }

  function handlePreviewAsClient() {
    const publicUrl = catalogPublicUrl();
    if (!publicUrl) return;
    window.open(publicUrl, "_blank", "noopener,noreferrer");
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
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title text-lg sm:text-2xl">Catalogue & Lookbook</h1>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                {allModels.length} modèle(s)
              </span>

              {/* Badge de quota photo en direct */}
              {quotaInfo.isUnlimited ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 shadow-2xs">
                  <Sparkles className="size-3" /> Photos illimitées ({totalCatalogPhotos})
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setUpgradeOpen(true)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-all hover:scale-105 active:scale-95 ${
                    totalCatalogPhotos >= 200
                      ? "bg-destructive/15 text-destructive border-destructive/30"
                      : totalCatalogPhotos >= 170
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                      : "bg-primary/10 text-primary border-primary/20"
                  }`}
                  title="Quota photos de votre formule Mensuelle. Cliquez pour débloquer l'illimité !"
                >
                  <Zap className="size-3" /> {totalCatalogPhotos} / 200 photos
                  <span className="text-[10px] underline font-semibold ml-0.5">Illimité ✨</span>
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Vos modèles confections prêts à présenter et à partager avec vos clients.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviewAsClient}
              className="h-11 sm:h-10 text-xs sm:text-sm font-semibold rounded-xl"
              title="Ouvrir le lookbook tel que le client le voit"
            >
              <ExternalLink className="mr-1.5 size-4" /> Mode client
            </Button>
            <Button
              onClick={handleCreate}
              size="sm"
              className="h-11 sm:h-10 text-xs font-bold sm:text-sm shadow-xs rounded-xl"
            >
              <Plus className="mr-1.5 size-4" /> Nouveau modèle
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleShareFullCatalogWhatsApp()}
              className="h-11 sm:h-10 flex-1 sm:flex-none text-xs sm:text-sm font-bold rounded-xl border-success/40 bg-success text-success-foreground hover:bg-success/90 shadow-xs"
              title="Envoyer le lien du catalogue au client"
            >
              <MessageCircle className="mr-1.5 size-4" /> Envoyer le catalogue
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void handleCopyCatalogLink()}
              className="size-11 sm:size-10 rounded-xl shrink-0"
              title="Copier le lien du catalogue"
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Alerte si le quota de 200 photos est atteint pour le forfait Mensuel */}
      {!quotaInfo.isUnlimited && totalCatalogPhotos >= 200 && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-300">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive text-white font-black text-sm">
              !
            </span>
            <div>
              <p className="text-xs sm:text-sm font-bold text-destructive">
                Plafond de 200 photos de catalogue atteint (Forfait Pro Mensuel)
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Vos confections restent 100% consultables et partageables. Pour ajouter de nouveaux modèles et photos sans aucune limite, passez au Pass Trimestriel (5 000 F) ou Annuel.
              </p>
            </div>
          </div>
          <Button
            onClick={() => setUpgradeOpen(true)}
            className="shrink-0 font-bold h-9 text-xs bg-primary text-primary-foreground shadow-xs"
          >
            <Sparkles className="mr-1.5 size-3.5" /> Débloquer les photos illimitées
          </Button>
        </div>
      )}

      {/* Barre de recherche, tri et filtres */}
      <div className="space-y-2.5">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par nom, tissu (ex: Bazin, Faso Dan Fani, Robe)..."
              className="h-11 pl-9 pr-8 text-base sm:text-sm rounded-xl"
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

          {/* Contrôles de tri et de disposition */}
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            {/* Sélecteur de tri */}
            <div className="relative flex items-center">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-11 rounded-xl border border-border bg-card pl-3 pr-8 text-xs font-semibold text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary shadow-2xs"
                aria-label="Trier les modèles"
              >
                <option value="newest">🕒 Plus récents</option>
                <option value="name">🔤 Nom (A-Z)</option>
                <option value="price_asc">💰 Prix croissant</option>
                <option value="price_desc">💎 Prix décroissant</option>
              </select>
            </div>

            {/* Bascule de disposition Grille vs Compact */}
            <div className="flex items-center rounded-xl border border-border bg-card p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setLayoutMode("grid")}
                className={`flex size-10 items-center justify-center rounded-lg transition-all ${
                  layoutMode === "grid"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Affichage cartes visuelles"
              >
                <LayoutGrid className="size-4.5" />
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode("compact")}
                className={`flex size-10 items-center justify-center rounded-lg transition-all ${
                  layoutMode === "compact"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Affichage compact dense"
              >
                <Grid3X3 className="size-4.5" />
              </button>
            </div>
          </div>
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
        <div
          className={
            layoutMode === "grid"
              ? "grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4"
              : "grid grid-cols-2 min-[540px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3"
          }
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="card-soft h-52 sm:h-64 animate-pulse bg-muted/60" />
          ))}
        </div>
      ) : sortedAndFilteredModels.length === 0 ? (
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
        <div
          className={
            layoutMode === "grid"
              ? "grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4"
              : "grid grid-cols-2 min-[540px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3"
          }
        >
          {sortedAndFilteredModels.map((model) => {
            const hasPhotos = model.photo_paths && model.photo_paths.length > 0;
            const coverPhoto = hasPhotos ? model.photo_paths[0] : null;

            return (
              <div
                key={model.id}
                className="card-soft group flex flex-col justify-between overflow-hidden border border-border transition-all hover:border-primary/50 hover:shadow-md"
              >
                {/* Image de couverture ou visuel par défaut avec barre d'action visible */}
                <div
                  onClick={() => openPresentation(model)}
                  className={`relative w-full cursor-pointer overflow-hidden bg-muted transition-transform group-hover:opacity-95 ${
                    layoutMode === "grid" ? "aspect-square sm:aspect-4/3" : "aspect-square"
                  }`}
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

                  {/* Badge de catégorie (en haut à gauche) */}
                  <span className="absolute top-2 left-2 rounded-full bg-black/65 backdrop-blur-md px-2.5 py-0.5 text-[0.65rem] font-bold text-white shadow-xs">
                    {catalogCategoryLabel(model.category)}
                  </span>

                  {/* Indicateur multi-photos */}
                  {model.photo_paths && model.photo_paths.length > 1 && (
                    <span className="absolute top-2 right-2 rounded-full bg-black/65 px-2 py-0.5 text-[0.65rem] font-bold text-white backdrop-blur flex items-center gap-0.5">
                      <ImageIcon className="size-2.5" /> +{model.photo_paths.length - 1}
                    </span>
                  )}

                  <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      aria-label="Modifier le modèle"
                      title="Modifier"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(model);
                      }}
                      className="flex size-9 sm:size-10 items-center justify-center rounded-full bg-white text-foreground shadow-lg ring-1 ring-black/10 hover:scale-105 active:scale-95"
                    >
                      <Edit className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Supprimer le modèle"
                      title="Supprimer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModelToDelete(model);
                      }}
                      className="flex size-9 sm:size-10 items-center justify-center rounded-full bg-destructive text-white shadow-lg hover:scale-105 active:scale-95"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {/* Contenu de la fiche modèle */}
                <div className="flex flex-1 flex-col p-2.5 sm:p-3.5">
                  <div className="flex-1">
                    <h3 className="font-display text-xs sm:text-sm font-bold text-foreground line-clamp-1">
                      {model.name}
                    </h3>

                    {model.description && layoutMode === "grid" && (
                      <p className="mt-0.5 text-[0.7rem] sm:text-xs text-muted-foreground line-clamp-1">
                        {model.description}
                      </p>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[0.7rem] sm:text-xs">
                      {model.default_price ? (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-bold text-primary">
                          <Coins className="size-2.5 sm:size-3" /> {fcfa(model.default_price, business?.currency)}
                        </span>
                      ) : null}

                      {model.fabric_needed && (
                        <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground truncate max-w-[110px]">
                          🧵 {model.fabric_needed}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-border/70 pt-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(model)}
                      className="h-9 sm:h-10 text-[11px] sm:text-xs font-bold rounded-xl px-1"
                    >
                      <Edit className="mr-1 size-3 sm:size-3.5" /> Modifier
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setModelToDelete(model)}
                      className="h-9 sm:h-10 text-[11px] sm:text-xs font-bold rounded-xl px-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="mr-1 size-3 sm:size-3.5" /> Suppr.
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleOrderFromModel(model)}
                      className="h-9 sm:h-10 text-[11px] sm:text-xs font-bold rounded-xl shadow-xs px-1"
                    >
                      <Scissors className="mr-1 size-3 sm:size-3.5" /> Commander
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleShareWhatsApp(model)}
                      className="h-9 sm:h-10 text-[11px] sm:text-xs font-bold rounded-xl bg-success text-success-foreground hover:bg-success/90 px-1"
                    >
                      <Share2 className="mr-1 size-3 sm:size-3.5" /> WhatsApp
                    </Button>
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
        onSaved={(saved) => {
          setEditingModel(saved);
          if (presentationModel?.id === saved.id) {
            setPresentationModel(saved);
          }
        }}
      />

      {/* Mode Présentation Plein Écran pour le client */}
      {presentationModel && (
        <Dialog open={Boolean(presentationModel)} onOpenChange={() => setPresentationModel(null)}>
          <DialogContent className="max-h-[95vh] max-w-2xl overflow-hidden p-0 bg-card border-border [&>button]:hidden">
            <div className="relative flex flex-col">
              {/* Grand affichage photo avec gestes tactiles (swipe mobile) */}
              <div
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                className="relative aspect-4/3 sm:aspect-16/10 w-full bg-black/95 flex items-center justify-center overflow-hidden select-none"
              >
                {presentationModel.photo_paths && presentationModel.photo_paths.length > 0 ? (
                  <StoredImage
                    path={presentationModel.photo_paths[currentPhotoIndex] || presentationModel.photo_paths[0]}
                    alt={presentationModel.name}
                    className="size-full object-contain transition-all duration-300"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-white/60">
                    <Scissors className="size-16" />
                    <p className="text-sm">Pas de photo disponible</p>
                  </div>
                )}

                {/* Badge compteur de photos (haut-gauche) */}
                {presentationModel.photo_paths && presentationModel.photo_paths.length > 0 && (
                  <span className="absolute top-3 left-3 rounded-full bg-black/75 backdrop-blur-md px-2.5 py-1 text-[0.7rem] font-bold text-white shadow-xs">
                    📸 {currentPhotoIndex + 1} / {presentationModel.photo_paths.length}
                  </span>
                )}

                {/* Navigation entre photos */}
                {presentationModel.photo_paths && presentationModel.photo_paths.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Photo précédente"
                      onClick={() =>
                        setCurrentPhotoIndex((prev) =>
                          prev === 0 ? presentationModel.photo_paths.length - 1 : prev - 1,
                        )
                      }
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 flex size-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 active:scale-95 transition-all shadow-md"
                    >
                      <ChevronLeft className="size-6" />
                    </button>
                    <button
                      type="button"
                      aria-label="Photo suivante"
                      onClick={() =>
                        setCurrentPhotoIndex((prev) =>
                          prev === presentationModel.photo_paths.length - 1 ? 0 : prev + 1,
                        )
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 flex size-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 active:scale-95 transition-all shadow-md"
                    >
                      <ChevronRight className="size-6" />
                    </button>

                    {/* Bande de miniatures interactive */}
                    <div className="absolute bottom-2 inset-x-2 flex items-center justify-center gap-1.5 overflow-x-auto py-1 px-2 scrollbar-none z-10">
                      {presentationModel.photo_paths.map((p, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCurrentPhotoIndex(i);
                          }}
                          className={`relative size-10 sm:size-12 shrink-0 overflow-hidden rounded-lg border-2 transition-all shadow-xs ${
                            i === currentPhotoIndex
                              ? "border-primary ring-2 ring-primary/60 scale-105"
                              : "border-white/40 opacity-70 hover:opacity-100"
                          }`}
                        >
                          <StoredImage
                            path={p}
                            alt={`Miniature ${i + 1}`}
                            className="size-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Bouton fermer */}
                <button
                  type="button"
                  aria-label="Fermer"
                  onClick={() => setPresentationModel(null)}
                  className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/75 text-white hover:bg-black active:scale-95 shadow-md"
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
                        {fcfa(presentationModel.default_price, business?.currency)}
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

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                  <Button
                    size="lg"
                    onClick={() => {
                      setPresentationModel(null);
                      handleOrderFromModel(presentationModel);
                    }}
                    className="col-span-2 font-bold h-11 rounded-xl shadow-xs"
                  >
                    <Scissors className="mr-2 size-4" /> Commander ce modèle
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => void handleShareWhatsApp(presentationModel)}
                    className="col-span-2 h-11 font-bold rounded-xl bg-success text-success-foreground hover:bg-success/90 shadow-xs"
                  >
                    <Share2 className="mr-1.5 size-4" /> Envoyer au client
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      const m = presentationModel;
                      setPresentationModel(null);
                      handleEdit(m);
                    }}
                    className="h-11 rounded-xl font-semibold"
                  >
                    <Edit className="mr-1.5 size-4" /> Modifier
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      const m = presentationModel;
                      setPresentationModel(null);
                      setModelToDelete(m);
                    }}
                    className="h-11 rounded-xl font-semibold border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="mr-1.5 size-4" /> Supprimer
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Boîte de dialogue de confirmation de suppression */}
      <AlertDialog
        open={Boolean(modelToDelete)}
        onOpenChange={(open) => {
          if (!open) setModelToDelete(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold">
              Supprimer le modèle "{modelToDelete?.name}" ?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Cette action supprimera ce modèle de votre catalogue et Lookbook. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="rounded-xl">Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                const id = modelToDelete?.id;
                if (id) deleteMutation.mutate(id);
              }}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold"
            >
              {deleteMutation.isPending ? "Suppression..." : "Supprimer définitivement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal d'upgrade avec proposition directe des forfaits Trimestriel et Annuel */}
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        triggerReason="Passez au Pass Trimestriel (5 000 F) ou Annuel (15 000 F) pour ajouter des photos de catalogue en illimité à l'infini !"
      />
    </div>
  );
}
