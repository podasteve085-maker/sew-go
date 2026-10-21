/**
 * CouturPro — Moteur Universel de Notifications et Rappels (Jour J & La Veille)
 * 100% Offline-First : fonctionne sans internet pendant des semaines grâce à IndexedDB et localStorage.
 */

import { dateLongFr, dateFr, fullName, cleanPhone, waLink } from "./format";
import type { AppointmentRow, OrderRow } from "./queries";
import { appointmentLabel, isActive } from "./domain";

/* ── Gestion des notifications masquées / supprimées par l'artisan ── */

const DISMISSED_STORAGE_KEY = "sewgo_dismissed_notifs";

export function getDismissedNotifIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function dismissNotificationId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = getDismissedNotifIds();
    current.add(id);
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // ignore
  }
}

export function dismissAllNotificationIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const current = getDismissedNotifIds();
    for (const id of ids) current.add(id);
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // ignore
  }
}

export function clearDismissedNotifs(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DISMISSED_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* ── Types ──────────────────────────────────────────────────────── */

export type NotificationTiming = "today" | "tomorrow" | "overdue";
export type NotificationCategory = "appointment" | "order_delivery";

export interface AppNotification {
  id: string; // ID unique du rappel (ex: rdv-today-uuid-2026-10-25)
  category: NotificationCategory;
  timing: NotificationTiming;
  title: string;
  body: string;
  targetDate: string; // YYYY-MM-DD
  targetTime?: string | null;
  clientName: string;
  clientPhone?: string | null;
  clientWhatsapp?: string | null;
  whatsappMessage: string;
  linkUrl: string;
  referenceId: string;
}

export interface WhatsAppReminderParams {
  id?: string;
  type: "appointment" | "delivery";
  urgency: "today" | "tomorrow" | "overdue";
  clientName: string;
  clientPhone?: string | null;
  title?: string;
  time?: string | null;
  date?: string;
  atelierName?: string;
}

export function generateWhatsAppReminderUrl(params: WhatsAppReminderParams): string {
  const phone = cleanPhone(params.clientPhone || "");
  const atelier = params.atelierName || "votre atelier";
  const name = params.clientName || "Client";
  const timeStr = params.time ? ` à ${params.time}` : "";

  let msg = "";
  if (params.type === "appointment") {
    const act = params.title || "rendez-vous";
    if (params.urgency === "today") {
      msg = `Bonjour ${name} ! 👋 Petit rappel de votre rendez-vous de ${act} prévu AUJOURD'HUI${timeStr} chez ${atelier}. Au plaisir de vous accueillir ! ✂️`;
    } else {
      msg = `Bonjour ${name} ! 👋 Nous vous rappelons votre rendez-vous de ${act} prévu DEMAIN${timeStr} chez ${atelier}. Merci de nous confirmer votre disponibilité ! ✂️`;
    }
  } else {
    const title = params.title || "votre commande";
    if (params.urgency === "today") {
      msg = `Bonjour ${name} ! 👋 Votre commande (${title}) est programmée pour livraison AUJOURD'HUI chez ${atelier}. Nous vous attendons avec plaisir ! ✂️`;
    } else if (params.urgency === "tomorrow") {
      msg = `Bonjour ${name} ! 👋 Votre commande (${title}) sera disponible pour livraison DEMAIN chez ${atelier}. À très bientôt ! ✂️`;
    } else {
      msg = `Bonjour ${name} ! Concernant votre commande (${title}) chez ${atelier}, nous finalisons les derniers détails. Nous vous tenons informé très vite. ✂️`;
    }
  }

  return phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

/* ── Utilitaires de dates locales fiables ────────────────────────── */

export function getTodayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/* ── Calculateur de notifications (Jour J, Veille, Retards) ───────── */

export function generateReminders(
  appointments: AppointmentRow[] = [],
  orders: OrderRow[] = [],
  atelierName: string = "Notre atelier",
): AppNotification[] {
  const todayStr = getTodayStr();
  const tomorrowStr = getTomorrowStr();
  const dismissed = getDismissedNotifIds();
  const notifications: AppNotification[] = [];

  /* ── 1. Rendez-vous (Essayages, Mesures, Livraisons en atelier) ── */
  for (const a of appointments) {
    // On ne notifie que les rendez-vous prévus (pas les annulés ni les honorés)
    if (a.status !== "prevu" || !a.scheduled_date) continue;

    const cName = a.clients ? fullName(a.clients) : "Client";
    const cPhone = a.clients?.phone || null;
    const cWa = a.clients?.whatsapp || cPhone;
    const typeLabel = appointmentLabel(a.type);
    const heureStr = a.scheduled_time ? ` à ${a.scheduled_time.slice(0, 5)}` : "";

    // A. Rendez-vous AUJOURD'HUI (Jour J)
    if (a.scheduled_date === todayStr) {
      const notifId = `rdv-today-${a.id}-${todayStr}`;
      if (!dismissed.has(notifId)) {
        notifications.push({
          id: notifId,
          category: "appointment",
          timing: "today",
          title: `📅 Rendez-vous AUJOURD'HUI${heureStr}`,
          body: `${typeLabel} avec ${cName} prévu aujourd'hui${heureStr}.`,
          targetDate: a.scheduled_date,
          targetTime: a.scheduled_time,
          clientName: cName,
          clientPhone: cPhone,
          clientWhatsapp: cWa,
          whatsappMessage: `Bonjour ${cName} ! 👋 Petit rappel de votre rendez-vous (${typeLabel.toLowerCase()}) prévu AUJOURD'HUI${heureStr} à l'atelier ${atelierName}. Au plaisir de vous accueillir !`,
          linkUrl: `/rendez-vous`,
          referenceId: a.id,
        });
      }
    }

    // B. Rendez-vous DEMAIN (La veille / J-1)
    else if (a.scheduled_date === tomorrowStr) {
      const notifId = `rdv-tomorrow-${a.id}-${todayStr}`;
      if (!dismissed.has(notifId)) {
        notifications.push({
          id: notifId,
          category: "appointment",
          timing: "tomorrow",
          title: `📅 Rendez-vous DEMAIN (Veille)${heureStr}`,
          body: `${typeLabel} avec ${cName} prévu demain${heureStr} (${dateLongFr(a.scheduled_date)}).`,
          targetDate: a.scheduled_date,
          targetTime: a.scheduled_time,
          clientName: cName,
          clientPhone: cPhone,
          clientWhatsapp: cWa,
          whatsappMessage: `Bonjour ${cName} ! 👋 Nous vous rappelons votre rendez-vous (${typeLabel.toLowerCase()}) prévu DEMAIN${heureStr} à l'atelier ${atelierName}. Merci de nous confirmer votre disponibilité !`,
          linkUrl: `/rendez-vous`,
          referenceId: a.id,
        });
      }
    }
  }

  /* ── 2. Commandes & Dates de livraison prévues ─────────────────── */
  for (const o of orders) {
    // RÈGLE STRICTE : Ignorer formellement les commandes livrées ou annulées (fixe le statut 'livree')
    if (!isActive(o.status) || !o.due_date) continue;

    const cName = o.clients ? fullName(o.clients) : "Client";
    const cPhone = o.clients?.phone || null;
    const cWa = o.clients?.whatsapp || cPhone;
    const refOrder = o.code || o.order_number ? `#${o.code || o.order_number}` : "";
    const garmentDesc = o.description || "Confection sur mesure";

    // A. Livraison AUJOURD'HUI (Jour J)
    if (o.due_date === todayStr) {
      const notifId = `order-today-${o.id}-${todayStr}`;
      if (!dismissed.has(notifId)) {
        notifications.push({
          id: notifId,
          category: "order_delivery",
          timing: "today",
          title: `👗 Livraison prévue AUJOURD'HUI ${refOrder}`,
          body: `Livraison de "${garmentDesc}" pour ${cName} prévue aujourd'hui.`,
          targetDate: o.due_date,
          clientName: cName,
          clientPhone: cPhone,
          clientWhatsapp: cWa,
          whatsappMessage: `Bonjour ${cName} ! 👋 Votre commande ${refOrder} (${garmentDesc}) est programmée pour livraison / retrait AUJOURD'HUI à l'atelier ${atelierName}. Nous vous attendons avec plaisir !`,
          linkUrl: `/commandes/${o.id}`,
          referenceId: o.id,
        });
      }
    }

    // B. Livraison DEMAIN (La veille / J-1)
    else if (o.due_date === tomorrowStr) {
      const notifId = `order-tomorrow-${o.id}-${todayStr}`;
      if (!dismissed.has(notifId)) {
        notifications.push({
          id: notifId,
          category: "order_delivery",
          timing: "tomorrow",
          title: `👗 Livraison DEMAIN (Veille) ${refOrder}`,
          body: `Livraison de "${garmentDesc}" pour ${cName} prévue demain (${dateLongFr(o.due_date)}).`,
          targetDate: o.due_date,
          clientName: cName,
          clientPhone: cPhone,
          clientWhatsapp: cWa,
          whatsappMessage: `Bonjour ${cName} ! 👋 Votre commande ${refOrder} (${garmentDesc}) sera prête pour livraison / essayage DEMAIN à l'atelier ${atelierName}. À très bientôt !`,
          linkUrl: `/commandes/${o.id}`,
          referenceId: o.id,
        });
      }
    }

    // C. Livraison EN RETARD (Date dépassée pour une commande encore active)
    else if (o.due_date < todayStr) {
      const notifId = `order-overdue-${o.id}-${todayStr}`;
      if (!dismissed.has(notifId)) {
        notifications.push({
          id: notifId,
          category: "order_delivery",
          timing: "overdue",
          title: `⚠️ Livraison en retard ${refOrder}`,
          body: `Date de livraison dépassée depuis le ${dateFr(o.due_date)} pour ${cName} (${garmentDesc}).`,
          targetDate: o.due_date,
          clientName: cName,
          clientPhone: cPhone,
          clientWhatsapp: cWa,
          whatsappMessage: `Bonjour ${cName} ! Concernant votre commande ${refOrder} chez ${atelierName}, nous finalisons les derniers détails de votre tenue. Nous vous tenons informé très rapidement.`,
          linkUrl: `/commandes/${o.id}`,
          referenceId: o.id,
        });
      }
    }
  }

  // Tri logique : Aujourd'hui en premier, puis Demain, puis Retards
  return notifications.sort((a, b) => {
    const priority = { today: 1, tomorrow: 2, overdue: 3 };
    return priority[a.timing] - priority[b.timing];
  });
}

/* ── Gestion des permissions de notification système ───────────── */

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  try {
    const perm = await Notification.requestPermission();
    return perm === "granted";
  } catch {
    return false;
  }
}

/* ── Déclenchement de la notification native téléphone / PWA ────── */

const SENT_STORAGE_KEY = "sewgo_sent_system_notifs";

function getSentNotifs(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function markNotifAsSent(notifId: string): void {
  if (typeof window === "undefined") return;
  try {
    const sent = getSentNotifs();
    sent[notifId] = Date.now();
    // Nettoyer les clés de plus de 7 jours
    const now = Date.now();
    for (const k of Object.keys(sent)) {
      if (now - sent[k] > 7 * 24 * 3600 * 1000) {
        delete sent[k];
      }
    }
    localStorage.setItem(SENT_STORAGE_KEY, JSON.stringify(sent));
  } catch {
    // ignore
  }
}

/**
 * Envoie une notification système (bannière téléphone) pour un rappel
 * Protégée contre les doublons : chaque alerte n'est sonnée qu'une seule fois par jour.
 */
export async function sendNativeNotification(notif: AppNotification): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return false;
  }

  const sent = getSentNotifs();
  if (sent[notif.id]) {
    // Déjà envoyée aujourd'hui
    return false;
  }

  try {
    // 1. Tenter via Service Worker (idéal PWA sur Android et iOS 16.4+)
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && "showNotification" in reg) {
        await reg.showNotification(notif.title, {
          body: notif.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          data: { url: notif.linkUrl },
          tag: notif.id,
        });
        markNotifAsSent(notif.id);
        return true;
      }
    }

    // 2. Repli standard Web Notification API
    new Notification(notif.title, {
      body: notif.body,
      icon: "/icon-192.png",
      tag: notif.id,
    });
    markNotifAsSent(notif.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Déclenche les notifications système pour tous les rappels du Jour J et de la Veille
 * Fonctionne 100% hors-ligne.
 */
export async function dispatchScheduledReminders(reminders: AppNotification[]): Promise<number> {
  let count = 0;
  for (const r of reminders) {
    // On notifie en système le Jour J et la Veille (les plus critiques)
    if (r.timing === "today" || r.timing === "tomorrow") {
      const sent = await sendNativeNotification(r);
      if (sent) count++;
    }
  }
  return count;
}
