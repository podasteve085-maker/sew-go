import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { uploadImage } from "@/hooks/use-signed-url";
import { GENDERS } from "@/lib/domain";
import type { ClientRow } from "@/lib/queries";
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
import { useBusiness } from "@/hooks/use-business";
import { checkClientQuota } from "@/lib/quotas";
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

  const save = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      if (!client) {
        // Contrôle du quota de clients pour le plan Gratuit
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
      const payload = {
        business_id: businessId,
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
      if (client) {
        const { error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", client.id)
          .eq("business_id", businessId);
        if (error) throw error;
        return client.id;
      } else {
        const { data, error } = await supabase.from("clients").insert(payload).select("id").single();
        if (error) throw error;
        return (data as { id: string }).id;
      }
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
      const path = await uploadImage(businessId, file, "clients");
      setPhotoPath(path);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{client ? "Modifier le client" : "Nouveau client"}</DialogTitle>
          <DialogDescription>Le nom et le téléphone suffisent pour commencer.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">Prénom *</Label>
              <Input id="first_name" name="first_name" required defaultValue={client?.first_name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Nom</Label>
              <Input id="last_name" name="last_name" defaultValue={client?.last_name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" name="phone" inputMode="tel" defaultValue={client?.phone ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <Input
                id="whatsapp"
                name="whatsapp"
                inputMode="tel"
                defaultValue={client?.whatsapp ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gender">Sexe</Label>
              <select
                id="gender"
                name="gender"
                defaultValue={client?.gender ?? ""}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">—</option>
                {GENDERS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="birth_date">Date de naissance</Label>
              <Input
                id="birth_date"
                name="birth_date"
                type="date"
                defaultValue={client?.birth_date ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">Ville / quartier</Label>
              <Input id="city" name="city" defaultValue={client?.city ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">Adresse</Label>
              <Input id="address" name="address" defaultValue={client?.address ?? ""} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (préférences, consignes…)</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={client?.notes ?? ""}
              placeholder="Préfère les manches légèrement larges. Toujours appeler avant livraison."
            />
          </div>

          <div className="flex items-center gap-3">
            {photoPath ? (
              <StoredImage path={photoPath} alt="Photo du client" className="size-16 rounded-xl object-cover" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <ImageIcon className="size-5" />
              </span>
            )}
            <div>
              <Label htmlFor="photo" className="text-sm">
                Photo du client (optionnel)
              </Label>
              <Input
                id="photo"
                type="file"
                accept="image/*"
                onChange={onPhoto}
                disabled={uploading}
                className="mt-1.5"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending || uploading}>
              {(save.isPending || uploading) && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
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
