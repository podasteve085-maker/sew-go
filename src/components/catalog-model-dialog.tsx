import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, X, UploadCloud, Tag, Trash2, Star, Sparkles, AlertTriangle, Zap } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "@/hooks/use-business";
import { uploadImage, deleteStorageFiles } from "@/hooks/use-signed-url";
import { CATALOG_CATEGORIES, type CatalogCategory } from "@/lib/domain";
import { saveCatalogModelOffline, fetchCatalogModels, type CatalogModelRow } from "@/lib/queries";
import { checkCatalogPhotosQuota } from "@/lib/quotas";
import { StoredImage } from "@/components/bits";
import { UpgradeDialog } from "@/components/upgrade-dialog";

const SUGGESTED_TAGS = [
  "Cérémonie",
  "Mariage",
  "Tabaski",
  "Vendredi",
  "Bazin Riche",
  "Faso Dan Fani",
  "Koko Dunda",
  "Broderie",
  "Luxe",
  "Moderne",
  "Enfants",
];

interface CatalogModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model?: CatalogModelRow | null;
  onSaved?: (model: CatalogModelRow) => void;
}

export function CatalogModelDialog({ open, onOpenChange, model, onSaved }: CatalogModelDialogProps) {
  const { data: business } = useBusiness();
  const queryClient = useQueryClient();

  const isEdit = Boolean(model);

  const [name, setName] = useState(model?.name ?? "");
  const [category, setCategory] = useState<CatalogCategory>(
    (model?.category as CatalogCategory) || "boubou",
  );
  const [description, setDescription] = useState(model?.description ?? "");
  const [defaultPrice, setDefaultPrice] = useState(
    model?.default_price ? String(model.default_price) : "",
  );
  const [fabricNeeded, setFabricNeeded] = useState(model?.fabric_needed ?? "");
  const [photoPaths, setPhotoPaths] = useState<string[]>(model?.photo_paths ?? []);
  const [tags, setTags] = useState<string[]>(model?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Charger tous les modèles du catalogue pour calculer le nombre total de photos de l'atelier
  const { data: allModels = [] } = useQuery({
    queryKey: ["catalog-models", business?.id],
    queryFn: () => fetchCatalogModels("all", business?.id),
    enabled: Boolean(business?.id),
  });

  // Somme des photos dans les autres modèles (exclut le modèle en cours d'édition pour ne pas compter en double)
  const totalOtherPhotos = useMemo(() => {
    return allModels
      .filter((m) => m.id !== model?.id)
      .reduce((acc, m) => acc + (m.photo_paths?.length || 0), 0);
  }, [allModels, model?.id]);

  const currentDialogTotalPhotos = totalOtherPhotos + photoPaths.length;
  const quotaInfo = checkCatalogPhotosQuota(business, currentDialogTotalPhotos);

  // Synchronise whenever the dialog opens with a specific model
  function resetForm(m?: CatalogModelRow | null) {
    setName(m?.name ?? "");
    setCategory(((m?.category as CatalogCategory) || "boubou"));
    setDescription(m?.description ?? "");
    setDefaultPrice(m?.default_price ? String(m.default_price) : "");
    setFabricNeeded(m?.fabric_needed ?? "");
    setPhotoPaths(m?.photo_paths ?? []);
    setTags(m?.tags ?? []);
    setTagInput("");
  }

  // Réinitialiser uniquement à l'ouverture ou au changement de modèle,
  // jamais pendant une édition (ex. après suppression d'une photo).
  useEffect(() => {
    if (open) {
      resetForm(model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- model?.id suffit
  }, [open, model?.id]);

  function makeCoverPhoto(index: number) {
    if (index === 0) return;
    setPhotoPaths((prev) => {
      const next = [...prev];
      const [selected] = next.splice(index, 1);
      if (selected) next.unshift(selected);
      return next;
    });
    toast.success("Photo définie comme couverture principale");
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !business) return;

    // Vérification stricte du quota avant téléversement
    const quotaCheck = checkCatalogPhotosQuota(business, currentDialogTotalPhotos, files.length);
    if (!quotaCheck.allowed) {
      toast.error(quotaCheck.message || "Quota de photos dépassé.", {
        description: "Passez au Pass Trimestriel ou Annuel pour débloquer les photos illimitées !",
        action: {
          label: "Débloquer",
          onClick: () => setUpgradeOpen(true),
        },
      });
      setUpgradeOpen(true);
      e.target.value = "";
      return;
    }

    setUploading(true);
    const newPaths: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file) {
          const path = await uploadImage(business.id, file, "catalog");
          if (path.startsWith("data:") && typeof navigator !== "undefined" && navigator.onLine) {
            toast.error(`La photo « ${file.name} » n'a pas pu être envoyée. Réessayez.`);
            continue;
          }
          newPaths.push(path);
        }
      }
      setPhotoPaths((prev) => [...prev, ...newPaths]);
      toast.success(`${newPaths.length} photo(s) ajoutée(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors de l'envoi de l'image";
      toast.error(msg);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function removePhoto(indexToRemove: number) {
    const previous = photoPaths;
    const removed = previous[indexToRemove];
    if (!removed) return;
    const next = previous.filter((_, idx) => idx !== indexToRemove);
    setPhotoPaths(next);

    try {
      if (isEdit && model?.id) {
        const saved = await saveCatalogModelOffline(
          {
            business_id: business?.id ?? model.business_id,
            name: name.trim() || model.name,
            category,
            description: description.trim() || null,
            default_price: (() => {
              const parsed = defaultPrice ? Number(defaultPrice) : model.default_price;
              return parsed !== null && parsed !== undefined && !Number.isNaN(parsed) ? parsed : null;
            })(),
            fabric_needed: fabricNeeded.trim() || null,
            photo_paths: next,
            tags,
            is_active: true,
            created_at: model.created_at,
          },
          false,
          model.id,
        );
        queryClient.invalidateQueries({ queryKey: ["catalog-models"] });
        queryClient.invalidateQueries({ queryKey: ["public-catalog-models"] });
        onSaved?.(saved);
        toast.success("Photo retirée du modèle");
      }
      await deleteStorageFiles([removed]);
    } catch (err) {
      setPhotoPaths(previous);
      const msg = err instanceof Error ? err.message : "Impossible de retirer cette photo";
      toast.error(msg);
    }
  }

  function addTag(tagToAdd: string) {
    const trimmed = tagToAdd.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    setTags((prev) => [...prev, trimmed]);
    setTagInput("");
  }

  function removeTag(tagToRemove: string) {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Le nom du modèle est obligatoire");

      const parsedPrice = defaultPrice ? Number(defaultPrice) : null;
      const validPrice =
        parsedPrice !== null && !isNaN(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;

      const payload = {
        business_id: business?.id,
        name: name.trim(),
        category,
        description: description.trim() || null,
        default_price: validPrice,
        fabric_needed: fabricNeeded.trim() || null,
        photo_paths: photoPaths,
        tags,
        is_active: true,
        created_at: model?.created_at,
      };

      const saved = await saveCatalogModelOffline(payload, !isEdit, model?.id);
      const removedPhotos = (model?.photo_paths ?? []).filter(
        (path) => !photoPaths.includes(path),
      );
      if (removedPhotos.length > 0) {
        await deleteStorageFiles(removedPhotos);
      }
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["catalog-models"] });
      queryClient.invalidateQueries({ queryKey: ["public-catalog-models"] });
      onSaved?.(saved);
      toast.success(isEdit ? "Modèle mis à jour avec succès" : "Modèle ajouté au catalogue !");
      onOpenChange(false);
      resetForm(null);
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer le modèle.";
      toast.error(msg);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) resetForm(null);
        onOpenChange(val);
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-lg sm:text-xl">
            {isEdit ? "Modifier le modèle" : "Ajouter un modèle au Lookbook"}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            Présentez ce modèle à vos clients et générez des commandes en un clic.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          className="space-y-4 pt-2"
        >
          {/* Nom du modèle */}
          <div className="space-y-1.5">
            <Label htmlFor="model_name" className="text-xs font-semibold sm:text-sm">
              Nom du modèle *
            </Label>
            <Input
              id="model_name"
              required
              placeholder="Ex: Boubou 3 pièces broderie royale, Robe sirène..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 text-base sm:text-sm rounded-xl font-medium"
            />
          </div>

          {/* Catégorie */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold sm:text-sm">Catégorie *</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {CATALOG_CATEGORIES.map((c) => {
                const selected = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`flex items-center gap-1.5 rounded-lg border p-2 text-left text-xs font-semibold transition-all active:scale-95 ${
                      selected
                        ? "border-primary bg-primary/10 text-primary shadow-xs"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <span className="text-base">{c.icon}</span>
                    <span className="truncate">{c.label.split("&")[0]?.trim()}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prix indicatif & Métrage tissu requis */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="model_price" className="text-xs font-semibold sm:text-sm">
                Prix indicatif (FCFA)
              </Label>
              <Input
                id="model_price"
                type="number"
                min="0"
                step="500"
                placeholder="Ex: 35000"
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(e.target.value)}
                className="h-11 text-base sm:text-sm rounded-xl font-semibold"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model_fabric" className="text-xs font-semibold sm:text-sm">
                Tissu conseillé / Métrage
              </Label>
              <Input
                id="model_fabric"
                placeholder="Ex: 3 pagnes ou 4m Bazin"
                value={fabricNeeded}
                onChange={(e) => setFabricNeeded(e.target.value)}
                className="h-11 text-base sm:text-sm rounded-xl"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="model_description" className="text-xs font-semibold sm:text-sm">
              Description & finitions
            </Label>
            <Textarea
              id="model_description"
              rows={2}
              placeholder="Détails : col officier, broderie fil d'or sur la poitrine, manches raglan..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Photos du modèle & Jauge de Quota */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold sm:text-sm">Photos du modèle</Label>
              <span className="text-[0.7rem] font-bold text-muted-foreground">
                {photoPaths.length} photo(s) dans ce modèle
              </span>
            </div>

            {/* Indicateur de Quota en direct */}
            {quotaInfo.isUnlimited ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                <span className="flex items-center gap-1.5 font-bold">
                  <Sparkles className="size-4 text-emerald-600 shrink-0" /> Photos de catalogue illimitées à l'infini
                </span>
                <span className="text-[11px] font-semibold">
                  {currentDialogTotalPhotos} photo(s) au catalogue
                </span>
              </div>
            ) : (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <Zap className="size-3.5 text-primary" /> Quota Photos Mensuel : {currentDialogTotalPhotos} / 200
                  </span>
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1"
                  >
                    Passer à l'illimité ✨
                  </button>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all ${
                      currentDialogTotalPhotos >= 200
                        ? "bg-destructive"
                        : currentDialogTotalPhotos >= 170
                        ? "bg-amber-500"
                        : "bg-primary"
                    }`}
                    style={{
                      width: `${Math.min(100, Math.round((currentDialogTotalPhotos / 200) * 100))}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {currentDialogTotalPhotos >= 200
                    ? "⚠️ Plafond de 200 photos atteint. Passez au Pass Trimestriel ou Annuel pour ajouter des photos en illimité."
                    : `${Math.max(0, 200 - currentDialogTotalPhotos)} emplacement(s) photo restant(s) pour la formule mensuelle.`}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1 pr-1">
              <label
                className={`flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-2 text-center transition-all ${
                  !quotaInfo.isUnlimited && currentDialogTotalPhotos >= 200
                    ? "cursor-not-allowed border-destructive/40 bg-destructive/5 opacity-70"
                    : "cursor-pointer border-primary/40 bg-primary/5 hover:bg-primary/10 active:scale-95"
                }`}
              >
                <UploadCloud className="size-6 text-primary" />
                <span className="text-[0.68rem] font-bold text-primary">
                  {uploading ? "Envoi..." : "+ Photo"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileUpload}
                  disabled={uploading || (!quotaInfo.isUnlimited && currentDialogTotalPhotos >= 200)}
                  className="hidden"
                />
              </label>

              {photoPaths.map((path, idx) => (
                <div
                  key={`${path}-${idx}`}
                  className="relative size-24 overflow-visible rounded-xl"
                >
                  <div className="relative size-24 overflow-hidden rounded-xl border border-border bg-muted">
                    <StoredImage
                      path={path}
                      alt={`Photo modèle ${idx + 1}`}
                      className="size-full object-cover"
                    />
                    {idx === 0 && (
                      <span className="absolute bottom-0 inset-x-0 bg-primary/90 text-primary-foreground py-0.5 text-center text-[0.6rem] font-bold">
                        Couverture
                      </span>
                    )}
                  </div>

                  {/* Bouton pour définir comme couverture */}
                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        makeCoverPhoto(idx);
                      }}
                      aria-label="Mettre en photo de couverture"
                      title="Mettre en couverture principale"
                      className="absolute -top-2 -left-2 z-20 flex size-7 items-center justify-center rounded-full bg-background border border-border text-amber-500 shadow-md hover:scale-105 active:scale-95"
                    >
                      <Star className="size-3.5 fill-amber-500" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void removePhoto(idx);
                    }}
                    aria-label="Supprimer cette photo"
                    title="Supprimer cette photo"
                    className="absolute -top-2 -right-2 z-20 flex size-11 items-center justify-center rounded-full bg-destructive text-white shadow-lg ring-2 ring-background active:scale-90"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[0.7rem] text-muted-foreground">
              La première photo sert d'image de couverture. Cliquez sur l'étoile ⭐ pour désigner une autre photo comme couverture.
            </p>
            {uploading && (
              <p className="flex items-center gap-1.5 text-xs text-primary animate-pulse font-medium">
                <Loader2 className="size-3.5 animate-spin" /> Téléversement et compression de l'image...
              </p>
            )}
          </div>

          {/* Tags / Étiquettes */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold sm:text-sm flex items-center gap-1">
              <Tag className="size-3.5 text-primary" /> Mots-clés / Occasions
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: Fête, Cérémonie..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                className="h-9 text-xs sm:text-sm"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => addTag(tagInput)}
                className="h-9 text-xs font-semibold"
              >
                <Plus className="size-3.5 mr-1" /> Ajouter
              </Button>
            </div>

            {/* Quick tag chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTED_TAGS.map((t) => {
                const active = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => (active ? removeTag(t) : addTag(t))}
                    className={`rounded-full px-2.5 py-1 text-[0.7rem] font-semibold transition-all active:scale-95 ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {t} {active && "✓"}
                  </button>
                );
              })}
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/60">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      className="hover:text-destructive"
                      aria-label={`Supprimer ${t}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Boutons d'action */}
          <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2.5 border-t border-border bg-background pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
              className="h-11 text-xs sm:text-sm font-semibold"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={saveMutation.isPending || uploading}
              className="h-11 text-xs sm:text-sm font-bold min-w-[7.5rem]"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" /> Enregistrement...
                </>
              ) : isEdit ? (
                "Sauvegarder"
              ) : (
                "Ajouter au lookbook"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        triggerReason="Passez au Pass Trimestriel (5 000 F) ou Annuel (15 000 F) pour ajouter des photos de modèles en illimité à l'infini !"
      />
    </Dialog>
  );
}
