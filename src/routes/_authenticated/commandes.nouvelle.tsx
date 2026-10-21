import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
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
  Camera,
  Trash2,
  Upload,
  X,
  ChevronDown,
  Calendar,
  Check,
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
  saveOrderImageOffline,
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
import { checkOrderQuota, isSubscriptionExpired } from "@/lib/quotas";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  function removeImage(indexToRemove: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  }

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

      // Mode Consultation : vérifier si l'abonnement est expiré
      if (isSubscriptionExpired(business)) {
        const msg = "Votre atelier est en mode Consultation bienveillant. Vos commandes restent sécurisées et consultables. Réactivez votre Pass Atelier pour lancer de nouvelles confections.";
        setQuotaReason(msg);
        setUpgradeOpen(true);
        throw new Error(msg);
      }

      // Contrôle strict du quota de commandes pour la formule Découverte
      const { count, error: countErr } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id);

      if (!countErr && typeof count === "number") {
        const quota = checkOrderQuota(business, count);
        if (!quota.allowed) {
          setQuotaReason(quota.message || "Limite de 10 commandes atteinte.");
          setUpgradeOpen(true);
          throw new Error(quota.message || "Limite de 10 commandes atteinte.");
        }
      }

      const rawTotal = Number(values["price"] || 0);
      const totalVal = isNaN(rawTotal) || rawTotal < 0 ? 0 : rawTotal;
      const rawDeposit = Number(values["deposit"] || 0);
      const depositVal = isNaN(rawDeposit) || rawDeposit < 0 ? 0 : rawDeposit;

      if (depositVal > totalVal) {
        throw new Error("L'acompte ne peut pas être supérieur au prix total.");
      }

      const rawQty = Number(values["quantity"] || 1);
      const order = await saveOrderOffline({
        business_id: business.id,
        client_id: selectedClientId,
        garment_type: values["garment_type"] ?? "",
        fabric: values["fabric"] || null,
        quantity: isNaN(rawQty) || rawQty < 1 ? 1 : Math.round(rawQty),
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
          business_id: business.id,
          order_id: orderId,
          amount: depositVal,
          method: values["deposit_method"] || "especes",
          paid_at: today(),
          note: "Acompte à la commande",
        });
      }

      if (images.length) {
        for (const img of images) {
          try {
            await saveOrderImageOffline({
              order_id: orderId,
              path: img.path,
              kind: img.kind,
            });
          } catch {
            // continuer pour les autres images
          }
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
    <div className="mx-auto max-w-3xl space-y-6 pb-16">
      {/* En-tête aéré et clair */}
      <div className="space-y-1.5">
        <Link
          to="/commandes"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <ArrowLeft className="size-4" /> Retour aux commandes
        </Link>
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
          Nouvelle commande
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Enregistrez une confection d'atelier, planifiez la date de livraison et suivez l'acompte.
        </p>
      </div>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const values: Record<string, string> = {};
          fd.forEach((v, k) => {
            values[k] = String(v).trim();
          });
          if (!selectedClientId) {
            toast.error("Veuillez sélectionner un client ou en créer un nouveau");
            return;
          }
          create.mutate(values);
        }}
      >
        {search.model && (
          <div className="flex items-center justify-between rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent p-4 text-xs font-semibold text-primary shadow-2xs">
            <span className="flex items-center gap-2">
              <Sparkles className="size-4.5 shrink-0" />
              <span>Modèle sélectionné depuis le Lookbook : <strong>{search.garment || "Modèle"}</strong></span>
            </span>
            <Link to="/catalogue" className="underline font-bold hover:opacity-80 shrink-0 ml-2">
              Changer
            </Link>
          </div>
        )}

        {/* ── SECTION 1 : Client & Choix du modèle ── */}
        <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-2.5 border-b border-border/70 pb-3.5">
            <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary font-display font-bold text-xs">
              1
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-foreground">
                Client & Vêtement
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Associez cette confection au client et précisez le modèle.
              </p>
            </div>
          </div>

          {/* Sélecteur de client */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="client_id" className="text-xs sm:text-sm font-semibold">
                Client de la commande <span className="text-destructive">*</span>
              </Label>
              <button
                type="button"
                onClick={() => setOpenNewClient(true)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline cursor-pointer"
              >
                <UserPlus className="size-3.5" /> + Nouveau client
              </button>
            </div>
            <div className="relative">
              <select
                id="client_id"
                name="client_id"
                required
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="h-11 sm:h-12 w-full appearance-none rounded-xl border border-border/80 bg-background px-3.5 pr-10 text-base sm:text-sm font-medium transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-2xs"
              >
                <option value="">Sélectionnez un client dans votre carnet…</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {fullName(c)} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          {/* Aperçu des mesures du client sélectionné */}
          {selectedClientId && (
            <div className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-display text-xs font-bold text-foreground">
                  <Ruler className="size-4 text-primary" /> Fiche de mesures du client
                </span>
                <button
                  type="button"
                  onClick={() => setOpenNewMeasure(true)}
                  className="text-xs font-bold text-primary hover:underline cursor-pointer"
                >
                  {latestMeasure ? "+ Nouveau relevé" : "+ Prendre les mesures"}
                </button>
              </div>

              {latestMeasure ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Dernière prise de mesure : <strong className="text-foreground">{latestMeasure.template_name || latestMeasure.label || "Mesures"}</strong> du {dateFr(latestMeasure.recorded_at)}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(latestMeasure.measurement_values ?? []).slice(0, 6).map((v) => (
                      <div key={v.id} className="flex justify-between items-center rounded-lg bg-card/80 px-2.5 py-1.5 border border-border/60 text-xs">
                        <span className="text-muted-foreground truncate">{v.name}</span>
                        <span className="font-bold text-foreground ml-1">{v.value ?? "—"} {v.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Aucune mesure enregistrée pour ce client. Cliquez sur <strong>+ Prendre les mesures</strong> pour les enregistrer immédiatement.
                </p>
              )}
            </div>
          )}

          {/* Modèles fréquents (chips tactiles 1-clic) */}
          <div className="space-y-2 pt-1">
            <Label className="text-xs text-muted-foreground font-medium">
              Modèles fréquents (toucher pour remplir automatiquement) :
            </Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_GARMENTS.map((g) => {
                const isSelected = garmentType.toLowerCase() === g.name.toLowerCase();
                return (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => onGarmentChange(g.name)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
                      isSelected
                        ? "bg-primary text-primary-foreground border border-primary shadow-xs"
                        : "bg-background text-foreground border border-border hover:bg-muted/60"
                    }`}
                  >
                    <span>{g.icon}</span>
                    <span>{g.name}</span>
                    {isSelected && <Check className="size-3.5 ml-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vêtement, Tissu et Quantité */}
          <div className="grid gap-4 sm:grid-cols-2 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="garment_type" className="text-xs sm:text-sm font-semibold">
                Type de vêtement <span className="text-destructive">*</span>
              </Label>
              <input
                id="garment_type"
                name="garment_type"
                required
                value={garmentType}
                onChange={(e) => onGarmentChange(e.target.value)}
                list="garment-list"
                className="h-11 sm:h-12 w-full rounded-xl border border-border/80 bg-background px-3.5 text-base sm:text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-2xs"
                placeholder="Ex : Boubou 3 pièces, Robe cocktail…"
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
              <Label htmlFor="fabric" className="text-xs sm:text-sm font-semibold">
                Tissu / Pagne
              </Label>
              <Input
                id="fabric"
                name="fabric"
                placeholder="Ex : Faso Dan Fani, Bazin riche, Wax hollandais…"
                value={fabric}
                onChange={(e) => setFabric(e.target.value)}
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="quantity" className="text-xs sm:text-sm font-semibold">
                Nombre de pièces (quantité)
              </Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={1}
                defaultValue={1}
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background max-w-xs shadow-2xs"
              />
            </div>
          </div>
        </section>

        {/* ── SECTION 2 : Tarification, Délais & Règlement ── */}
        <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-2.5 border-b border-border/70 pb-3.5">
            <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary font-display font-bold text-xs">
              2
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-foreground">
                Prix, Délais & Acompte
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Fixez le tarif de couture, le délai promis et enregistrez l'avance.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="price" className="text-xs sm:text-sm font-semibold">
                Prix total de la commande (FCFA) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="price"
                name="price"
                type="number"
                min={0}
                required
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Ex : 25 000"
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm font-extrabold bg-background shadow-2xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deposit" className="text-xs sm:text-sm font-semibold">
                Acompte versé à la commande (FCFA)
              </Label>
              <Input
                id="deposit"
                name="deposit"
                type="number"
                min={0}
                inputMode="numeric"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                placeholder="Ex : 10 000"
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm font-bold bg-background shadow-2xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deposit_method" className="text-xs sm:text-sm font-semibold">
                Mode de paiement de l'acompte
              </Label>
              <div className="relative">
                <select
                  id="deposit_method"
                  name="deposit_method"
                  className="h-11 sm:h-12 w-full appearance-none rounded-xl border border-border/80 bg-background px-3.5 pr-10 text-base sm:text-sm font-medium transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-2xs"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="due_date" className="text-xs sm:text-sm font-semibold">
                Date de livraison prévue
              </Label>
              <Input
                id="due_date"
                name="due_date"
                type="date"
                defaultValue={addDays(7)}
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background shadow-2xs"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ordered_at" className="text-xs sm:text-sm font-semibold">
                Date de prise de commande
              </Label>
              <Input
                id="ordered_at"
                name="ordered_at"
                type="date"
                defaultValue={today()}
                className="h-11 sm:h-12 rounded-xl text-base sm:text-sm bg-background max-w-xs shadow-2xs"
              />
            </div>
          </div>

          {/* Synthèse financière intelligente en temps réel */}
          <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Coins className="size-4 text-primary" /> Synthèse financière en direct
              </span>
              {Number(price || 0) > 0 && Number(deposit || 0) >= Number(price || 0) ? (
                <span className="rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
                  Totalement Réglé
                </span>
              ) : Number(deposit || 0) > 0 ? (
                <span className="rounded-full bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 text-[10px] font-bold">
                  Acompte versé
                </span>
              ) : (
                <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px] font-bold">
                  En attente de paiement
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
              <div className="rounded-xl bg-card p-3 border border-border/80 shadow-2xs">
                <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Prix Total</p>
                <p className="mt-1 font-display text-sm sm:text-lg font-extrabold text-foreground">
                  {fcfa(Number(price || 0))}
                </p>
              </div>

              <div className="rounded-xl bg-card p-3 border border-border/80 shadow-2xs">
                <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Acompte</p>
                <p className="mt-1 font-display text-sm sm:text-lg font-extrabold text-primary">
                  {fcfa(Number(deposit || 0))}
                </p>
              </div>

              <div
                className={`rounded-xl p-3 border shadow-2xs ${
                  Number(deposit || 0) > Number(price || 0)
                    ? "border-destructive/40 bg-destructive/15 text-destructive"
                    : Number(price || 0) > 0 && Number(deposit || 0) >= Number(price || 0)
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                    : "border-border/80 bg-card text-foreground"
                }`}
              >
                <p className="text-[10px] uppercase font-bold tracking-wider">
                  {Number(deposit || 0) > Number(price || 0) ? "Dépassement" : "Reste à payer"}
                </p>
                <p className="mt-1 font-display text-sm sm:text-lg font-extrabold">
                  {Number(deposit || 0) > Number(price || 0)
                    ? "Erreur montant"
                    : fcfa(Math.max(0, Number(price || 0) - Number(deposit || 0)))}
                </p>
              </div>
            </div>

            {Number(deposit || 0) > Number(price || 0) && (
              <p className="text-center text-xs font-bold text-destructive">
                ⚠️ Attention : l'acompte saisi ({fcfa(Number(deposit))}) dépasse le montant total ({fcfa(Number(price))}).
              </p>
            )}
          </div>
        </section>

        {/* ── SECTION 3 : Détails de coupe & Photos du modèle ── */}
        <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-2.5 border-b border-border/70 pb-3.5">
            <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary font-display font-bold text-xs">
              3
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-foreground">
                Consignes d'atelier & Photos
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Instructions particulières pour le coupeur et photos de référence.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs sm:text-sm font-semibold">
              Description & Style souhaité par le client
            </Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Ex : Col officier brodé fil doré, manches 3/4, poches passepoilées, fentes latérales…"
              className="rounded-xl text-base sm:text-sm bg-background"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs sm:text-sm font-semibold">
              Notes d'atelier internes (visibles uniquement par votre équipe)
            </Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="Ex : Tissu fragile à repasser à basse température, boutonnière contrastée..."
              className="rounded-xl text-base sm:text-sm bg-background"
            />
          </div>

          {/* Zone Photo Moderne (Zéro input moche par défaut) */}
          <div className="space-y-3 pt-1">
            <Label className="text-xs sm:text-sm font-semibold">
              Photos du modèle, tissu ou croquis (recommandé)
            </Label>

            {/* Sélecteur de type de photo en pilules */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Type :</span>
              {IMAGE_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setImageKind(k.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                    imageKind === k.value
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            {/* Input fichier masqué pour déclenchement tactile propre */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              disabled={uploading}
              className="hidden"
            />

            {/* Zone de déclenchement tactile et visuelle */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/35 bg-primary/5 hover:bg-primary/10 active:scale-[0.99] p-5 text-center transition-all cursor-pointer disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <span className="text-xs font-bold text-foreground">Envoi de la photo en cours…</span>
                </>
              ) : (
                <>
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-2xs">
                    <Camera className="size-5.5" />
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm font-bold text-foreground">
                      Prendre une photo ou importer un fichier
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Caméra smartphone, galerie de photos ou documents de patron (PNG, JPG)
                    </p>
                  </div>
                </>
              )}
            </button>

            {/* Galerie des photos ajoutées avec bouton de suppression */}
            {images.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-semibold text-muted-foreground">
                  {images.length} photo(s) attachée(s) :
                </p>
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
                  {images.map((img, idx) => (
                    <div
                      key={img.path}
                      className="group relative rounded-xl overflow-hidden border border-border bg-card shadow-2xs aspect-square"
                    >
                      <StoredImage
                        path={img.path}
                        alt="Photo de confection"
                        className="size-full object-cover"
                      />
                      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-extrabold text-white uppercase tracking-wider">
                        {img.kind}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-xs active:scale-90"
                        title="Supprimer la photo"
                        aria-label="Supprimer la photo"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── BARRE D'ACTIONS DE SOUMISSION ── */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            asChild
            className="w-full sm:w-auto h-11 text-muted-foreground hover:text-foreground font-semibold"
          >
            <Link to="/commandes">Annuler</Link>
          </Button>

          <Button
            type="submit"
            disabled={create.isPending || uploading}
            className="w-full sm:w-auto h-12 px-8 rounded-xl font-extrabold text-base shadow-md bg-primary hover:bg-primary/90 text-primary-foreground active:scale-95 transition-all"
          >
            {create.isPending ? (
              <>
                <Loader2 className="mr-2 size-5 animate-spin" /> Enregistrement de la commande…
              </>
            ) : (
              <>
                <Check className="mr-2 size-5" /> Enregistrer la commande
              </>
            )}
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

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        triggerReason={quotaReason}
      />
    </div>
  );
}
