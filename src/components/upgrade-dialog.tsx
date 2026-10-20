import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Crown,
  Loader2,
  Sparkles,
  ShieldCheck,
  Zap,
  Phone,
  Flame,
  Award,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fcfa } from "@/lib/format";
import { PLAN_CONFIG, type SubscriptionPlan } from "@/lib/quotas";
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
  const [selectedPlan, setSelectedPlan] = useState<Exclude<SubscriptionPlan, "free">>("quarterly");
  const [provider, setProvider] = useState<string>("orange_money");
  const [phone, setPhone] = useState(business?.phone || "");

  const planInfo = PLAN_CONFIG[selectedPlan];
  const amount = planInfo.priceFcfa;

  const upgradeMutation = useMutation({
    mutationFn: async () => {
      if (!business) throw new Error("Atelier introuvable");
      if (!phone || phone.trim().length < 8) {
        throw new Error("Veuillez saisir un numéro de téléphone valide pour le paiement Mobile Money.");
      }

      // Initiation sécurisée d'une transaction d'abonnement
      // Le statut 'pending' est forcé par la base de données et seul le webhook bancaire sécurisé
      // ou l'administrateur peut acter le paiement 'completed' et renouveler les droits de l'atelier.
      const txId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const { error: txError } = await (supabase.from("payment_transactions") as any).insert({
        business_id: business.id,
        plan: selectedPlan,
        provider: provider,
        amount: amount,
        provider_tx_id: txId,
        status: "pending",
        metadata: {
          phone: phone.trim(),
          plan_name: planInfo.name,
          duration_days: planInfo.durationDays,
          initiated_at: new Date().toISOString(),
        },
      });

      if (txError) {
        throw new Error(txError.message || "Erreur lors de l'enregistrement de l'ordre de paiement.");
      }

      return { txId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business"] });
      queryClient.invalidateQueries({ queryKey: ["payment_transactions"] });

      toast.success("Ordre de paiement initié avec succès !", {
        description: `Un débit Mobile Money de ${fcfa(amount)} pour la formule ${planInfo.name} a été envoyé au ${phone}. Validez le push USSD sur votre téléphone.`,
        duration: 8000,
      });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Erreur de paiement";
      toast.error("Impossible d'initier le paiement", { description: msg });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary w-fit">
            <Crown className="size-3.5" /> Passer à CouturPro Pro
          </div>
          <DialogTitle className="font-display text-xl sm:text-2xl font-bold">
            Libérez tout le potentiel de votre atelier
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            {triggerReason || "Enregistrez vos clients, commandes et modèles sans aucune limite."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Sélection des 3 formules d'abonnement */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* 1. Mensuel */}
            <button
              type="button"
              onClick={() => setSelectedPlan("monthly")}
              className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
                selectedPlan === "monthly"
                  ? "border-primary bg-primary/5 ring-2 ring-primary shadow-xs"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              <div>
                <span className="font-display text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Mensuel
                </span>
                <p className="mt-1 font-display text-lg font-extrabold text-foreground">
                  2 000 <span className="text-xs font-medium">FCFA</span>
                </p>
                <p className="text-[11px] text-muted-foreground">pour 1 mois (200 photos)</p>
              </div>
              <div className="mt-2.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
                  <Zap className="size-3" /> Max 200 photos
                </span>
              </div>
            </button>

            {/* 2. Trimestriel (Pass Saison & Fêtes) */}
            <button
              type="button"
              onClick={() => setSelectedPlan("quarterly")}
              className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
                selectedPlan === "quarterly"
                  ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500 shadow-xs"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              <span className="absolute -top-2.5 right-2 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-extrabold text-white shadow-2xs">
                POPULAIRE (-17%)
              </span>
              <div>
                <span className="font-display text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Trimestriel
                </span>
                <p className="mt-1 font-display text-lg font-extrabold text-foreground">
                  5 000 <span className="text-xs font-medium">FCFA</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  soit 1 666 F/mois (3 mois)
                </p>
              </div>
              <div className="mt-2.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                  <Sparkles className="size-3" /> Photos ILLIMITÉES
                </span>
              </div>
            </button>

            {/* 3. Annuel (Maître Couturier) */}
            <button
              type="button"
              onClick={() => setSelectedPlan("yearly")}
              className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
                selectedPlan === "yearly"
                  ? "border-emerald-600 bg-emerald-500/10 ring-2 ring-emerald-600 shadow-xs"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              <span className="absolute -top-2.5 right-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-extrabold text-white shadow-2xs">
                4,5 MOIS OFFERTS
              </span>
              <div>
                <span className="font-display text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Annuel
                </span>
                <p className="mt-1 font-display text-lg font-extrabold text-foreground">
                  15 000 <span className="text-xs font-medium">FCFA</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  soit 1 250 F/mois (1 an)
                </p>
              </div>
              <div className="mt-2.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                  <Sparkles className="size-3" /> Photos ILLIMITÉES HD
                </span>
              </div>
            </button>
          </div>

          {/* Fonctionnalités débloquées avec Pro */}
          <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5 text-xs space-y-2">
            <p className="font-bold text-foreground flex items-center gap-1.5">
              <Award className="size-4 text-primary" /> Tout ce qui est débloqué pour votre atelier :
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" /> Clients illimités (au lieu de 10)
              </span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" /> Commandes illimitées (au lieu de 10)
              </span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" /> Fiches de mesures illimitées
              </span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" />
                {selectedPlan === "monthly"
                  ? "Catalogue : jusqu'à 200 photos"
                  : "Catalogue : photos 100% ILLIMITÉES"}
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600 shrink-0" /> Reçus imprimables & WhatsApp avec logo
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600 shrink-0" /> Sauvegarde Cloud continue garantie
              </span>
            </div>
          </div>

          {/* Sélection du moyen de paiement */}
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Moyen de paiement Mobile Money ou Carte :
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PAYMENT_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                    provider === p.id
                      ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="text-sm">{p.icon}</span>
                  <span className="truncate">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Numéro de téléphone pour le débit Mobile Money */}
          <div className="space-y-1.5">
            <Label htmlFor="pay-phone" className="text-xs flex items-center gap-1">
              <Phone className="size-3.5 text-muted-foreground" /> Numéro de téléphone Mobile Money pour le débit
            </Label>
            <Input
              id="pay-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex: +226 70 00 00 00 ou 76..."
              className="h-11 text-base sm:text-sm rounded-xl font-medium"
            />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
              Paiement sécurisé. Vos données d'atelier sont protégées en permanence.
            </p>
          </div>

          {/* Bouton d'activation immédiate */}
          <div className="pt-2">
            <Button
              className="w-full h-11 text-sm font-bold shadow-md bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={upgradeMutation.isPending}
              onClick={() => upgradeMutation.mutate()}
            >
              {upgradeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Activation en cours…
                </>
              ) : (
                <>Activer le {planInfo.name} ({fcfa(amount)}) ⭐</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
