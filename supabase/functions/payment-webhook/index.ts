// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This code runs on Supabase Edge Functions (Deno runtime)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Tarifs officiels validés côté serveur (impossible à falsifier depuis le frontend)
const PLAN_PRICES: Record<string, { amount: number; months: number }> = {
  monthly: { amount: 2000, months: 1 },
  quarterly: { amount: 5000, months: 3 },
  yearly: { amount: 15000, months: 12 },
};

/**
 * Comparaison à temps constant pour éviter les attaques par canal auxiliaire (timing attacks)
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Calcul de la signature HMAC SHA-256
 */
async function computeHmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req: Request) => {
  // CORS pré-vol
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-signature, x-timestamp",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("PAYMENT_WEBHOOK_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Configuration Supabase manquante dans l'Edge Function");
    return new Response(JSON.stringify({ error: "Erreur serveur interne" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("x-signature") || req.headers.get("x-webhook-signature");
    const timestampHeader = req.headers.get("x-timestamp") || req.headers.get("x-webhook-timestamp");

    // 1. Protection contre les attaques par rejeu (Replay Attacks)
    if (timestampHeader) {
      const requestTime = parseInt(timestampHeader, 10);
      const currentTime = Math.floor(Date.now() / 1000);
      // Rejeter toute requête plus vieille que 5 minutes (300 secondes)
      if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > 300) {
        return new Response(JSON.stringify({ error: "Horodatage expiré ou invalide" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 2. Vérification cryptographique de la signature HMAC
    if (webhookSecret) {
      if (!signatureHeader) {
        return new Response(JSON.stringify({ error: "Signature manquante" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      const messageToSign = timestampHeader ? `${timestampHeader}.${rawBody}` : rawBody;
      const expectedSignature = await computeHmacSha256(webhookSecret, messageToSign);

      if (!timingSafeEqual(signatureHeader, expectedSignature)) {
        return new Response(JSON.stringify({ error: "Signature HMAC invalide" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else {
      console.warn("ATTENTION: PAYMENT_WEBHOOK_SECRET n'est pas encore défini en production!");
    }

    // 3. Décodage du payload de paiement
    const payload = JSON.parse(rawBody);
    const {
      business_id,
      plan,
      provider,
      provider_tx_id,
      amount,
      status: providerStatus,
    } = payload;

    if (!business_id || !plan || !provider_tx_id) {
      return new Response(JSON.stringify({ error: "Paramètres obligatoires manquants" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. Idempotence : vérifier si cette transaction a déjà été traitée avec succès
    const { data: existingTx } = await supabase
      .from("payment_transactions")
      .select("id, status")
      .eq("provider_tx_id", provider_tx_id)
      .maybeSingle();

    if (existingTx && existingTx.status === "completed") {
      return new Response(JSON.stringify({ message: "Transaction déjà traitée", ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 5. Validation du statut du prestataire
    const isSuccess =
      providerStatus === "SUCCESS" ||
      providerStatus === "COMPLETED" ||
      providerStatus === "successful" ||
      providerStatus === "approved";

    if (!isSuccess) {
      await supabase.from("payment_transactions").upsert({
        provider_tx_id,
        business_id,
        plan,
        provider: provider || "mobile_money",
        amount: Number(amount) || 0,
        status: "failed",
        metadata: payload,
      });

      return new Response(JSON.stringify({ message: "Paiement non concluant enregistré" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 6. Recalcul et validation stricte du montant côté serveur (Protection anti-fraude)
    const expected = PLAN_PRICES[plan];
    if (!expected) {
      return new Response(JSON.stringify({ error: "Formule d'abonnement inconnue" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const paidAmount = Number(amount);
    if (paidAmount < expected.amount) {
      // Tentative de sous-paiement détectée
      await supabase.from("audit_security_logs").insert({
        business_id,
        action: "SUSPICIOUS_PAYMENT_AMOUNT",
        details: {
          plan,
          expected_amount: expected.amount,
          received_amount: paidAmount,
          provider_tx_id,
        },
      });

      return new Response(JSON.stringify({ error: "Montant insuffisant pour ce forfait" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 7. Calcul de la nouvelle date d'expiration
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + expected.months);

    // 8. Mise à jour atomique de l'atelier et enregistrement de la transaction
    const { error: txError } = await supabase.from("payment_transactions").upsert({
      provider_tx_id,
      business_id,
      plan,
      provider: provider || "mobile_money",
      amount: paidAmount,
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: payload,
    });

    if (txError) {
      console.error("Erreur enregistrement transaction:", txError);
      return new Response(JSON.stringify({ error: "Erreur enregistrement transaction" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { error: busError } = await supabase
      .from("businesses")
      .update({
        plan: plan,
        plan_status: "active",
        plan_expires_at: expiresAt.toISOString(),
      })
      .eq("id", business_id);

    if (busError) {
      console.error("Erreur mise à jour atelier:", busError);
      return new Response(JSON.stringify({ error: "Erreur mise à jour de l'abonnement" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 9. Journalisation d'audit
    await supabase.from("audit_security_logs").insert({
      business_id,
      action: "SUBSCRIPTION_ACTIVATED_WEBHOOK",
      details: {
        plan,
        provider_tx_id,
        amount: paidAmount,
        expires_at: expiresAt.toISOString(),
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Abonnement activé avec succès",
        expires_at: expiresAt.toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Erreur inattendue dans le webhook:", error);
    return new Response(JSON.stringify({ error: "Erreur interne" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
