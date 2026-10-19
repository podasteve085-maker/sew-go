import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Image as ImageIcon, KeyRound, LogOut, ShieldCheck, Download, AlertTriangle, FileSpreadsheet, ExternalLink, Eye, EyeOff, Check } from "lucide-react";
import { toast } from "sonner";
import { clearOfflineDatabase } from "@/lib/offline-storage";
import { exportCompleteWorkshopJson, exportClientsCsv, exportMeasurementsCsv } from "@/lib/export-data";
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

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { uploadImage, deleteStorageFile } from "@/hooks/use-signed-url";
import { fetchGarmentTypes, fetchTemplates } from "@/lib/queries";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle, StoredImage } from "@/components/bits";
import { ThemeSegmentedControl } from "@/components/theme-toggle";

export const Route = createFileRoute("/_authenticated/atelier")({
  head: () => ({
    meta: [
      { title: "Mon atelier — CouturPro" },
      {
        name: "description",
        content:
          "Réglez le nom, le logo, les coordonnées, les types de vêtements et les modèles de mesures de votre atelier.",
      },
      { property: "og:title", content: "Mon atelier — CouturPro" },
      { property: "og:description", content: "Paramètres de votre atelier de couture." },
    ],
  }),
  component: WorkshopPage,
});

function WorkshopPage() {
  const queryClient = useQueryClient();
  const { data: business, isLoading, isError, error, refetch } = useBusiness();
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const save = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      if (!business) return;
      const { error } = await supabase
        .from("businesses")
        .update({
          name: values["name"] || business.name,
          owner_name: values["owner_name"] || null,
          phone: values["phone"] || null,
          whatsapp: values["whatsapp"] || null,
          address: values["address"] || null,
          city: values["city"] || null,
          currency: values["currency"] || "FCFA",
          receipt_note: values["receipt_note"] || null,
          ...(logoPath ? { logo_url: logoPath } : {}),
        })
        .eq("id", business.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business"] });
      toast.success("Atelier mis à jour");
    },
    onError: () => toast.error("Enregistrement impossible"),
  });

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !business) return;
    setUploading(true);
    try {
      // Supprime l'ancien logo du bucket avant d'uploader le nouveau
      if (business.logo_url) {
        await deleteStorageFile(business.logo_url);
      }
      const path = await uploadImage(business.id, file, "atelier");
      setLogoPath(path);
      toast.success("Logo prêt : enregistrez pour valider");
    } catch {
      toast.error("Logo non envoyé");
    } finally {
      setUploading(false);
    }
  }

  if (isError) {
    const message = error instanceof Error ? error.message : "Erreur de connexion";
    const sessionExpired = message.toLowerCase().includes("session") || message.toLowerCase().includes("reconnectez");

    return (
      <div className="card-soft mx-auto mt-8 max-w-xl space-y-3 p-6 text-center">
        <p className="text-sm font-bold text-destructive">Impossible de charger les données de votre atelier</p>
        <p className="text-xs text-muted-foreground">{message}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Réessayer
          </Button>
          {sessionExpired && (
            <Button asChild size="sm">
              <a href="/auth">Se reconnecter</a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (isLoading || !business) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <SectionTitle>Mon atelier</SectionTitle>

      <form
        className="card-soft space-y-5 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const values: Record<string, string> = {};
          fd.forEach((v, k) => {
            values[k] = String(v).trim();
          });
          save.mutate(values);
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative size-20 min-w-20 min-h-20 shrink-0 rounded-2xl border-2 border-border/80 bg-muted/20 overflow-hidden flex items-center justify-center shadow-xs">
            {logoPath || business.logo_url ? (
              <StoredImage
                path={logoPath ?? business.logo_url}
                alt="Logo de l'atelier"
                className="w-full h-full object-cover"
                fallback={
                  <span className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="size-8" />
                  </span>
                }
              />
            ) : (
              <span className="flex size-full items-center justify-center text-muted-foreground">
                <ImageIcon className="size-8" />
              </span>
            )}
            {uploading && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-xs">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            )}
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="logo" className="font-semibold text-sm">
              Logo de votre atelier (apparaît sur les reçus et la barre latérale)
            </Label>
            <Input
              id="logo"
              type="file"
              accept="image/*"
              onChange={onLogo}
              disabled={uploading}
              className="mt-1 cursor-pointer file:cursor-pointer"
            />
            <div className="flex items-center justify-between gap-3 pt-0.5">
              <p className="text-[11px] text-muted-foreground">
                Format carré recommandé (PNG, JPG, WebP). Automatiquement optimisé.
              </p>
              {(logoPath || business.logo_url) && (
                <button
                  type="button"
                  onClick={async () => {
                    if (business.logo_url) {
                      await deleteStorageFile(business.logo_url);
                      await supabase.from("businesses").update({ logo_url: null }).eq("id", business.id);
                      queryClient.invalidateQueries({ queryKey: ["business"] });
                    }
                    setLogoPath(null);
                    toast.success("Logo retiré");
                  }}
                  className="text-xs text-destructive hover:underline font-semibold cursor-pointer shrink-0"
                >
                  Supprimer le logo
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom de l'atelier *</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={business.name}
              className="h-11 text-base sm:text-sm rounded-xl font-medium"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner_name">Nom du couturier</Label>
            <Input
              id="owner_name"
              name="owner_name"
              defaultValue={business.owner_name ?? ""}
              className="h-11 text-base sm:text-sm rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Téléphone</Label>
            <Input
              id="phone"
              name="phone"
              inputMode="tel"
              defaultValue={business.phone ?? ""}
              className="h-11 text-base sm:text-sm rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input
              id="whatsapp"
              name="whatsapp"
              inputMode="tel"
              defaultValue={business.whatsapp ?? ""}
              className="h-11 text-base sm:text-sm rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">Ville</Label>
            <Input
              id="city"
              name="city"
              defaultValue={business.city ?? ""}
              className="h-11 text-base sm:text-sm rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Adresse</Label>
            <Input
              id="address"
              name="address"
              defaultValue={business.address ?? ""}
              className="h-11 text-base sm:text-sm rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency">Monnaie</Label>
            <Input
              id="currency"
              name="currency"
              defaultValue={business.currency}
              className="h-11 text-base sm:text-sm rounded-xl"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="receipt_note">Mention sur les reçus</Label>
          <Textarea
            id="receipt_note"
            name="receipt_note"
            rows={2}
            defaultValue={business.receipt_note ?? ""}
            placeholder="Merci de votre confiance. Aucun remboursement après retrait."
            className="text-base sm:text-sm rounded-xl"
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending || uploading}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Enregistrer
          </Button>
        </div>
      </form>

      <GarmentTypes businessId={business.id} />
      <Templates businessId={business.id} />
      <ThemeSettingsSection />
      <PasswordChangeSection />
      <PrivacyDataProtectionSection business={business} />
      <SessionSignOutSection />
      <DangerZoneAccountDeletionSection business={business} />
    </div>
  );
}

function GarmentTypes({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["garment-types"],
    queryFn: () => fetchGarmentTypes(),
    enabled: true,
  });

  const add = useMutation({
    mutationFn: async (values: { name: string; price: string }) => {
      if (!businessId) throw new Error("Atelier non identifié");
      const parsedPrice = values.price ? Number(values.price) : null;
      const defaultPrice =
        parsedPrice !== null && !isNaN(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;
      const { error } = await supabase.from("garment_types").insert({
        business_id: businessId,
        name: values.name,
        default_price: defaultPrice,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["garment-types"] });
      toast.success("Type de vêtement ajouté");
    },
    onError: () => toast.error("Ajout impossible"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!businessId) throw new Error("Atelier non identifié");
      const { error } = await supabase
        .from("garment_types")
        .delete()
        .eq("id", id)
        .eq("business_id", businessId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["garment-types"] }),
  });

  return (
    <section className="card-soft space-y-4 p-5">
      <h2 className="font-display text-sm font-bold">Types de vêtements et tarifs de base</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          const name = String(fd.get("name") ?? "").trim();
          if (!name) return;
          add.mutate({ name, price: String(fd.get("price") ?? "").trim() });
          form.reset();
        }}
      >
        <div className="flex-1 space-y-1.5 min-w-[140px]">
          <Label htmlFor="garment-name">Nom</Label>
          <Input
            id="garment-name"
            name="name"
            placeholder="Boubou brodé"
            className="h-11 text-base sm:text-sm rounded-xl"
          />
        </div>
        <div className="w-36 space-y-1.5">
          <Label htmlFor="garment-price">Prix de base</Label>
          <Input
            id="garment-price"
            name="price"
            type="number"
            min={0}
            className="h-11 text-base sm:text-sm rounded-xl font-medium"
          />
        </div>
        <Button type="submit" disabled={add.isPending} className="h-11 rounded-xl shrink-0">
          <Plus className="size-4" /> Ajouter
        </Button>
      </form>

      <ul className="divide-y divide-border">
        {(list.data ?? []).map((g) => (
          <li key={g.id} className="flex items-center justify-between py-2.5 text-sm">
            <span>{g.name}</span>
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground">
                {g.default_price ? `${money(g.default_price)} FCFA` : "—"}
              </span>
              <button
                type="button"
                onClick={() => remove.mutate(g.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Supprimer ${g.name}`}
              >
                <Trash2 className="size-4" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Templates({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["templates"],
    queryFn: () => fetchTemplates(),
    enabled: true,
  });

  const add = useMutation({
    mutationFn: async (values: { name: string; fields: string }) => {
      if (!businessId) throw new Error("Atelier non identifié");
      const fields = values.fields
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      const { error } = await supabase
        .from("measurement_templates")
        .insert({ business_id: businessId, name: values.name, fields });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Modèle de mesures ajouté");
    },
    onError: () => toast.error("Ajout impossible"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!businessId) throw new Error("Atelier non identifié");
      const { error } = await supabase
        .from("measurement_templates")
        .delete()
        .eq("id", id)
        .eq("business_id", businessId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates"] }),
  });

  return (
    <section className="card-soft space-y-4 p-5">
      <h2 className="font-display text-sm font-bold">Modèles de mesures</h2>
      <p className="text-sm text-muted-foreground">
        Séparez les mesures par des virgules. Elles apparaîtront lors de la prise de mesures.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          const name = String(fd.get("name") ?? "").trim();
          if (!name) return;
          add.mutate({ name, fields: String(fd.get("fields") ?? "") });
          form.reset();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Nom du modèle</Label>
            <Input
              id="tpl-name"
              name="name"
              placeholder="Femme — robe"
              className="h-11 text-base sm:text-sm rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-fields">Mesures</Label>
            <Input
              id="tpl-fields"
              name="fields"
              placeholder="Épaule, Poitrine, Taille, Hanche, Longueur"
              className="h-11 text-base sm:text-sm rounded-xl"
            />
          </div>
          <Button type="submit" disabled={add.isPending} className="h-11 rounded-xl shrink-0">
            <Plus className="size-4" /> Ajouter
          </Button>
        </div>
      </form>

      <ul className="space-y-3">
        {(list.data ?? []).map((t) => (
          <li key={t.id} className="rounded-xl bg-surface p-3">
            <div className="flex items-center justify-between">
              <span className="font-display text-sm font-semibold">{t.name}</span>
              <button
                type="button"
                onClick={() => remove.mutate(t.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Supprimer ${t.name}`}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t.fields.join(" · ")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PasswordChangeSection() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      toast.error("Veuillez saisir un mot de passe.");
      return;
    }
    if (password.length < 6) {
      toast.error("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (password !== confirm) {
      toast.error("Les deux mots de passe ne sont pas identiques.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      toast.error("Modification impossible", { description: error.message });
      return;
    }

    toast.success("Votre mot de passe a bien été modifié !");
    setPassword("");
    setConfirm("");
  }

  const isMatching = confirm && password === confirm;
  const isMismatch = confirm && password !== confirm;

  return (
    <section className="card-soft space-y-4 p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-primary" />
        <h2 className="font-display text-sm font-bold">Sécurité & Mot de passe</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Changez le mot de passe de connexion à votre espace atelier CouturPro.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3.5 max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor="chg-pass">Nouveau mot de passe</Label>
          <div className="relative">
            <Input
              id="chg-pass"
              type={showPassword ? "text" : "password"}
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 caractères"
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              title={showPassword ? "Masquer" : "Afficher"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="chg-confirm">Confirmer le nouveau mot de passe</Label>
          <div className="relative">
            <Input
              id="chg-confirm"
              type={showConfirm ? "text" : "password"}
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Retapez le mot de passe"
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              title={showConfirm ? "Masquer" : "Afficher"}
            >
              {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {isMatching && (
            <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1 pt-0.5">
              <Check className="size-3.5" /> Les deux mots de passe correspondent
            </p>
          )}
          {isMismatch && (
            <p className="text-[11px] text-destructive font-medium pt-0.5">
              Les deux mots de passe sont différents
            </p>
          )}
        </div>

        <Button type="submit" disabled={saving || !password || password.length < 6 || password !== confirm}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer le mot de passe
        </Button>
      </form>
    </section>
  );
}

function ThemeSettingsSection() {
  return (
    <section className="card-soft space-y-3 p-5">
      <div className="space-y-1">
        <h2 className="font-display text-sm font-bold">Apparence & Thème d'affichage</h2>
        <p className="text-xs text-muted-foreground">
          Basculez entre le mode Clair (lumineux), Sombre / Noir (économise la batterie et repose les yeux), ou Automatique (selon votre appareil).
        </p>
      </div>
      <div className="max-w-xs pt-1">
        <ThemeSegmentedControl />
      </div>
    </section>
  );
}

function SessionSignOutSection() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      try {
        await supabase.auth.signOut({ scope: "global" });
      } catch {
        await supabase.auth.signOut();
      }
    } finally {
      if (typeof window !== "undefined") {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          // ignore
        }
      }
      try {
        await clearOfflineDatabase();
      } catch {
        // ignore
      }
      window.location.href = "/auth";
    }
  }

  return (
    <section className="card-soft space-y-3 p-5 border-destructive/20 bg-destructive/5">
      <div className="flex items-center gap-2 text-destructive">
        <LogOut className="size-4.5" />
        <h2 className="font-display text-sm font-bold">Session & Déconnexion</h2>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Déconnectez-vous de votre compte atelier sur cet appareil. Vos données resteront sauvegardées en toute sécurité sur le serveur et le cache local sera assaini.
      </p>
      <Button
        variant="destructive"
        size="sm"
        disabled={loading}
        onClick={handleSignOut}
        className="font-bold cursor-pointer shadow-xs"
      >
        <LogOut className="mr-2 size-4" />
        {loading ? "Déconnexion..." : "Se déconnecter de l'atelier"}
      </Button>
    </section>
  );
}

function PrivacyDataProtectionSection({ business }: { business: { id: string; name: string } }) {
  const [exportingJson, setExportingJson] = useState(false);
  const [exportingClients, setExportingClients] = useState(false);
  const [exportingMeasures, setExportingMeasures] = useState(false);

  async function handleExportJson() {
    setExportingJson(true);
    try {
      await exportCompleteWorkshopJson(business.id, business.name);
      toast.success("Sauvegarde complète téléchargée avec succès");
    } catch {
      toast.error("Échec de la sauvegarde des données");
    } finally {
      setExportingJson(false);
    }
  }

  async function handleExportClients() {
    setExportingClients(true);
    try {
      await exportClientsCsv(business.id, business.name);
      toast.success("Fichier clients téléchargé avec succès");
    } catch {
      toast.error("Échec du téléchargement des clients");
    } finally {
      setExportingClients(false);
    }
  }

  async function handleExportMeasures() {
    setExportingMeasures(true);
    try {
      await exportMeasurementsCsv(business.id, business.name);
      toast.success("Carnet de mesures téléchargé avec succès");
    } catch {
      toast.error("Échec du téléchargement des mesures");
    } finally {
      setExportingMeasures(false);
    }
  }

  return (
    <section className="card-soft space-y-4 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-emerald-600" />
        <h2 className="font-display text-sm font-bold">Sauvegarde & Export des Données</h2>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Téléchargez une copie de vos données (clients, mesures, commandes) pour les conserver en sécurité sur votre appareil. Vos données d'atelier vous appartiennent entièrement.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportingJson}
          onClick={handleExportJson}
          className="text-xs font-semibold justify-start h-auto py-2.5 px-3"
        >
          {exportingJson ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4 text-primary shrink-0" />}
          <div className="text-left">
            <div className="font-bold">Sauvegarde Complète</div>
            <div className="text-[0.65rem] text-muted-foreground">Toutes les données de l'atelier (JSON)</div>
          </div>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportingClients}
          onClick={handleExportClients}
          className="text-xs font-semibold justify-start h-auto py-2.5 px-3"
        >
          {exportingClients ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileSpreadsheet className="mr-2 size-4 text-emerald-600 shrink-0" />}
          <div className="text-left">
            <div className="font-bold">Liste des Clients</div>
            <div className="text-[0.65rem] text-muted-foreground">Fichier Excel (contacts & adresses)</div>
          </div>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportingMeasures}
          onClick={handleExportMeasures}
          className="text-xs font-semibold justify-start h-auto py-2.5 px-3"
        >
          {exportingMeasures ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4 text-amber-600 shrink-0" />}
          <div className="text-left">
            <div className="font-bold">Carnet de Mesures</div>
            <div className="text-[0.65rem] text-muted-foreground">Fichier Excel (gabarits & relevés)</div>
          </div>
        </Button>
      </div>

      <div className="pt-2 flex items-center justify-between text-xs text-muted-foreground border-t border-border/50">
        <span>Règlement de confidentialité & sécurité active</span>
        <a
          href="/politique-confidentialite"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
        >
          Consulter la politique de confidentialité <ExternalLink className="size-3" />
        </a>
      </div>
    </section>
  );
}

function DangerZoneAccountDeletionSection({ business }: { business: { id: string; name: string } }) {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handlePermanentDelete() {
    if (confirmName.trim().toLowerCase() !== business.name.trim().toLowerCase()) {
      toast.error("Le nom saisi ne correspond pas au nom de votre atelier.");
      return;
    }

    setDeleting(true);
    try {
      // 1. Appel RPC sécurisée pour suppression atomique en cascade
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("delete_business_and_all_data", {
        p_business_id: business.id,
      });

      if (error) {
        throw error;
      }

      toast.success("Atelier et données personnelles définitivement supprimés.");

      // 2. Vider le cache de requêtes
      await queryClient.cancelQueries();
      queryClient.clear();

      // 3. Purger le stockage local IndexedDB
      await clearOfflineDatabase();

      // 4. Déconnexion Supabase
      try {
        await supabase.auth.signOut({ scope: "global" });
      } catch {
        await supabase.auth.signOut();
      }

      // 5. Nettoyage mémoire navigateur
      if (typeof window !== "undefined") {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          // ignore
        }
      }

      window.location.href = "/auth?account_deleted=true";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur de suppression";
      toast.error(`Impossible de supprimer l'atelier : ${msg}`);
      setDeleting(false);
    }
  }

  return (
    <>
      <section className="card-soft space-y-3 p-5 border-destructive/30 bg-destructive/5">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-4.5" />
          <h2 className="font-display text-sm font-bold">Zone Sensible — Suppression Définitive de l'Atelier</h2>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Attention : Cette action détruira <strong>irrémédiablement</strong> votre atelier, tous vos clients, leurs mensurations, vos commandes, paiements, photos et transactions. Cette opération est immédiate et irréversible.
        </p>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setOpenDialog(true)}
          className="font-bold cursor-pointer"
        >
          <Trash2 className="mr-2 size-4" /> Supprimer définitivement mon atelier
        </Button>
      </section>

      <AlertDialog open={openDialog} onOpenChange={setOpenDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="size-5 shrink-0" /> Confirmation de destruction totale
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-xs text-left">
              <p>
                Êtes-vous absolument certain de vouloir détruire l'atelier <strong>« {business.name} »</strong> et l'intégralité de ses données ?
              </p>
              <p className="font-semibold text-destructive">
                Toutes vos données clients, mensurations, photos et commandes seront définitivement effacées sans possibilité de récupération.
              </p>
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="confirm-del-biz" className="text-foreground font-semibold">
                  Pour confirmer, tapez exactement le nom de votre atelier :
                </Label>
                <Input
                  id="confirm-del-biz"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={business.name}
                  autoComplete="off"
                  className="font-mono text-xs"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handlePermanentDelete();
              }}
              disabled={deleting || confirmName.trim().toLowerCase() !== business.name.trim().toLowerCase()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />} Détruire définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

