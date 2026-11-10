import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  KeyRound,
  MessageCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fcfa } from "@/lib/format";
import { PLAN_CONFIG, WHATSAPP_BILLING_PHONE, type SubscriptionPlan } from "@/lib/quotas";
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
  { id: "orange_money", label: "Orange Money", icon: "🟠" },
  { id: "moov_money", label: "Moov Money", icon: "🔵" },
  { id: "wave", label: "Wave", icon: "🌊" },
  { id: "card", label: "Carte bancaire", icon: "💳" },
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
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [activatingLicense, setActivatingLicense] = useState(false);
  const [initiatingOrder, setInitiatingOrder] = useState(false);

  const planInfo = PLAN_CONFIG[selectedPlan];
  const amount = planInfo.priceFcfa;

  // Activation immédiate via Clé de Licence Officielle
  const handleActivateKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!business?.id) {
      toast.error("Veuillez vous connecter pour activer une licence.");
      return;
    }
    const cleanKey = licenseKeyInput.trim().toUpperCase();
    if (cleanKey.length < 8) {
      toast.error("Veuillez saisir une clé de licence valide (ex: CP-M-XXXX-XXXX-XXXX).");
      return;
    }

    setActivatingLicense(true);
    try {
      const { data, error } = await (supabase.rpc as any)("activate_license_key", {
        p_license_key: cleanKey,
        p_business_id: business.id,
      });

      if (error) throw error;
      const res = data as { success: boolean; message: string; plan?: string; plan_expires_at?: string };

      if (res.success) {
        // Mise à jour immédiate du cache local pour disponibilité offline-first
        if (typeof window !== "undefined") {
          try {
            const cachedStr = localStorage.getItem("couturpro_cached_business");
            if (cachedStr) {
              const cached = JSON.parse(cachedStr);
              cached.plan = res.plan || selectedPlan;
              cached.plan_status = "active";
              if (res.plan_expires_at) cached.plan_expires_at = res.plan_expires_at;
              localStorage.setItem("couturpro_cached_business", JSON.stringify(cached));
            }
          } catch {}
        }

        queryClient.invalidateQueries({ queryKey: ["business"] });
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        queryClient.invalidateQueries({ queryKey: ["clients"] });

        toast.success(res.message || "🎉 Votre Pass Atelier a été activé avec succès !");
        setLicenseKeyInput("");
        onOpenChange(false);
      } else {
        toast.error(res.message || "Impossible d'activer cette licence.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erreur de validation de la clé de licence.");
    } finally {
      setActivatingLicense(false);
    }
  };

  // Souscription et paiement direct par WhatsApp
  const handleWhatsAppCheckout = async () => {
    if (!business) return;
    setInitiatingOrder(true);

    try {
      const txId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Enregistrement de l'ordre de transaction pour suivi comptable
      await (supabase.from("payment_transactions") as any).insert({
        business_id: business.id,
        plan: selectedPlan,
        amount: amount,
        currency: "FCFA",
        provider: provider,
        provider_tx_id: txId,
        customer_phone: (phone || business.phone || "").trim() || null,
        status: "pending",
        metadata: {
          phone: (phone || business.phone || "").trim(),
          plan_name: planInfo.name,
          duration_days: planInfo.durationDays,
          initiated_at: new Date().toISOString(),
        },
      });
      queryClient.invalidateQueries({ queryKey: ["payment_transactions"] });
    } catch {
      // Silencieux : n'interrompt jamais l'ouverture WhatsApp
    } finally {
      setInitiatingOrder(false);
    }

    const providerLabel = PAYMENT_PROVIDERS.find((p) => p.id === provider)?.label || "Mobile Money";
    const atelierInfo = business.name ? `\n• Mon atelier : *${business.name}*` : "";
    const phoneInfo = phone ? `\n• Téléphone débit : ${phone}` : business.phone ? `\n• Téléphone : ${business.phone}` : "";
    const msg = `Bonjour CouturPro,\nJe souhaite activer la formule *${planInfo.name}* (${fcfa(amount)} pour ${planInfo.durationDays} jours).${atelierInfo}${phoneInfo}\n• Paiement par : *${providerLabel}*\n\nMerci de m'indiquer la démarche et de me transmettre ma clé de licence officielle. ✂️`;

    const url = `https://wa.me/${WHATSAPP_BILLING_PHONE}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");

    toast.success("Discussion WhatsApp ouverte !", {
      description: "Effectuez votre règlement pour recevoir instantanément votre clé de licence officielle.",
    });
  };

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
              className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                selectedPlan === "monthly"
                  ? "border-primary bg-primary/5 ring-2 ring-primary shadow-xs"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              <div>
                <span className="font-display text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Mensuel (Liberté)
                </span>
                <p className="mt-1 font-display text-lg font-extrabold text-foreground">
                  3 000 <span className="text-xs font-medium">FCFA</span>
                </p>
                <p className="text-[11px] text-muted-foreground">pour 30 jours</p>
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
              className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
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
                  Trimestriel (Saison)
                </span>
                <p className="mt-1 font-display text-lg font-extrabold text-foreground">
                  7 500 <span className="text-xs font-medium">FCFA</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  soit 2 500 F/mois (90 jours)
                </p>
              </div>
              <div className="mt-2.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                  <Sparkles className="size-3" /> Photos 100% ILLIMITÉES
                </span>
              </div>
            </button>

            {/* 3. Annuel (Maître Couturier) */}
            <button
              type="button"
              onClick={() => setSelectedPlan("yearly")}
              className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                selectedPlan === "yearly"
                  ? "border-emerald-600 bg-emerald-500/10 ring-2 ring-emerald-600 shadow-xs"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              <span className="absolute -top-2.5 right-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-extrabold text-white shadow-2xs">
                PACK SÉRÉNITÉ VIP
              </span>
              <div>
                <span className="font-display text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Annuel (1 An VIP)
                </span>
                <p className="mt-1 font-display text-lg font-extrabold text-foreground">
                  35 000 <span className="text-xs font-medium">FCFA</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  soit ~2 916 F/mois (365 jours)
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
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" /> Rendez-vous d'essayage illimités
              </span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" />
                {selectedPlan === "monthly"
                  ? "Catalogue : jusqu'à 200 photos"
                  : "Catalogue : photos 100% ILLIMITÉES"}
              </span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Check className="size-3.5 text-emerald-600 shrink-0 font-bold" /> Statistiques & Bénéfice Net débloqués
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600 shrink-0" /> Reçus imprimables & WhatsApp avec logo
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600 shrink-0" /> Sauvegarde Cloud continue garantie
              </span>
            </div>
          </div>

          {/* SECTION A : Activation Immédiate via Clé de Licence */}
          <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary shrink-0" />
              <Label htmlFor="lic-key-input" className="text-xs font-bold text-foreground">
                Vous disposez d'une Clé de Licence officielle ?
              </Label>
            </div>
            <form onSubmit={handleActivateKey} className="flex flex-col sm:flex-row gap-2">
              <Input
                id="lic-key-input"
                placeholder="Ex : CP-M-ABCD-1234-EF56"
                value={licenseKeyInput}
                onChange={(e) => setLicenseKeyInput(e.target.value.toUpperCase())}
                className="h-10 text-xs sm:text-sm font-mono uppercase bg-background"
              />
              <Button
                type="submit"
                disabled={activatingLicense || !licenseKeyInput.trim()}
                className="h-10 font-bold text-xs shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {activatingLicense ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Activation…
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 size-3.5" /> Activer ma Licence
                  </>
                )}
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground">
              Entrez ici la clé délivrée par l'administrateur ou reçue après votre règlement.
            </p>
          </div>

          {/* SECTION B : Souscription & Paiement WhatsApp */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Ou Souscrire par Mobile Money / Carte :
              </Label>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                Orange • Moov • Wave
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PAYMENT_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-semibold transition-all cursor-pointer ${
                    provider === p.id
                      ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary font-bold"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="text-sm">{p.icon}</span>
                  <span className="truncate">{p.label}</span>
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <Label htmlFor="pay-phone" className="text-[11px] flex items-center gap-1 text-muted-foreground">
                <Phone className="size-3" /> Numéro de téléphone pour la souscription :
              </Label>
              <Input
                id="pay-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex: +226 70 00 00 00 ou 76..."
                className="h-9 text-xs font-medium"
              />
            </div>

            <Button
              type="button"
              onClick={handleWhatsAppCheckout}
              disabled={initiatingOrder}
              className="w-full h-11 text-xs sm:text-sm font-bold shadow-md bg-emerald-600 hover:bg-emerald-700 text-white gap-2 cursor-pointer active:scale-98 transition-all"
            >
              {initiatingOrder ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Préparation…
                </>
              ) : (
                <>
                  <MessageCircle className="size-4" /> Souscrire {planInfo.name} ({fcfa(amount)}) sur WhatsApp
                </>
              )}
            </Button>

            <p className="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
              <ShieldCheck className="size-3 text-emerald-600 shrink-0" />
              Paiement direct sécurisé. Votre clé officielle vous est remise instantanément sur WhatsApp.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
