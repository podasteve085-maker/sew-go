import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Crown,
  Loader2,
  Sparkles,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fcfa } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PlanType = "pro_monthly" | "pro_yearly";

const PAYMENT_PROVIDERS = [
  { id: "orange_money", label: "Orange Money", icon: "🟠", color: "border-amber-500/50 hover:bg-amber-500/10" },
  { id: "moov_money", label: "Moov Money", icon: "🔵", color: "border-blue-500/50 hover:bg-blue-500/10" },
  { id: "wave", label: "Wave", icon: "🌊", color: "border-sky-500/50 hover:bg-sky-500/10" },
  { id: "card", label: "Carte bancaire", icon: "💳", color: "border-purple-500/50 hover:bg-purple-500/10" },
] as const;

export function UpgradeDialog({
  open,
  onOpenChange,
  triggerReason,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  triggerReason?: string;
}) {
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();
  const [selectedPlan, setSelectedPlan] = useState<PlanType>("pro_monthly");
  const [provider, setProvider] = useState<string>("orange_money");
  const [phone, setPhone] = useState(business?.phone || "");

  const amount = selectedPlan === "pro_monthly" ? 2500 : 25000;

  const upgradeMutation = useMutation({
    mutationFn: async () => {
      if (!business) throw new Error("Atelier introuvable");

      // Calcul de la date d'expiration
      const expiresAt = new Date();
      if (selectedPlan === "pro_monthly") {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      } else {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }

      // 1. Enregistrement de la transaction de paiement
      const { error: txError } = await supabase.from("payment_transactions").insert({
        business_id: business.id,
        plan: selectedPlan,
        amount,
        currency: "FCFA",
        provider,
        customer_phone: phone.trim() || null,
        status: "completed",
        metadata: {
          simulated: true,
          activated_at: new Date().toISOString(),
          provider_label: PAYMENT_PROVIDERS.find((p) => p.id === provider)?.label ?? provider,
        },
        completed_at: new Date().toISOString(),
      });
      if (txError) {
        console.warn("Notice transaction:", txError);
      }

      // 2. Mise à niveau de l'abonnement du business
      const { error: busError } = await supabase
        .from("businesses")
        .update({
          plan: selectedPlan,
          plan_status: "active",
          plan_expires_at: expiresAt.toISOString(),
        })
        .eq("id", business.id);

      if (busError) throw busError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business"] });
      toast.success("🎉 Félicitations ! Votre atelier est désormais CouturPro !", {
        description:
          selectedPlan === "pro_yearly"
            ? "Abonnement Pro Annuel activé (25 000 FCFA / an — 2 mois offerts). Limites levées !"
            : "Abonnement Pro Mensuel activé (2 500 FCFA / mois). Toutes vos limites sont levées !",
      });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Erreur de paiement";
      toast.error("Impossible de finaliser l'abonnement", { description: msg });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary w-fit">
            <Crown className="size-3.5" /> Passer à CouturPro
          </div>
          <DialogTitle className="font-display text-xl sm:text-2xl font-bold">
            Libérez tout le potentiel de votre atelier
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            {triggerReason || "Ajoutez des clients et enregistrez des commandes en illimité."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Sélecteur de formules */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Mensuel */}
            <button
              type="button"
              onClick={() => setSelectedPlan("pro_monthly")}
              className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
                selectedPlan === "pro_monthly"
                  ? "border-primary bg-primary/5 ring-2 ring-primary shadow-xs"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              <div>
                <span className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Mensuel
                </span>
                <p className="mt-1 font-display text-lg sm:text-xl font-extrabold text-foreground">
                  2 500 <span className="text-xs font-medium">FCFA</span>
                </p>
                <p className="text-[11px] text-muted-foreground">par mois sans engagement</p>
              </div>
              <div className="mt-2.5">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                  <Zap className="size-3" /> Flexibilité totale
                </span>
              </div>
            </button>

            {/* Annuel */}
            <button
              type="button"
              onClick={() => setSelectedPlan("pro_yearly")}
              className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
                selectedPlan === "pro_yearly"
                  ? "border-emerald-600 bg-emerald-500/5 ring-2 ring-emerald-600 shadow-xs"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              <span className="absolute -top-2.5 right-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-2xs">
                2 mois offerts
              </span>
              <div>
                <span className="font-display text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Annuel
                </span>
                <p className="mt-1 font-display text-lg sm:text-xl font-extrabold text-foreground">
                  25 000 <span className="text-xs font-medium">FCFA</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  <span className="line-through text-muted-foreground/70">30 000 FCFA</span> / an
                </p>
              </div>
              <div className="mt-2.5">
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <Sparkles className="size-3" /> Économisez 5 000 F
                </span>
              </div>
            </button>
          </div>

          {/* Avantages inclus */}
          <div className="rounded-xl border border-border/80 bg-surface/70 p-3.5 text-xs space-y-2">
            <p className="font-bold text-foreground">Tout ce qui est débloqué avec Pro :</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" /> Clients illimités
              </span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" /> Commandes illimitées
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600 shrink-0" /> Reçus imprimables & WhatsApp
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600 shrink-0" /> Photos modèles & tissus
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600 shrink-0" /> Statistiques & finances
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600 shrink-0" /> Sauvegarde Cloud continue
              </span>
            </div>
          </div>

          {/* Sélection du moyen de paiement */}
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Moyen de paiement Mobile Money ou Carte :
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id)}
                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                    provider === p.id
                      ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="text-base">{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Numéro de téléphone pour le débit */}
          <div className="space-y-1.5">
            <Label htmlFor="pay-phone" className="text-xs">
              Numéro de téléphone pour le débit
            </Label>
            <Input
              id="pay-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex: 70 00 00 00 ou +226..."
              className="h-10 text-sm font-medium"
            />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
              Paiement 100% sécurisé via agrégateur agréé.
            </p>
          </div>

          {/* Bouton de paiement final */}
          <div className="pt-2">
            <Button
              className="w-full h-11 text-sm font-bold shadow-md"
              disabled={upgradeMutation.isPending}
              onClick={() => upgradeMutation.mutate()}
            >
              {upgradeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Connexion à l'agrégateur…
                </>
              ) : (
                <>Payer {fcfa(amount)} et activer CouturPro ⭐</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
