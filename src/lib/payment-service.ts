import { supabase } from "@/integrations/supabase/client";
import type { SubscriptionPlan } from "@/hooks/use-business";

export type PaymentProvider =
  | "orange_money"
  | "moov_money"
  | "wave"
  | "cinetpay"
  | "fedapay"
  | "paydunya"
  | "card"
  | "admin_manual";

export type WebhookPayload = {
  provider: PaymentProvider;
  businessId: string;
  plan: SubscriptionPlan;
  amount: number;
  currency?: string;
  transactionId: string;
  customerPhone?: string;
  status: "completed" | "failed" | "pending";
  secretToken?: string;
};

/**
 * Traite le webhook de notification d'un agrégateur de paiement (CinetPay, FedaPay, Orange Money, etc.)
 * Valide le statut, met à jour la table des transactions et passe automatiquement l'atelier en Pro.
 */
export async function processPaymentWebhook(payload: WebhookPayload): Promise<{
  success: boolean;
  message: string;
}> {
  const { provider, businessId, plan, amount, currency = "FCFA", transactionId, customerPhone, status } = payload;

  if (!businessId || !plan) {
    return { success: false, message: "Paramètres businessId ou plan manquants." };
  }

  // 1. Enregistrement / mise à jour de la transaction
  await supabase.from("payment_transactions").insert({
    business_id: businessId,
    plan,
    amount,
    currency,
    provider,
    provider_tx_id: transactionId,
    customer_phone: customerPhone || null,
    status,
    metadata: {
      webhook_received_at: new Date().toISOString(),
      provider,
    },
    completed_at: status === "completed" ? new Date().toISOString() : null,
  });

  // 2. Si le paiement est complété avec succès, activer l'abonnement
  if (status === "completed") {
    const expiresAt = new Date();
    if (plan === "pro_monthly") {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    } else if (plan === "pro_yearly") {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }

    const { error: busError } = await supabase
      .from("businesses")
      .update({
        plan,
        plan_status: "active",
        plan_expires_at: plan === "unlimited" ? null : expiresAt.toISOString(),
      })
      .eq("id", businessId);

    if (busError) {
      console.error("[Webhook Payment Error]", busError);
      return { success: false, message: "Erreur mise à jour abonnement atelier: " + busError.message };
    }

    return { success: true, message: `Abonnement ${plan} activé avec succès pour l'atelier ${businessId}.` };
  }

  return { success: true, message: `Paiement ${status} enregistré.` };
}

/**
 * Configuration des clés API des agrégateurs.
 * En production, ces clés sont lues depuis les variables d'environnement serveur.
 */
export const PAYMENT_CONFIG = {
  cinetpay: {
    apiKey: process.env["CINETPAY_API_KEY"] || "",
    siteId: process.env["CINETPAY_SITE_ID"] || "",
    secretKey: process.env["CINETPAY_SECRET_KEY"] || "",
    endpoint: "https://api-checkout.cinetpay.com/v2/payment",
  },
  fedapay: {
    secretKey: process.env["FEDAPAY_SECRET_KEY"] || "",
    endpoint: "https://api.fedapay.com/v1/transactions",
  },
  paydunya: {
    masterKey: process.env["PAYDUNYA_MASTER_KEY"] || "",
    token: process.env["PAYDUNYA_TOKEN"] || "",
    endpoint: "https://app.paydunya.com/api/v1/checkout-invoice/create",
  },
} as const;
