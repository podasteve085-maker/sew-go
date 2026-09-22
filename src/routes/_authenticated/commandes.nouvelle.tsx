import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  Image as ImageIcon,
  UserPlus,
  Ruler,
  Plus,
  CheckCircle2,
  Coins,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { uploadImage } from "@/hooks/use-signed-url";
import {
  fetchClients,
  fetchGarmentTypes,
  fetchMeasurementSets,
  saveOrderOffline,
  savePaymentOffline,
} from "@/lib/queries";
import { IMAGE_KINDS, PAYMENT_METHODS } from "@/lib/domain";
import { addDays, fullName, today, dateFr, fcfa } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StoredImage } from "@/components/bits";
import { ClientFormDialog } from "@/components/client-form-dialog";
import { MeasurementDialog } from "@/components/measurement-dialog";
import { checkOrderQuota } from "@/lib/quotas";
import { UpgradeDialog } from "@/components/upgrade-dialog";

export const Route = createFileRoute("/_authenticated/commandes/nouvelle")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    client?: string | undefined;
    model?: string | undefined;
    garment?: string | undefined;
    price?: string | undefined;
    fabric?: string | undefined;
  } => ({
    client: typeof search["client"] === "string" ? search["client"] : undefined,
    model: typeof search["model"] === "string" ? search["model"] : undefined,
    garment: typeof search["garment"] === "string" ? search["garment"] : undefined,
    price: typeof search["price"] === "string" ? search["price"] : undefined,
    fabric: typeof search["fabric"] === "string" ? search["fabric"] : undefined,
  }),
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
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();

  const [selectedClientId, setSelectedClientId] = useState<string>(search.client ?? "");
  const [openNewClient, setOpenNewClient] = useState(false);
  const [openNewMeasure, setOpenNewMeasure] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [quotaReason, setQuotaReason] = useState("");

  const clients = useQuery({
    queryKey: ["clients", ""],
    queryFn: () => fetchClients(),
    enabled: true,
  });
  const garments = useQuery({
    queryKey: ["garment-types"],
    queryFn: () => fetchGarmentTypes(),
    enabled: true,
  });

  // Mesures du client sélectionné
  const clientMeasures = useQuery({
    queryKey: ["measurements", selectedClientId],
    queryFn: () => fetchMeasurementSets(selectedClientId),
    enabled: Boolean(selectedClientId),
  });

  const latestMeasure = clientMeasures.data?.[0];

  const [garmentType, setGarmentType] = useState(search.garment ?? "");
  const [price, setPrice] = useState(search.price ?? "");
  const [fabric, setFabric] = useState(search.fabric ?? "");
  const [deposit, setDeposit] = useState("");
  const [images, setImages] = useState<{ path: string; kind: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [imageKind, setImageKind] = useState<string>("modele");

  const PRESET_GARMENTS = [
    { name: "Boubou", icon: "👔" },
    { name: "Faso Dan Fani", icon: "🧵" },
    { name: "Robe", icon: "👗" },
    { name: "Chemise", icon: "👕" },
    { name: "Pantalon", icon: "👖" },
    { name: "Costume", icon: "🧥" },
    { name: "Ensemble", icon: "✨" },
  ];

  function onGarmentChange(val: string) {
    setGarmentType(val);
    const found = garments.data?.find((g) => g.name.toLowerCase() === val.toLowerCase());
    if (found?.default_price) {
      setPrice(String(found.default_price));
    }
  }

  const create = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      if (!business) throw new Error("no business");

      // Contrôle du quota de commandes du mois en cours pour le plan Gratuit
      const currentMonthStart = new Date().toISOString().slice(0, 7) + "-01";
      const { count, error: countErr } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .gte("ordered_at", currentMonthStart);

      if (!countErr && typeof count === "number") {
        const quota = checkOrderQuota(business, count);
        if (!quota.allowed) {
          setQuotaReason(quota.message || "Limite mensuelle de commandes atteinte.");
          setUpgradeOpen(true);
          throw new Error(quota.message || "Limite mensuelle de commandes atteinte.");
        }
      }

      const totalVal = Number(values["price"] || 0);
      const depositVal = Number(values["deposit"] || 0);

      if (depositVal > totalVal) {
        throw new Error("L'acompte ne peut pas être supérieur au prix total.");
      }

      const order = await saveOrderOffline({
        business_id: business.id,
        client_id: selectedClientId,
        garment_type: values["garment_type"] ?? "",
        fabric: values["fabric"] || null,
        quantity: Number(values["quantity"] || 1),
        description: values["description"] || null,
        price: totalVal,
        ordered_at: values["ordered_at"] || today(),
        due_date: values["due_date"] || null,
        notes: values["notes"] || null,
        status: "nouvelle",
      }, true);
      const orderId = order.id;

      if (depositVal > 0) {
        await savePaymentOffline({
          order_id: orderId,
          amount: depositVal,
          method: values["deposit_method"] || "especes",
          paid_at: today(),
          note: "Acompte à la commande",
        });
      }

      if (images.length && (typeof navigator === "undefined" || navigator.onLine)) {
        try {
          await supabase.from("order_images").insert(
            images.map((img) => ({
              business_id: business.id,
              order_id: orderId,
              path: img.path,
              kind: img.kind,
            })),
          );
        } catch {
          // ignore offline image attachment
        }
      }
      return orderId;
    },
    onSuccess: (orderId) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Commande enregistrée avec succès");
      navigate({ to: "/commandes/$orderId", params: { orderId } });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Création impossible";
      toast.error(msg);
    },
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
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
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
          if (!selectedClientId) {
            toast.error("Choisissez un client ou créez-en un");
            return;
          }
          create.mutate(values);
        }}
      >
        {search.model && (
          <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary">
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-4" /> Modèle Lookbook : <strong>{search.garment || "Sélectionné"}</strong>
            </span>
            <Link to="/catalogue" className="underline hover:opacity-80">
              Changer
            </Link>
          </div>
        )}
        {/* Client Selector with inline Create button */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="client_id">Client *</Label>
            <button
              type="button"
              onClick={() => setOpenNewClient(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <UserPlus className="size-3.5" /> + Nouveau client
            </button>
          </div>
          <select
            id="client_id"
            name="client_id"
            required
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
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

        {/* Aperçu des mesures du client sélectionné */}
        {selectedClientId && (
          <div className="rounded-xl border border-border bg-surface p-3.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-display text-xs font-bold text-foreground">
                <Ruler className="size-4 text-primary" /> Carnet de mesures du client
              </span>
              <button
                type="button"
                onClick={() => setOpenNewMeasure(true)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {latestMeasure ? "+ Nouveau relevé" : "+ Prendre les mesures"}
              </button>
            </div>

            {latestMeasure ? (
              <div className="mt-2.5 space-y-2">
                <p className="text-[0.7rem] text-muted-foreground">
                  Dernier relevé : <strong>{latestMeasure.template_name || latestMeasure.label || "Mesures"}</strong> du {dateFr(latestMeasure.recorded_at)}
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
                  {(latestMeasure.measurement_values ?? []).slice(0, 6).map((v) => (
                    <div key={v.id} className="flex justify-between border-b border-dashed border-border/60 text-xs">
                      <span className="text-muted-foreground truncate">{v.name}</span>
                      <span className="font-semibold">{v.value ?? "—"} {v.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Ce client n'a pas encore de mesures enregistrées. Vous pouvez les saisir maintenant.
              </p>
            )}
          </div>
        )}

        {/* Raccourcis visuels rapides vêtements */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Modèles fréquents (1-clic pour choisir) :</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_GARMENTS.map((g) => (
              <button
                key={g.name}
                type="button"
                onClick={() => onGarmentChange(g.name)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                  garmentType.toLowerCase() === g.name.toLowerCase()
                    ? "border-primary bg-primary text-primary-foreground shadow-xs"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                <span>{g.icon}</span>
                <span>{g.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="garment_type">Vêtement *</Label>
            <input
              id="garment_type"
              name="garment_type"
              required
              value={garmentType}
              onChange={(e) => onGarmentChange(e.target.value)}
              list="garment-list"
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-base sm:text-sm"
              placeholder="Boubou, Faso Dan Fani, Robe…"
            />
            <datalist id="garment-list">
              {(garments.data ?? []).map((g) => (
                <option key={g.id} value={g.name}>
                  {g.default_price ? `${g.default_price} FCFA` : ""}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fabric">Tissu</Label>
            <Input
              id="fabric"
              name="fabric"
              placeholder="Faso Dan Fani, Bazin, Wax…"
              value={fabric}
              onChange={(e) => setFabric(e.target.value)}
              className="h-10 text-base sm:text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quantity">Quantité</Label>
            <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} className="h-10 text-base sm:text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price">Prix total (FCFA) *</Label>
            <Input
              id="price"
              name="price"
              type="number"
              min={0}
              required
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="ex: 35000"
              className="h-10 text-base font-bold sm:text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ordered_at">Date de commande</Label>
            <Input id="ordered_at" name="ordered_at" type="date" defaultValue={today()} className="h-10 text-base sm:text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due_date">Date de livraison prévue</Label>
            <Input id="due_date" name="due_date" type="date" defaultValue={addDays(7)} className="h-10 text-base sm:text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deposit">Acompte versé (FCFA)</Label>
            <Input
              id="deposit"
              name="deposit"
              type="number"
              min={0}
              inputMode="numeric"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              placeholder="ex: 15000"
              className="h-10 text-base font-bold sm:text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deposit_method">Moyen de paiement de l'acompte</Label>
            <select
              id="deposit_method"
              name="deposit_method"
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-base sm:text-sm"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Calculateur financier visuel en direct */}
        <div className="rounded-xl border border-border bg-surface p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <span>Synthèse financière</span>
            <Coins className="size-4 text-primary" />
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-card p-2 border border-border/60">
              <p className="text-[0.65rem] uppercase font-semibold text-muted-foreground">Prix total</p>
              <p className="mt-0.5 font-display text-sm sm:text-base font-bold text-foreground">
                {fcfa(Number(price || 0))}
              </p>
            </div>
            <div className="rounded-lg bg-card p-2 border border-border/60">
              <p className="text-[0.65rem] uppercase font-semibold text-muted-foreground">Acompte</p>
              <p className="mt-0.5 font-display text-sm sm:text-base font-bold text-primary">
                {fcfa(Number(deposit || 0))}
              </p>
            </div>
            <div
              className={`rounded-lg p-2 border ${
                Number(deposit || 0) > Number(price || 0)
                  ? "border-destructive/40 bg-destructive/15 text-destructive"
                  : Number(price || 0) > 0 && Number(price || 0) <= Number(deposit || 0)
                  ? "border-success/40 bg-success/15 text-success"
                  : "border-border/60 bg-card text-foreground"
              }`}
            >
              <p className="text-[0.65rem] uppercase font-semibold">
                {Number(deposit || 0) > Number(price || 0) ? "Alerte !" : "Reste à payer"}
              </p>
              <p className="mt-0.5 font-display text-sm sm:text-base font-bold">
                {Number(deposit || 0) > Number(price || 0)
                  ? "Dépassement"
                  : fcfa(Math.max(0, Number(price || 0) - Number(deposit || 0)))}
              </p>
            </div>
          </div>
          {Number(deposit || 0) > Number(price || 0) && (
            <p className="mt-2 text-center text-xs font-bold text-destructive">
              ⚠️ Attention : l'acompte saisi ({fcfa(Number(deposit))}) est supérieur au prix total ({fcfa(Number(price))}).
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description & Style du modèle</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            placeholder="Détails : manches longues, col rond brodé, doublure coton, poches passepoilées…"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes d'atelier (internes)</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            placeholder="Observations pour le tailleur ou le coupeur..."
          />
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
              <ImageIcon className="size-3.5" /> Optionnel, mais recommandé pour éviter les erreurs de style.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" asChild>
            <Link to="/commandes">Annuler</Link>
          </Button>
          <Button type="submit" disabled={create.isPending || uploading}>
            {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer la commande
          </Button>
        </div>
      </form>

      {/* Modale de création rapide de client */}
      {business && (
        <ClientFormDialog
          open={openNewClient}
          onOpenChange={setOpenNewClient}
          businessId={business.id}
          onCreated={(newClientId) => {
            setSelectedClientId(newClientId);
            queryClient.invalidateQueries({ queryKey: ["clients"] });
          }}
        />
      )}

      {/* Modale de prise de mesures rapide */}
      {business && selectedClientId && (
        <MeasurementDialog
          open={openNewMeasure}
          onOpenChange={setOpenNewMeasure}
          businessId={business.id}
          clientId={selectedClientId}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["measurements", selectedClientId] });
          }}
        />
      )}
      {/* Modale d'abonnement / passage à Pro */}
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        triggerReason={quotaReason}
      />
    </div>
  );
}
