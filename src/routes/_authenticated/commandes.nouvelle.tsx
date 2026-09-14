import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { uploadImage } from "@/hooks/use-signed-url";
import { fetchClients, fetchGarmentTypes } from "@/lib/queries";
import { IMAGE_KINDS, PAYMENT_METHODS } from "@/lib/domain";
import { addDays, fullName, today } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StoredImage } from "@/components/bits";

export const Route = createFileRoute("/_authenticated/commandes/nouvelle")({
  validateSearch: (search: Record<string, unknown>): { client?: string } =>
    typeof search["client"] === "string" ? { client: search["client"] } : {},
  head: () => ({
    meta: [
      { title: "Nouvelle commande — CouturPro" },
      {
        name: "description",
        content:
          "Enregistrez une commande : client, vêtement, tissu, prix, délai, acompte et photos du modèle.",
      },
      { property: "og:title", content: "Nouvelle commande — CouturPro" },
      { property: "og:description", content: "Créer une commande de couture en quelques secondes." },
    ],
  }),
  component: NewOrder,
});

function NewOrder() {
  const { client: clientParam } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => fetchClients() });
  const garments = useQuery({ queryKey: ["garment-types"], queryFn: fetchGarmentTypes });
  const [images, setImages] = useState<{ path: string; kind: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [imageKind, setImageKind] = useState<string>("modele");

  const create = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      if (!business) throw new Error("no business");
      const { data, error } = await supabase
        .from("orders")
        .insert({
          business_id: business.id,
          client_id: values["client_id"] ?? "",
          garment_type: values["garment_type"] ?? "",
          fabric: values["fabric"] || null,
          quantity: Number(values["quantity"] || 1),
          description: values["description"] || null,
          price: Number(values["price"] || 0),
          ordered_at: values["ordered_at"] || today(),
          due_date: values["due_date"] || null,
          notes: values["notes"] || null,
          status: "nouvelle",
        })
        .select("id")
        .single();
      if (error) throw error;
      const orderId = (data as { id: string }).id;

      const deposit = Number(values["deposit"] || 0);
      if (deposit > 0) {
        const { error: payError } = await supabase.from("payments").insert({
          business_id: business.id,
          order_id: orderId,
          amount: deposit,
          method: values["deposit_method"] || "especes",
          paid_at: today(),
          note: "Acompte à la commande",
        });
        if (payError) throw payError;
      }

      if (images.length) {
        const { error: imgError } = await supabase.from("order_images").insert(
          images.map((img) => ({
            business_id: business.id,
            order_id: orderId,
            path: img.path,
            kind: img.kind,
          })),
        );
        if (imgError) throw imgError;
      }
      return orderId;
    },
    onSuccess: (orderId) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Commande enregistrée");
      navigate({ to: "/commandes/$orderId", params: { orderId } });
    },
    onError: () => toast.error("Création impossible"),
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !business) return;
    setUploading(true);
    try {
      const path = await uploadImage(business.id, file, "orders");
      setImages((prev) => [...prev, { path, kind: imageKind }]);
    } catch {
      toast.error("Photo non envoyée");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        to="/commandes"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" /> Commandes
      </Link>
      <h1 className="font-display text-xl font-bold">Nouvelle commande</h1>

      <form
        className="card-soft space-y-5 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const values: Record<string, string> = {};
          fd.forEach((v, k) => {
            values[k] = String(v).trim();
          });
          if (!values["client_id"]) {
            toast.error("Choisissez un client");
            return;
          }
          create.mutate(values);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="client_id">Client *</Label>
          <select
            id="client_id"
            name="client_id"
            required
            defaultValue={clientParam ?? ""}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Choisir un client…</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {fullName(c)} {c.phone ? `— ${c.phone}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="garment_type">Vêtement *</Label>
            <input
              id="garment_type"
              name="garment_type"
              required
              list="garment-list"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              placeholder="Boubou, Complet, Robe…"
            />
            <datalist id="garment-list">
              {(garments.data ?? []).map((g) => (
                <option key={g.id} value={g.name} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fabric">Tissu</Label>
            <Input id="fabric" name="fabric" placeholder="Faso Dan Fani, Bazin…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quantity">Quantité</Label>
            <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price">Prix total (FCFA) *</Label>
            <Input id="price" name="price" type="number" min={0} required inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ordered_at">Date de commande</Label>
            <Input id="ordered_at" name="ordered_at" type="date" defaultValue={today()} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due_date">Date de livraison prévue</Label>
            <Input id="due_date" name="due_date" type="date" defaultValue={addDays(7)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deposit">Acompte versé (FCFA)</Label>
            <Input id="deposit" name="deposit" type="number" min={0} inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deposit_method">Moyen de paiement</Label>
            <select
              id="deposit_method"
              name="deposit_method"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description du modèle</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            placeholder="Manches longues, col mao, broderie dorée au col…"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes internes</Label>
          <Textarea id="notes" name="notes" rows={2} />
        </div>

        <div className="space-y-2">
          <Label>Photos (modèle souhaité, tissu, croquis)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={imageKind}
              onChange={(e) => setImageKind(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              aria-label="Type de photo"
            >
              {IMAGE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <Input
              type="file"
              accept="image/*"
              onChange={onFile}
              disabled={uploading}
              className="max-w-xs"
            />
            {uploading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {images.map((img) => (
                <StoredImage
                  key={img.path}
                  path={img.path}
                  alt="Photo de la commande"
                  className="size-20 rounded-lg object-cover"
                />
              ))}
            </div>
          )}
          {images.length === 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ImageIcon className="size-3.5" /> Optionnel, mais très utile pour éviter les malentendus.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" asChild>
            <Link to="/commandes">Annuler</Link>
          </Button>
          <Button type="submit" disabled={create.isPending || uploading}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />} Enregistrer la commande
          </Button>
        </div>
      </form>
    </div>
  );
}
