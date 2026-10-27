import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Image as ImageIcon, Camera, ChevronDown, Check, UserPlus, Phone, MessageSquare, MapPin, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { uploadImage } from "@/hooks/use-signed-url";
import { GENDERS } from "@/lib/domain";
import { type ClientRow, saveClientOffline } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StoredImage } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { checkClientQuota, isSubscriptionExpired } from "@/lib/quotas";
import { UpgradeDialog } from "@/components/upgrade-dialog";

export function ClientFormDialog({
  open,
  onOpenChange,
  businessId,
  client,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: string;
  client?: ClientRow | null;
  onCreated?: (clientId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();
  const [photoPath, setPhotoPath] = useState<string | null>(client?.photo_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [quotaReason, setQuotaReason] = useState("");
  const [phoneVal, setPhoneVal] = useState(client?.phone ?? "");
  const [whatsappVal, setWhatsappVal] = useState(client?.whatsapp ?? "");
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (client) {
      setPhoneVal(client.phone ?? "");
      setWhatsappVal(client.whatsapp ?? "");
      setPhotoPath(client.photo_url ?? null);
    } else {
      setPhoneVal("");
      setWhatsappVal("");
      setPhotoPath(null);
    }
  }, [client, open]);

  function copyPhoneToWhatsapp() {
    if (phoneVal) {
      setWhatsappVal(phoneVal);
      toast.success("Numéro recopié dans WhatsApp !");
    }
  }

  const save = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      if (client) {
        if (isSubscriptionExpired(business)) {
          const msg = "Votre atelier est en mode Consultation. Vos clients restent consultables et protégés. Réactivez votre Pass Atelier pour modifier vos fiches existantes.";
          setQuotaReason(msg);
          setUpgradeOpen(true);
          throw new Error(msg);
        }
      } else {
        // Contrôle strict du quota de clients pour la formule Découverte
        const { count, error: countErr } = await supabase
          .from("clients")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId);

        if (!countErr && typeof count === "number") {
          const quota = checkClientQuota(business, count);
          if (!quota.allowed) {
            setQuotaReason(quota.message || "Limite de clients atteinte.");
            setUpgradeOpen(true);
            throw new Error(quota.message || "Limite de clients atteinte.");
          }
        }
      }

      const bId = businessId || business?.id || (typeof window !== "undefined" ? localStorage.getItem("couturpro_current_business_id") : "") || "";
      const payload = {
        business_id: bId,
        first_name: values["first_name"] ?? "",

        last_name: values["last_name"] ?? "",
        phone: values["phone"] || null,
        whatsapp: values["whatsapp"] || null,
        gender: values["gender"] || null,
        birth_date: values["birth_date"] || null,
        address: values["address"] || null,
        city: values["city"] || null,
        notes: values["notes"] || null,
        photo_url: photoPath,
      };
      const res = await saveClientOffline(payload, !client, client?.id);
      return res.id;
    },
    onSuccess: (newId) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", client?.id] });
      queryClient.invalidateQueries({ queryKey: ["clients-count"] });
      toast.success(client ? "Client modifié" : "Client enregistré");
      onOpenChange(false);
      if (!client && newId) {
        onCreated?.(newId);
      }
    },
    onError: () => toast.error("Enregistrement impossible"),
  });

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const bId = businessId || business?.id || (typeof window !== "undefined" ? localStorage.getItem("couturpro_current_business_id") : "") || "atelier";
      const path = await uploadImage(bId, file, "clients");
      setPhotoPath(path);
      toast.success("Photo sélectionnée");
    } catch {
      toast.error("Photo non envoyée");
    } finally {
      setUploading(false);
    }
  }


  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    fd.forEach((v, k) => {
      values[k] = String(v).trim();
    });
    save.mutate(values);
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-border/80 shadow-lg">
        <DialogHeader className="space-y-1.5 pb-2 border-b border-border/70">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <UserPlus className="size-4.5" />
            </div>
            <DialogTitle className="font-display text-lg sm:text-xl font-extrabold text-foreground">
              {client ? "Modifier la fiche client" : "Nouveau client"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Le prénom et le numéro de téléphone suffisent pour commencer. Vous pourrez compléter le reste à tout moment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5 pt-1">
          {/* Bloc Coordonnées principales */}
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="first_name" className="text-xs sm:text-sm font-semibold">
                  Prénom <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="first_name"
                  name="first_name"
                  required
                  defaultValue={client?.first_name ?? ""}
                  placeholder="Ex : Aminata"
                  className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="last_name" className="text-xs sm:text-sm font-semibold">
                  Nom de famille
                </Label>
                <Input
                  id="last_name"
                  name="last_name"
                  defaultValue={client?.last_name ?? ""}
                  placeholder="Ex : Ouédraogo"
                  className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs sm:text-sm font-semibold flex items-center gap-1">
                  <Phone className="size-3.5 text-primary" /> Téléphone
                </Label>
                <Input
                  id="phone"
                  name="phone"
                  inputMode="tel"
                  value={phoneVal}
                  onChange={(e) => setPhoneVal(e.target.value)}
                  placeholder="Ex : 70 00 00 00"
                  className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="whatsapp" className="text-xs sm:text-sm font-semibold flex items-center gap-1">
                    <MessageSquare className="size-3.5 text-emerald-600" /> WhatsApp
                  </Label>
                  {phoneVal && phoneVal !== whatsappVal && (
                    <button
                      type="button"
                      onClick={copyPhoneToWhatsapp}
                      className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                      title="Copier le téléphone"
                    >
                      Même numéro
                    </button>
                  )}
                </div>
                <Input
                  id="whatsapp"
                  name="whatsapp"
                  inputMode="tel"
                  value={whatsappVal}
                  onChange={(e) => setWhatsappVal(e.target.value)}
                  placeholder="Ex : 70 00 00 00"
                  className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
                />
              </div>
            </div>
          </div>

          {/* Informations complémentaires */}
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/60">
            <div className="space-y-1.5">
              <Label htmlFor="gender" className="text-xs sm:text-sm font-semibold">
                Sexe / Profil
              </Label>
              <div className="relative">
                <select
                  id="gender"
                  name="gender"
                  defaultValue={client?.gender ?? ""}
                  className="h-11 sm:h-12 w-full appearance-none rounded-xl border border-border/80 bg-background px-3.5 pr-10 text-base sm:text-sm font-medium transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-2xs"
                >
                  <option value="">Non précisé</option>
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="birth_date" className="text-xs sm:text-sm font-semibold">
                Date de naissance
              </Label>
              <Input
                id="birth_date"
                name="birth_date"
                type="date"
                defaultValue={client?.birth_date ?? ""}
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="city" className="text-xs sm:text-sm font-semibold flex items-center gap-1">
                <MapPin className="size-3.5 text-muted-foreground" /> Ville / Quartier
              </Label>
              <Input
                id="city"
                name="city"
                defaultValue={client?.city ?? ""}
                placeholder="Ex : Ouagadougou, Karpala"
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address" className="text-xs sm:text-sm font-semibold">
                Adresse / Repère
              </Label>
              <Input
                id="address"
                name="address"
                defaultValue={client?.address ?? ""}
                placeholder="Ex : Face pharmacie"
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
              />
            </div>
          </div>

          {/* Notes et préférences */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs sm:text-sm font-semibold">
              Consignes & Préférences (habitudes, style préféré)
            </Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={client?.notes ?? ""}
              placeholder="Ex : Préfère les coupes amples, col bien fermé, toujours appeler avant de livrer..."
              className="rounded-xl text-base sm:text-sm bg-background"
            />
          </div>

          {/* Zone Photo Moderne (Zéro input brut) */}
          <div className="space-y-2 pt-1 border-t border-border/60">
            <Label className="text-xs sm:text-sm font-semibold">
              Photo du client (optionnel)
            </Label>

            {/* Input masqué */}
            <input
              ref={photoInputRef}
              id="photo"
              type="file"
              accept="image/*"
              onChange={onPhoto}
              disabled={uploading}
              className="hidden"
            />

            {photoPath ? (
              <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3 shadow-2xs">
                <StoredImage
                  path={photoPath}
                  alt="Photo du client"
                  className="size-16 rounded-xl object-cover shrink-0 border border-border"
                />
                <div className="space-y-1 flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground">Photo enregistrée</p>
                  <p className="text-[11px] text-muted-foreground truncate">Visible sur la fiche et le carnet</p>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="text-xs font-bold text-primary hover:underline cursor-pointer"
                    >
                      Changer
                    </button>
                    <span className="text-border">·</span>
                    <button
                      type="button"
                      onClick={async () => {
                        setPhotoPath(null);
                        // Si modification d'un client existant : sauvegarder immédiatement la suppression de photo
                        if (client?.id) {
                          try {
                            const bId = businessId || business?.id || (typeof window !== "undefined" ? localStorage.getItem("couturpro_current_business_id") : "") || "";
                            await saveClientOffline({ ...client, business_id: bId, photo_url: null }, false, client.id);
                            queryClient.invalidateQueries({ queryKey: ["clients"] });
                            queryClient.invalidateQueries({ queryKey: ["client", client.id] });
                            toast.success("Photo supprimée");
                          } catch {
                            toast.error("Suppression de photo impossible");
                          }
                        }
                      }}
                      className="text-xs font-bold text-destructive hover:underline cursor-pointer"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center gap-3 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 active:scale-[0.99] p-3.5 text-left transition-all cursor-pointer disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-6 animate-spin text-primary shrink-0" />
                    <span className="text-xs font-bold text-foreground">Envoi de la photo en cours…</span>
                  </>
                ) : (
                  <>
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0 shadow-2xs">
                      <Camera className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-bold text-foreground">
                        Prendre une photo ou importer un portrait
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Permet de reconnaître immédiatement le client et sa silhouette
                      </p>
                    </div>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Mention de confidentialité RGPD */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/90 bg-muted/40 rounded-lg p-2.5">
            <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
            <span>Données confidentielles : enregistrées exclusivement pour les confections de votre atelier.</span>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2 border-t border-border/70">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto h-11 text-muted-foreground font-semibold"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={save.isPending || uploading}
              className="w-full sm:w-auto h-12 px-6 rounded-xl font-extrabold text-base shadow-md bg-primary hover:bg-primary/90 text-primary-foreground active:scale-95 transition-all"
            >
              {save.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4.5 animate-spin" /> Enregistrement…
                </>
              ) : (
                <>
                  <Check className="mr-2 size-4.5" /> {client ? "Mettre à jour" : "Enregistrer le client"}
                </>
              )}
            </Button>
          </DialogFooter>
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
