import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Loader2, Plus, X, UploadCloud, Tag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { uploadImage } from "@/hooks/use-signed-url";
import { CATALOG_CATEGORIES, type CatalogCategory } from "@/lib/domain";
import type { CatalogModelRow } from "@/lib/queries";
import { StoredImage } from "@/components/bits";
import { checkCatalogQuota } from "@/lib/quotas";
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
}

export function CatalogModelDialog({ open, onOpenChange, model }: CatalogModelDialogProps) {
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
  const [quotaReason, setQuotaReason] = useState("");

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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !business) return;

    setUploading(true);
    const newPaths: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file) {
          const path = await uploadImage(business.id, file, "catalog");
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

  function removePhoto(indexToRemove: number) {
    setPhotoPaths((prev) => prev.filter((_, idx) => idx !== indexToRemove));
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
      if (!business) throw new Error("Atelier non identifié");
      if (!name.trim()) throw new Error("Le nom du modèle est obligatoire");

      if (!isEdit) {
        // Contrôle strict du quota de modèles du catalogue pour le plan Gratuit
        const { count, error: countErr } = await supabase
          .from("catalog_models")
          .select("id", { count: "exact", head: true })
          .eq("business_id", business.id);

        if (!countErr && typeof count === "number") {
          const quota = checkCatalogQuota(business, count);
          if (!quota.allowed) {
            setQuotaReason(quota.message || "Limite de modèles atteinte.");
            setUpgradeOpen(true);
            throw new Error(quota.message || "Limite de modèles atteinte.");
          }
        }
      }

      const payload = {
        business_id: business.id,
        name: name.trim(),
        category,
        description: description.trim() || null,
        default_price: defaultPrice ? Number(defaultPrice) : null,
        fabric_needed: fabricNeeded.trim() || null,
        photo_paths: photoPaths,
        tags,
        is_active: true,
      };

      if (isEdit && model) {
        const { error } = await supabase
          .from("catalog_models")
          .update(payload)
          .eq("id", model.id)
          .eq("business_id", business.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("catalog_models").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-models"] });
      toast.success(isEdit ? "Modèle mis à jour avec succès" : "Modèle ajouté au catalogue !");
      onOpenChange(false);
      resetForm(null);
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer le modèle. Vérifiez la table Supabase.";
      toast.error(msg);
    },
  });

  return (
    <>
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
              className="h-10 text-sm"
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
                className="h-10 text-sm font-semibold"
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
                className="h-10 text-sm"
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

          {/* Photos du modèle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold sm:text-sm">Photos du modèle</Label>
              <span className="text-[0.7rem] text-muted-foreground">
                {photoPaths.length} photo(s)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-20 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-2 text-center transition-colors hover:bg-primary/10 active:scale-95">
                <UploadCloud className="size-5 text-primary" />
                <span className="text-[0.68rem] font-bold text-primary">
                  {uploading ? "Envoi..." : "+ Photo"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>

              {photoPaths.map((path, idx) => (
                <div
                  key={`${path}-${idx}`}
                  className="relative group size-20 rounded-xl border border-border overflow-hidden bg-muted"
                >
                  <StoredImage
                    path={path}
                    alt={`Photo modèle ${idx + 1}`}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    aria-label="Supprimer la photo"
                    className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-destructive"
                  >
                    <X className="size-3" />
                  </button>
                  {idx === 0 && (
                    <span className="absolute bottom-0 inset-x-0 bg-primary/90 text-primary-foreground py-0.5 text-center text-[0.6rem] font-bold">
                      Couverture
                    </span>
                  )}
                </div>
              ))}
            </div>
            {uploading && (
              <p className="flex items-center gap-1.5 text-xs text-primary animate-pulse">
                <Loader2 className="size-3.5 animate-spin" /> Téléversement de l'image en cours...
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
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
              className="h-10 text-xs sm:text-sm font-semibold"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={saveMutation.isPending || uploading}
              className="h-10 text-xs sm:text-sm font-bold min-w-[7rem]"
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
    </Dialog>

    <UpgradeDialog
      open={upgradeOpen}
      onOpenChange={setUpgradeOpen}
      triggerReason={quotaReason}
    />
    </>
  );
}
