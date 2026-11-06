import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type AppointmentReminder = {
  id: string;
  business_id: string;
  scheduled_date: string;
};

type OrderReminder = {
  id: string;
  business_id: string;
  due_date: string;
};

type PushSubscriptionRow = {
  id: string;
  business_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type ReminderTask = {
  resourceType: "appointment" | "order";
  resourceId: string;
  businessId: string;
  dueDate: string;
  timing: "today" | "tomorrow";
  subscription: PushSubscriptionRow;
};

const PAGE_SIZE = 500;
const MAX_CONCURRENT_SENDS = 8;
const PUSH_TTL_SECONDS = 24 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function dateInOuagadougou(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Ouagadougou",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addCalendarDay(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" ||
        host === "push.services.mozilla.com" ||
        host === "web.push.apple.com" ||
        host.endsWith(".push.apple.com"))
    );
  } catch {
    return false;
  }
}

function getTag(
  resourceType: ReminderTask["resourceType"],
  resourceId: string,
  dueDate: string,
  timing: ReminderTask["timing"],
): string {
  const category = resourceType === "appointment" ? "appointment" : "order_delivery";
  return `sewgo-${category}-${resourceId}-${dueDate}-${timing}`;
}

async function fetchDueAppointments(
  supabase: ReturnType<typeof createClient>,
  dates: string[],
): Promise<AppointmentReminder[]> {
  const rows: AppointmentReminder[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("appointments")
      .select("id,business_id,scheduled_date")
      .eq("status", "prevu")
      .in("scheduled_date", dates)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as AppointmentReminder[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchDueOrders(
  supabase: ReturnType<typeof createClient>,
  dates: string[],
): Promise<OrderReminder[]> {
  const rows: OrderReminder[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("orders")
      .select("id,business_id,due_date")
      .not("due_date", "is", null)
      .in("due_date", dates)
      .not("status", "in", '("livree","annulee")')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as OrderReminder[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchSubscriptions(
  supabase: ReturnType<typeof createClient>,
  businessIds: string[],
): Promise<PushSubscriptionRow[]> {
  const rows: PushSubscriptionRow[] = [];
  const businessChunks: string[][] = [];
  for (let index = 0; index < businessIds.length; index += 100) {
    businessChunks.push(businessIds.slice(index, index + 100));
  }

  for (const businessChunk of businessChunks) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("id,business_id,endpoint,p256dh,auth")
        .in("business_id", businessChunk)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as PushSubscriptionRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function claimDelivery(
  supabase: ReturnType<typeof createClient>,
  task: ReminderTask,
): Promise<boolean> {
  const eventKey = [
    task.resourceType,
    task.resourceId,
    task.dueDate,
    task.timing,
    task.subscription.id,
  ].join(":");
  const { data, error } = await supabase.rpc("claim_push_notification", {
    p_event_key: eventKey,
    p_business_id: task.businessId,
    p_subscription_id: task.subscription.id,
    p_resource_type: task.resourceType,
    p_resource_id: task.resourceId,
    p_due_date: task.dueDate,
    p_timing: task.timing,
  });
  if (error) throw error;
  return data === true;
}

async function sendReminder(
  supabase: ReturnType<typeof createClient>,
  task: ReminderTask,
): Promise<"sent" | "failed" | "skipped"> {
  const eventKey = [
    task.resourceType,
    task.resourceId,
    task.dueDate,
    task.timing,
    task.subscription.id,
  ].join(":");

  if (!isAllowedPushEndpoint(task.subscription.endpoint)) {
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("id", task.subscription.id);
    if (error) console.error("[push-reminders] Unable to remove an unsupported endpoint.");
    return "failed";
  }

  if (!(await claimDelivery(supabase, task))) return "skipped";

  const isAppointment = task.resourceType === "appointment";
  const isToday = task.timing === "today";
  const title = isAppointment
    ? isToday
      ? "Rendez-vous aujourd’hui"
      : "Rendez-vous demain"
    : isToday
      ? "Livraison prévue aujourd’hui"
      : "Livraison prévue demain";
  const body = isAppointment
    ? "Un rendez-vous est prévu pour votre atelier."
    : "Une commande arrive à sa date de livraison.";
  const tag = getTag(task.resourceType, task.resourceId, task.dueDate, task.timing);
  const targetUrl = isAppointment ? "/rendez-vous" : "/commandes";

  try {
    await webpush.sendNotification(
      {
        endpoint: task.subscription.endpoint,
        keys: {
          p256dh: task.subscription.p256dh,
          auth: task.subscription.auth,
        },
      },
      JSON.stringify({ title, body, tag, url: targetUrl }),
      { TTL: PUSH_TTL_SECONDS },
    );

    const { error } = await supabase
      .from("push_notification_deliveries")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("event_key", eventKey);
    if (error) throw error;
    return "sent";
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;

    if (statusCode === 404 || statusCode === 410) {
      // The browser revoked or expired this endpoint; remove only this subscription.
      const { error: deleteError } = await supabase
        .from("push_subscriptions")
        .delete()
        .eq("id", task.subscription.id);
      if (deleteError) console.error("[push-reminders] Unable to remove expired subscription.");
      return "failed";
    }

    const message = error instanceof Error ? error.message : "Push delivery failed";
    const { error: updateError } = await supabase
      .from("push_notification_deliveries")
      .update({
        status: "failed",
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("event_key", eventKey);
    if (updateError) console.error("[push-reminders] Unable to record delivery failure.");
    return "failed";
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
  }

  const cronSecret = Deno.env.get("PUSH_CRON_SECRET");
  const suppliedSecret = request.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || !safeEqual(cronSecret, suppliedSecret)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("[push-reminders] Required server configuration is missing.");
    return Response.json({ error: "Configuration des notifications incomplète." }, { status: 503 });
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const today = dateInOuagadougou();
    const tomorrow = addCalendarDay(today);
    const dates = [today, tomorrow];

    const [appointments, orders] = await Promise.all([
      fetchDueAppointments(supabase, dates),
      fetchDueOrders(supabase, dates),
    ]);
    const reminders: Array<Omit<ReminderTask, "subscription">> = [
      ...appointments.map((appointment) => ({
        resourceType: "appointment" as const,
        resourceId: appointment.id,
        businessId: appointment.business_id,
        dueDate: appointment.scheduled_date,
        timing: appointment.scheduled_date === today ? ("today" as const) : ("tomorrow" as const),
      })),
      ...orders.map((order) => ({
        resourceType: "order" as const,
        resourceId: order.id,
        businessId: order.business_id,
        dueDate: order.due_date,
        timing: order.due_date === today ? ("today" as const) : ("tomorrow" as const),
      })),
    ];

    if (reminders.length === 0) {
      return Response.json({ sent: 0, failed: 0, skipped: 0 });
    }

    const subscriptions = await fetchSubscriptions(supabase, [
      ...new Set(reminders.map((reminder) => reminder.businessId)),
    ]);
    const subscriptionsByBusiness = new Map<string, PushSubscriptionRow[]>();
    for (const subscription of subscriptions) {
      const current = subscriptionsByBusiness.get(subscription.business_id) ?? [];
      current.push(subscription);
      subscriptionsByBusiness.set(subscription.business_id, current);
    }

    const tasks: ReminderTask[] = reminders.flatMap((reminder) =>
      (subscriptionsByBusiness.get(reminder.businessId) ?? []).map((subscription) => ({
        ...reminder,
        subscription,
      })),
    );

    let nextTask = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_SENDS, tasks.length) },
      async () => {
        while (nextTask < tasks.length) {
          const task = tasks[nextTask++];
          if (!task) continue;
          const result = await sendReminder(supabase, task);
          if (result === "sent") sent += 1;
          else if (result === "failed") failed += 1;
          else skipped += 1;
        }
      },
    );
    await Promise.all(workers);

    return Response.json({ sent, failed, skipped });
  } catch (error) {
    console.error(
      "[push-reminders] Reminder processing failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ error: "Impossible de traiter les rappels." }, { status: 500 });
  }
});
