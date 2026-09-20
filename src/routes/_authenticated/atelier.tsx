import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Image as ImageIcon, KeyRound } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { uploadImage } from "@/hooks/use-signed-url";
import { fetchGarmentTypes, fetchTemplates } from "@/lib/queries";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle, StoredImage } from "@/components/bits";

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
        <div className="flex items-center gap-4">
          {logoPath || business.logo_url ? (
            <StoredImage
              path={logoPath ?? business.logo_url}
              alt="Logo de l'atelier"
              className="size-20 rounded-2xl object-cover"
            />
          ) : (
            <span className="flex size-20 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ImageIcon className="size-6" />
            </span>
          )}
          <div className="flex-1">
            <Label htmlFor="logo">Logo (apparaît sur les reçus)</Label>
            <Input
              id="logo"
              type="file"
              accept="image/*"
              onChange={onLogo}
              disabled={uploading}
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom de l'atelier *</Label>
            <Input id="name" name="name" required defaultValue={business.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner_name">Nom du couturier</Label>
            <Input id="owner_name" name="owner_name" defaultValue={business.owner_name ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Téléphone</Label>
            <Input id="phone" name="phone" inputMode="tel" defaultValue={business.phone ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input
              id="whatsapp"
              name="whatsapp"
              inputMode="tel"
              defaultValue={business.whatsapp ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">Ville</Label>
            <Input id="city" name="city" defaultValue={business.city ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Adresse</Label>
            <Input id="address" name="address" defaultValue={business.address ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency">Monnaie</Label>
            <Input id="currency" name="currency" defaultValue={business.currency} />
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
      <PasswordChangeSection />
    </div>
  );
}

function GarmentTypes({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["garment-types"], queryFn: fetchGarmentTypes });

  const add = useMutation({
    mutationFn: async (values: { name: string; price: string }) => {
      if (!businessId) throw new Error("Atelier non identifié");
      const { error } = await supabase.from("garment_types").insert({
        business_id: businessId,
        name: values.name,
        default_price: values.price ? Number(values.price) : null,
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
      if (!business?.id) throw new Error("Atelier non identifié");
      const { error } = await supabase
        .from("garment_types")
        .delete()
        .eq("id", id)
        .eq("business_id", business.id);
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
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="garment-name">Nom</Label>
          <Input id="garment-name" name="name" placeholder="Boubou brodé" />
        </div>
        <div className="w-36 space-y-1.5">
          <Label htmlFor="garment-price">Prix de base</Label>
          <Input id="garment-price" name="price" type="number" min={0} />
        </div>
        <Button type="submit" disabled={add.isPending}>
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
  const list = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });

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
      if (!business?.id) throw new Error("Atelier non identifié");
      const { error } = await supabase
        .from("measurement_templates")
        .delete()
        .eq("id", id)
        .eq("business_id", business.id);
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
            <Input id="tpl-name" name="name" placeholder="Femme — robe" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-fields">Mesures</Label>
            <Input
              id="tpl-fields"
              name="fields"
              placeholder="Épaule, Poitrine, Taille, Hanche, Longueur"
            />
          </div>
          <Button type="submit" disabled={add.isPending}>
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

    toast.success("Mot de passe modifié avec succès !");
    setPassword("");
    setConfirm("");
  }

  return (
    <section className="card-soft space-y-4 p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-primary" />
        <h2 className="font-display text-sm font-bold">Sécurité & Mot de passe</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Changez le mot de passe de connexion à votre espace atelier CouturPro.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor="chg-pass">Nouveau mot de passe</Label>
          <Input
            id="chg-pass"
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 caractères"
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="chg-confirm">Confirmer le mot de passe</Label>
          <Input
            id="chg-confirm"
            type="password"
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Retapez le mot de passe"
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" disabled={saving || !password}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer le mot de passe
        </Button>
      </form>
    </section>
  );
}

