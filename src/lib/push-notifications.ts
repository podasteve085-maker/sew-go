import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = import.meta.env["VITE_WEB_PUSH_PUBLIC_KEY"] as string | undefined;

export function isBackgroundPushAvailable(): boolean {
  return Boolean(
    VAPID_PUBLIC_KEY &&
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window,
  );
}

export async function hasSavedBackgroundPush(businessId: string): Promise<boolean> {
  if (!businessId || !isBackgroundPushAvailable()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;

    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id")
      .eq("business_id", businessId)
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();

    return !error && Boolean(data);
  } catch {
    return false;
  }
}

function decodeApplicationServerKey(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

function encodeKey(value: ArrayBuffer | null): string {
  if (!value) throw new Error("Clé de notification manquante sur cet appareil.");
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function enableBackgroundPush(businessId: string): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !isBackgroundPushAvailable()) {
    throw new Error(
      "Les notifications hors application ne sont pas configurées pour ce navigateur.",
    );
  }
  if (!businessId) throw new Error("Atelier introuvable. Reconnectez-vous puis réessayez.");

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(VAPID_PUBLIC_KEY),
    });
  }

  const keys = subscription.toJSON().keys;
  const p256dh = keys?.["p256dh"];
  const auth = keys?.["auth"];
  if (!p256dh || !auth) {
    throw new Error("L’abonnement de notification est incomplet. Réessayez sur cet appareil.");
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      business_id: businessId,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
      expiration_time: subscription.expirationTime
        ? new Date(subscription.expirationTime).toISOString()
        : null,
    },
    { onConflict: "business_id,endpoint" },
  );

  if (error) {
    throw new Error("Impossible d’enregistrer cet appareil pour les rappels en arrière-plan.");
  }
}
