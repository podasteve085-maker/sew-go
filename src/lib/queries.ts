import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { OrderStatus } from "@/lib/domain";
import { deleteStorageFiles, materializeStoragePaths, uuid, getSignedUrl, uploadDataUrl } from "@/hooks/use-signed-url";

import { cacheImage } from "@/lib/image-cache";
import {
  setLocalItem,
  setLocalItems,
  getLocalItem,
  getAllLocalItems,
  deleteLocalItem,
  addToSyncQueue,
  getPendingSyncQueue,
} from "./offline-storage";


export async function currentBusinessId(): Promise<string> {
  // 1. Accès instantané au cache local (0ms de latence, fonctionne toujours en ligne et hors-ligne)
  if (typeof window !== "undefined") {
    const cachedBizId = localStorage.getItem("couturpro_current_business_id");
    if (cachedBizId) return cachedBizId;
  }

  // 2. Vérification dans IndexedDB workshop_data
  try {
    const workshops = await getAllLocalItems<{ id: string }>("workshop_data");
    const firstW = workshops[0];
    if (firstW && firstW.id) {
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("couturpro_current_business_id", firstW.id);
        } catch {
          // ignore
        }
      }
      return firstW.id;
    }
  } catch {
    // ignore
  }

  // 3. Si en ligne, tenter la session active Supabase
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (userId) {
        const { data: business, error: businessError } = await supabase
          .from("businesses")
          .select("id")
          .eq("owner_id", userId)
          .maybeSingle();
        if (!businessError && business?.id) {
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem("couturpro_current_business_id", business.id);
              localStorage.setItem("couturpro_current_user_id", userId);
            } catch {
              // ignore
            }
          }
          return business.id as string;
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Déduction locale depuis les commandes ou clients déjà présents
  try {
    const orders = await getAllLocalItems<OrderRow>("orders");
    const firstO = orders[0];
    if (firstO && firstO.business_id) {
      return firstO.business_id;
    }
    const clients = await getAllLocalItems<ClientRow>("clients");
    const firstC = clients[0];
    if (firstC && firstC.business_id) {
      return firstC.business_id;
    }
  } catch {
    // ignore
  }

  return "";
}

export type ClientRow = {
  id: string;
  business_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  whatsapp: string | null;
  gender: string | null;
  birth_date: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  business_id?: string;
  order_id: string;
  amount: number;
  method: string;
  paid_at: string;
  note: string | null;
  created_at?: string;
};

export type OrderRow = {
  id: string;
  business_id: string;
  client_id: string;
  reference: string;
  garment_type: string;
  fabric: string | null;
  quantity: number;
  description: string | null;
  price: number;
  ordered_at: string;
  due_date: string | null;
  status: OrderStatus;
  notes: string | null;
  delivered_at: string | null;
  delivered_to: string | null;
  delivery_note: string | null;
  created_at: string;
  clients?: Pick<ClientRow, "first_name" | "last_name" | "phone" | "whatsapp"> | null | undefined;
  payments?: { id?: string; amount: number }[] | undefined;
};

export type AppointmentRow = {
  id: string;
  client_id: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  type: string;
  status: string;
  notes: string | null;
  clients?: Pick<ClientRow, "first_name" | "last_name" | "phone" | "whatsapp"> | null;
};

export type OrderImageRow = {
  id: string;
  business_id: string;
  order_id: string;
  path: string;
  kind: string;
  caption: string | null;
  created_at: string;
};

export type MeasurementSetRow = {
  id: string;
  /** Identifiant atelier — requis en offline pour filtrage strict */
  business_id?: string;
  client_id: string;
  label: string | null;
  template_name: string | null;
  notes: string | null;
  recorded_at: string;
  created_at?: string;
  measurement_values?: {
    id: string;
    name: string;
    value: number | null;
    unit: string;
    position: number;
  }[];
};

const ORDER_SELECT =
  "*, clients(first_name, last_name, phone, whatsapp), payments(id, amount)";

export function paidTotal(order: OrderRow) {
  return (order.payments ?? []).reduce((sum, p) => {
    const val = Number(p.amount);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
}

export function balance(order: OrderRow) {
  const price = Number(order.price);
  return (isNaN(price) ? 0 : price) - paidTotal(order);
}

async function enrichOrdersWithPayments(ordersList: OrderRow[]): Promise<OrderRow[]> {
  try {
    const allLocalPayments = await getAllLocalItems<PaymentRow>("payments");
    let queuePayments: PaymentRow[] = [];
    try {
      const queue = await getPendingSyncQueue();
      queuePayments = queue
        .filter((q) => q.entity === "payment" && q.action === "create" && q.payload)
        .map((q) => q.payload as unknown as PaymentRow);
    } catch {
      // ignore
    }

    const allExtra = [...allLocalPayments, ...queuePayments];
    if (allExtra.length === 0) return ordersList;

    return ordersList.map((ord) => {
      const extraForOrder = allExtra.filter((p) => p && p.order_id === ord.id);
      if (extraForOrder.length === 0) return ord;

      const existingIds = new Set(
        (ord.payments || [])
          .map((p) => p.id)
          .filter((id): id is string => Boolean(id))
      );
      const combined = [...(ord.payments || [])];

      for (const p of extraForOrder) {
        if (!p || !p.id) continue;
        if (!existingIds.has(p.id)) {
          existingIds.add(p.id);
          combined.push({ id: p.id, amount: Number(p.amount) || 0 });
        }
      }

      return { ...ord, payments: combined };
    });
  } catch {
    return ordersList;
  }
}

export async function fetchOrders(opts?: { clientId?: string }): Promise<OrderRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("orders").select(ORDER_SELECT);
      if (businessId) {
        query = query.eq("business_id", businessId);
      }
      if (opts?.clientId) query = query.eq("client_id", opts.clientId);
      const { data, error } = await query
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (!error && data) {
        const rows = data as unknown as OrderRow[];
        const localOrders = await getAllLocalItems<OrderRow>("orders");
        const pendingIds = new Set(
          (await getPendingSyncQueue())
            .filter((q) => q.entity === "order" && q.action !== "delete")
            .map((q) => q.payload["id"] as string)
            .filter(Boolean),
        );
        const localById = new Map(localOrders.map((order) => [order.id, order]));
        const combined = rows.map((row) => pendingIds.has(row.id) ? (localById.get(row.id) ?? row) : row);
        const serverIds = new Set(rows.map((r) => r.id));
        combined.push(
          ...localOrders.filter(
            (l) => !serverIds.has(l.id)
              && (!businessId || l.business_id === businessId || !l.business_id)
              && (!opts?.clientId || l.client_id === opts.clientId),
          ),
        );
        const enriched = await enrichOrdersWithPayments(combined);
        // Ne pas écraser tout le store quand on filtre par clientId
        if (!opts?.clientId) {
          setLocalItems("orders", enriched).catch(() => {});
        } else {
          enriched.forEach((order) => setLocalItem("orders", order).catch(() => {}));
        }
        return enriched;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const localOrders = await getAllLocalItems<OrderRow>("orders");
  let filtered = businessId
    ? localOrders.filter((o) => o.business_id === businessId || !o.business_id)
    : localOrders;
  if (opts?.clientId) {
    filtered = filtered.filter((o) => o.client_id === opts.clientId);
  }
  const enriched = await enrichOrdersWithPayments(filtered);
  return enriched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function fetchOrder(id: string): Promise<OrderRow | null> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("orders").select(ORDER_SELECT).eq("id", id);
      if (businessId) {
        query = query.eq("business_id", businessId);
      }
      const { data, error } = await query.maybeSingle();
      if (!error && data) {
        const order = data as unknown as OrderRow;
        const [enriched] = await enrichOrdersWithPayments([order]);
        setLocalItem("orders", enriched || order).catch(() => {});
        return enriched || order;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const local = await getLocalItem<OrderRow>("orders", id);
  if (!local) return null;
  const [enriched] = await enrichOrdersWithPayments([local]);
  return enriched || local;
}

export function deduplicateClients(clients: ClientRow[]): ClientRow[] {
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const unique: ClientRow[] = [];

  for (const client of clients) {
    if (!client || !client.id) continue;
    if (seenIds.has(client.id)) continue;
    seenIds.add(client.id);

    // Empreinte unique : prénom + nom + téléphone normalisé (8 derniers chiffres)
    const normFirst = (client.first_name || "").trim().toLowerCase();
    const normLast = (client.last_name || "").trim().toLowerCase();
    const rawDigits = (client.phone || client.whatsapp || "").replace(/\D/g, "");
    const phoneKey = rawDigits.length >= 8 ? rawDigits.slice(-8) : rawDigits;

    const fingerprint = `${normFirst}|${normLast}|${phoneKey}`;
    if (normFirst && (normLast || phoneKey) && seenFingerprints.has(fingerprint)) {
      // Doublon strict détecté : ignorer la copie superflue
      continue;
    }
    if (normFirst && (normLast || phoneKey)) {
      seenFingerprints.add(fingerprint);
    }
    unique.push(client);
  }

  return unique;
}

export async function fetchClients(term?: string): Promise<ClientRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("clients").select("*");
      if (businessId) {
        query = query.eq("business_id", businessId);
      }
      if (term && term.trim().length >= 1) {
        const like = `%${term.trim()}%`;
        query = query.or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`);
      }
      const { data, error } = await query.order("first_name", { ascending: true });
      if (!error && data) {
        const serverRows = deduplicateClients(data as unknown as ClientRow[]);
        const localClients = await getAllLocalItems<ClientRow>("clients");
        const serverIds = new Set(serverRows.map((r) => r.id));
        const pendingLocals = localClients.filter(
          (l) => !serverIds.has(l.id) && (!businessId || l.business_id === businessId || !l.business_id)
        );
        // Préserver la photo locale si le serveur renvoie null pour un client existant
        const mergedServerRows = serverRows.map((serverItem) => {
          const localItem = localClients.find((l) => l.id === serverItem.id);
          if (localItem && !serverItem.photo_url && localItem.photo_url) {
            return { ...serverItem, photo_url: localItem.photo_url };
          }
          return serverItem;
        });
        const combined = deduplicateClients([...mergedServerRows, ...pendingLocals]);
        setLocalItems("clients", combined).catch(() => {});


        // Pré-cache en arrière-plan les photos clients pour disponibilité hors-ligne
        Promise.allSettled(
          combined
            .filter((c) => c.photo_url && !c.photo_url.startsWith("data:"))
            .map(async (c) => {
              try {
                const signedUrl = await getSignedUrl(c.photo_url!);
                if (signedUrl && !signedUrl.startsWith("blob:")) {
                  cacheImage(c.photo_url!, signedUrl).catch(() => {});
                }
              } catch {
                // ignore
              }
            })
        ).catch(() => {});

        return combined;
      }

    } catch {
      // Fallback IndexedDB
    }
  }

  const localClients = await getAllLocalItems<ClientRow>("clients");
  let filtered = businessId
    ? localClients.filter((c) => c.business_id === businessId || !c.business_id)
    : localClients;
  if (term && term.trim()) {
    const q = term.trim().toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.first_name.toLowerCase().includes(q) ||
        c.last_name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.whatsapp && c.whatsapp.toLowerCase().includes(q)),
    );
  }
  return deduplicateClients(filtered).sort((a, b) => a.first_name.localeCompare(b.first_name));
}

export async function fetchClient(id: string): Promise<ClientRow | null> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("clients").select("*").eq("id", id);
      if (businessId) {
        query = query.eq("business_id", businessId);
      }
      const { data, error } = await query.maybeSingle();
      if (!error && data) {
        const row = data as unknown as ClientRow;
        setLocalItem("clients", row).catch(() => {});
        return row;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  return getLocalItem<ClientRow>("clients", id);
}

export type FullMeasurementSetRow = MeasurementSetRow & {
  clients?: {
    id: string;
    first_name: string;
    last_name: string | null;
    phone: string | null;
    whatsapp: string | null;
    gender: string | null;
  } | null;
};

async function enrichMeasurementSetsWithClients(
  sets: FullMeasurementSetRow[],
): Promise<FullMeasurementSetRow[]> {
  try {
    const localClients = await getAllLocalItems<ClientRow>("clients");
    const clientMap = new Map(localClients.map((c) => [c.id, c]));
    return sets.map((s) => {
      if ((!s.clients || !s.clients.first_name) && s.client_id && clientMap.has(s.client_id)) {
        const c = clientMap.get(s.client_id)!;
        return {
          ...s,
          clients: {
            id: c.id,
            first_name: c.first_name,
            last_name: c.last_name,
            phone: c.phone,
            whatsapp: c.whatsapp,
            gender: c.gender,
          },
        };
      }
      return s;
    });
  } catch {
    return sets;
  }
}

async function enrichAppointmentsWithClients(
  appts: AppointmentRow[],
): Promise<AppointmentRow[]> {
  try {
    const localClients = await getAllLocalItems<ClientRow>("clients");
    const clientMap = new Map(localClients.map((c) => [c.id, c]));
    return appts.map((a) => {
      if ((!a.clients || !a.clients.first_name) && a.client_id && clientMap.has(a.client_id)) {
        const c = clientMap.get(a.client_id)!;
        return {
          ...a,
          clients: {
            first_name: c.first_name,
            last_name: c.last_name,
            phone: c.phone,
            whatsapp: c.whatsapp,
          },
        };
      }
      return a;
    });
  } catch {
    return appts;
  }
}

export async function fetchAllMeasurementSets(): Promise<FullMeasurementSetRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from("measurement_sets")
        .select(
          "*, clients(id, first_name, last_name, phone, whatsapp, gender), measurement_values(id, name, value, unit, position)",
        )
        .eq("business_id", businessId)
        .order("recorded_at", { ascending: false });
      if (!error && data) {
        const rows = data as unknown as FullMeasurementSetRow[];
        const localSets = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
        const pendingIds = new Set(
          (await getPendingSyncQueue())
            .filter((q) => q.entity === "measurement_set" && q.action !== "delete")
            .map((q) => q.payload["id"] as string)
            .filter(Boolean),
        );
        const localById = new Map(localSets.map((set) => [set.id, set]));
        const combined = rows.map((row) => pendingIds.has(row.id) ? (localById.get(row.id) ?? row) : row);
        const serverIds = new Set(rows.map((r) => r.id));
        combined.push(
          ...localSets.filter(
            (l) => !serverIds.has(l.id) && (!businessId || l.business_id === businessId || !l.business_id),
          ),
        );
        const enriched = await enrichMeasurementSetsWithClients(combined);
        setLocalItems("measurement_sets", enriched).catch(() => {});
        return enriched;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
  const filtered = businessId
    ? all.filter((s) => s.business_id === businessId || !s.business_id)
    : all;
  const enriched = await enrichMeasurementSetsWithClients(filtered);
  return enriched.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
}

export async function fetchMeasurementSets(clientId: string): Promise<MeasurementSetRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from("measurement_sets")
        .select("*, measurement_values(id, name, value, unit, position)")
        .eq("client_id", clientId)
        .eq("business_id", businessId)
        .order("recorded_at", { ascending: false });
      if (!error && data) {
        const rows = data as unknown as MeasurementSetRow[];
        const localSets = await getAllLocalItems<MeasurementSetRow>("measurement_sets");
        const pendingIds = new Set(
          (await getPendingSyncQueue())
            .filter((q) => q.entity === "measurement_set" && q.action !== "delete")
            .map((q) => q.payload["id"] as string)
            .filter(Boolean),
        );
        const localById = new Map(localSets.map((set) => [set.id, set]));
        const combined = rows
          .filter((row) => row.client_id === clientId)
          .map((row) => pendingIds.has(row.id) ? (localById.get(row.id) ?? row) : row);
        const serverIds = new Set(rows.map((r) => r.id));
        combined.push(
          ...localSets.filter((l) => l.client_id === clientId && !serverIds.has(l.id)),
        );
        // Ne pas écraser tout le store quand on filtre par clientId
        combined.forEach((set) => setLocalItem("measurement_sets", set).catch(() => {}));
        return combined;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<MeasurementSetRow>("measurement_sets");
  const bId = await currentBusinessId().catch(() => "");
  return all
    .filter((s) => s.client_id === clientId && (!bId || !s.business_id || s.business_id === bId))
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
}

export async function fetchAppointments(opts?: { clientId?: string }): Promise<AppointmentRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase
        .from("appointments")
        .select("*, clients(first_name, last_name, phone, whatsapp)");
      if (businessId) query = query.eq("business_id", businessId);
      if (opts?.clientId) query = query.eq("client_id", opts.clientId);
      const { data, error } = await query
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true, nullsFirst: true });
      if (!error && data) {
        const rows = data as unknown as AppointmentRow[];
        const localAppts = await getAllLocalItems<AppointmentRow>("appointments");
        const pendingIds = new Set(
          (await getPendingSyncQueue())
            .filter((q) => q.entity === "appointment" && q.action !== "delete")
            .map((q) => q.payload["id"] as string)
            .filter(Boolean),
        );
        const localById = new Map(localAppts.map((appointment) => [appointment.id, appointment]));
        const combined = rows.map((row) => pendingIds.has(row.id) ? (localById.get(row.id) ?? row) : row);
        const serverIds = new Set(rows.map((r) => r.id));
        combined.push(
          ...localAppts.filter(
            (l) => !serverIds.has(l.id)
              && (!businessId || l.business_id === businessId || !l.business_id)
              && (!opts?.clientId || l.client_id === opts.clientId),
          ),
        );
        const enriched = await enrichAppointmentsWithClients(combined);
        // Ne pas écraser tout le store quand on filtre par clientId
        if (!opts?.clientId) {
          setLocalItems("appointments", enriched).catch(() => {});
        } else {
          enriched.forEach((appt) => setLocalItem("appointments", appt).catch(() => {}));
        }
        return enriched;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<AppointmentRow & { business_id?: string }>("appointments");
  let filtered = all.filter((a) => a.business_id === businessId || !a.business_id);
  if (opts?.clientId) filtered = filtered.filter((a) => a.client_id === opts.clientId);
  const enriched = await enrichAppointmentsWithClients(filtered);
  return enriched.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
}


export async function fetchPayments(orderId: string): Promise<PaymentRow[]> {
  let businessId = "";
  try {
    businessId = await currentBusinessId();
  } catch {
    // ignore
  }

  // 1. Récupérer les paiements locaux enregistrés (IndexedDB)
  const localPayments = await getAllLocalItems<PaymentRow>("payments");
  const localForOrder = localPayments.filter((p) => p.order_id === orderId);

  // 2. Récupérer les paiements encore en file d'attente de synchronisation
  let pendingPayments: PaymentRow[] = [];
  try {
    const queue = await getPendingSyncQueue();
    pendingPayments = queue
      .filter((q) => q.entity === "payment" && q.action === "create" && (q.payload?.["order_id"] === orderId))
      .map((q) => q.payload as unknown as PaymentRow);
  } catch {
    // ignore
  }

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("payments").select("*").eq("order_id", orderId);
      if (businessId) query = query.eq("business_id", businessId);
      const { data, error } = await query.order("paid_at", { ascending: false });
      if (!error && data) {
        const serverRows = data as unknown as PaymentRow[];
        const serverIds = new Set(serverRows.map((p) => p.id));

        // Fusion sans doublon : conserver paiements serveur + paiements locaux/pending pas encore sur le serveur
        const merged = [...serverRows];
        for (const lp of [...localForOrder, ...pendingPayments]) {
          if (lp && lp.id && !serverIds.has(lp.id)) {
            merged.push(lp);
            serverIds.add(lp.id);
          }
        }

        await setLocalItems("payments", merged).catch(() => {});
        return merged.sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const seenIds = new Set<string>();
  const combined: PaymentRow[] = [];
  for (const p of [...localForOrder, ...pendingPayments]) {
    if (p && p.id && !seenIds.has(p.id)) {
      seenIds.add(p.id);
      combined.push(p);
    }
  }
  return combined.sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
}

export async function fetchOrderImages(orderId: string): Promise<OrderImageRow[]> {
  const businessId = await currentBusinessId();
  const isOnline = typeof navigator === "undefined" || navigator.onLine;

  if (isOnline) {
    try {
      const { data, error } = await supabase
        .from("order_images")
        .select("*")
        .eq("order_id", orderId)
        .eq("business_id", businessId)
        .order("created_at", { ascending: true });
      if (!error && data) {
        const rows = data as unknown as OrderImageRow[];
        // Sauvegarder dans IndexedDB pour la consultation hors-ligne
        await setLocalItems("order_images", rows);

        // Pré-mettre en cache les images de façon asynchrone non-bloquante
        for (const row of rows) {
          if (row.path && !row.path.startsWith("data:")) {
            import("./image-cache")
              .then(async ({ cacheImage }) => {
                const { getSignedUrl } = await import("@/hooks/use-signed-url");
                const url = await getSignedUrl(row.path);
                if (url) cacheImage(row.path, url);
              })
              .catch(() => {});
          }
        }

        // Fusionner avec d'éventuelles photos locales en attente de sync
        const pendingQueue = await getPendingSyncQueue();
        const pendingImages = pendingQueue
          .filter(
            (q) =>
              q.entity === "order_image" &&
              q.action !== "delete" &&
              q.payload["order_id"] === orderId,
          )
          .map((q) => q.payload as unknown as OrderImageRow);

        const deletedIds = new Set(
          pendingQueue
            .filter((q) => q.entity === "order_image" && q.action === "delete")
            .map((q) => q.payload["id"] as string),
        );

        const map = new Map<string, OrderImageRow>();
        for (const r of rows) {
          if (!deletedIds.has(r.id)) map.set(r.id, r);
        }
        for (const p of pendingImages) {
          if (p && p.id && !deletedIds.has(p.id)) map.set(p.id, p);
        }
        return Array.from(map.values()).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      }
    } catch {
      // Repli hors-ligne ci-dessous
    }
  }

  // Fallback Hors-ligne : lire depuis IndexedDB
  try {
    const allLocal = await getAllLocalItems<OrderImageRow>("order_images");
    const localForOrder = allLocal.filter((img) => img.order_id === orderId);

    const pendingQueue = await getPendingSyncQueue();
    const pendingImages = pendingQueue
      .filter(
        (q) =>
          q.entity === "order_image" &&
          q.action !== "delete" &&
          q.payload["order_id"] === orderId,
      )
      .map((q) => q.payload as unknown as OrderImageRow);

    const deletedIds = new Set(
      pendingQueue
        .filter((q) => q.entity === "order_image" && q.action === "delete")
        .map((q) => q.payload["id"] as string),
    );

    const map = new Map<string, OrderImageRow>();
    for (const r of localForOrder) {
      if (!deletedIds.has(r.id)) map.set(r.id, r);
    }
    for (const p of pendingImages) {
      if (p && p.id && !deletedIds.has(p.id)) map.set(p.id, p);
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  } catch {
    return [];
  }
}

export async function saveOrderImageOffline(
  imageData: {
    order_id: string;
    path: string;
    kind: string;
    caption?: string | null;
  },
  existingId?: string,
): Promise<OrderImageRow> {
  const businessId = await currentBusinessId();
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const imageId = existingId || uuid();

  const localRow: OrderImageRow = {
    id: imageId,
    business_id: businessId,
    order_id: imageData.order_id,
    path: imageData.path,
    kind: imageData.kind || "autre",
    caption: imageData.caption || null,
    created_at: new Date().toISOString(),
  };

  // 1. Sauvegarder immédiatement dans IndexedDB
  await setLocalItem("order_images", localRow);

  // 2. Si en ligne et que ce n'est pas une DataURL temporaire, tenter l'insertion Supabase
  if (isOnline && !imageData.path.startsWith("data:")) {
    try {
      const { data, error } = await supabase
        .from("order_images")
        .upsert(localRow as never, { onConflict: "id" })
        .select()
        .single();
      if (!error && data) {
        const saved = data as unknown as OrderImageRow;
        await setLocalItem("order_images", saved);
        return saved;
      }
    } catch {
      // repli vers la file de sync
    }
  }

  // 3. Mettre en file d'attente de synchronisation (ne jamais throw ici)
  try {
    await addToSyncQueue({
      entity: "order_image",
      action: "create",
      payload: localRow,
      tempId: imageId,
    });
  } catch { /* ignore */ }

  return localRow;
}

export async function deleteOrderImageOffline(
  imageId: string,
  orderId?: string,
  path?: string,
): Promise<void> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // 1. Supprimer du stockage local IndexedDB
  await deleteLocalItem("order_images", imageId);

  // 2. Supprimer du cache d'images local si path fourni
  if (path) {
    import("./image-cache")
      .then(({ removeCachedImage }) => removeCachedImage(path))
      .catch(() => {});
  }

  // 3. Si en ligne, tenter la suppression distante
  if (isOnline) {
    try {
      const { error } = await supabase.from("order_images").delete().eq("id", imageId);
      if (!error) {
        if (path && !path.startsWith("data:")) {
          const { deleteStorageFile } = await import("@/hooks/use-signed-url");
          deleteStorageFile(path).catch(() => {});
        }
        return;
      }
    } catch {
      // ignore
    }
  }

  // 4. Mettre en file de synchronisation (ne jamais throw ici)
  try {
    await addToSyncQueue({
      entity: "order_image",
      action: "delete",
      payload: { id: imageId, order_id: orderId, path },
      tempId: imageId,
    });
  } catch { /* ignore */ }
}

export const DEFAULT_GARMENT_TYPES: { id: string; name: string; default_price: number | null }[] = [
  { id: "default_boubou", name: "Boubou", default_price: null },
  { id: "default_faso", name: "Faso Dan Fani", default_price: null },
  { id: "default_costume", name: "Costume", default_price: null },
  { id: "default_chemise", name: "Chemise", default_price: null },
  { id: "default_pantalon", name: "Pantalon", default_price: null },
  { id: "default_robe", name: "Robe", default_price: null },
  { id: "default_jupe", name: "Jupe", default_price: null },
  { id: "default_ensemble", name: "Ensemble", default_price: null },
  { id: "default_traditionnelle", name: "Tenue traditionnelle", default_price: null },
  { id: "default_uniforme", name: "Uniforme", default_price: null },
  { id: "default_autre", name: "Autre", default_price: null },
];

export const DEFAULT_MEASUREMENT_TEMPLATES: { id: string; name: string; fields: string[] }[] = [
  {
    id: "default_homme",
    name: "Homme",
    fields: [
      "Tour de poitrine",
      "Tour de taille",
      "Tour de hanches",
      "Carrure",
      "Longueur épaule",
      "Longueur dos",
      "Longueur manche",
      "Tour de bras",
      "Tour de poignet",
      "Longueur pantalon",
      "Tour de cuisse",
      "Tour de genou",
      "Tour de cheville",
    ],
  },
  {
    id: "default_femme",
    name: "Femme",
    fields: [
      "Tour de poitrine",
      "Sous-poitrine",
      "Tour de taille",
      "Tour de hanches",
      "Carrure",
      "Longueur épaule",
      "Longueur dos",
      "Longueur devant",
      "Longueur manche",
      "Tour de bras",
      "Longueur robe",
      "Longueur jupe",
      "Tour de cuisse",
    ],
  },
  {
    id: "default_enfant",
    name: "Enfant",
    fields: [
      "Tour de poitrine",
      "Tour de taille",
      "Tour de hanches",
      "Longueur dos",
      "Longueur manche",
      "Longueur pantalon",
    ],
  },
];

export async function fetchGarmentTypes(): Promise<{ id: string; name: string; default_price: number | null }[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from("garment_types")
        .select("id, name, default_price")
        .eq("business_id", businessId)
        .order("name");
      if (!error && data && data.length > 0) {
        const rows = data as unknown as { id: string; name: string; default_price: number | null }[];
        setLocalItems("garment_types", rows).catch(() => {});
        return rows;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<{ id: string; name: string; default_price: number | null; business_id?: string }>("garment_types");
  const filtered = all.filter((g) => g.business_id === businessId || !g.business_id);
  return filtered.length > 0 ? filtered : DEFAULT_GARMENT_TYPES;
}

export async function fetchTemplates(): Promise<{ id: string; name: string; fields: string[] }[]> {
  const getFallbackTemplates = (): { id: string; name: string; fields: string[] }[] => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("couturpro_cached_templates");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // ignore
      }
    }
    return DEFAULT_MEASUREMENT_TEMPLATES;
  };

  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  if (!isOnline) {
    return getFallbackTemplates();
  }

  try {
    const businessId = await currentBusinessId();
    const { data, error } = await supabase
      .from("measurement_templates")
      .select("id, name, fields")
      .eq("business_id", businessId)
      .order("name");
    if (!error && data && data.length > 0) {
      const rows = data as unknown as { id: string; name: string; fields: string[] }[];
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("couturpro_cached_templates", JSON.stringify(rows));
        } catch {
          // ignore
        }
      }
      return rows;
    }
  } catch {
    // Mode hors-ligne ou erreur réseau
  }

  return getFallbackTemplates();
}

export type CatalogModelRow = {
  id: string;
  business_id: string;
  name: string;
  category: string;
  description: string | null;
  default_price: number | null;
  fabric_needed: string | null;
  photo_paths: string[];
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function fetchCatalogModels(
  category?: string,
  bizId?: string,
  options?: { publicAccess?: boolean },
): Promise<CatalogModelRow[]> {
  const publicAccess = options?.publicAccess === true;
  const businessId = bizId || (publicAccess ? undefined : await currentBusinessId());

  if (!businessId) return [];

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("catalog_models").select("*").eq("business_id", businessId);
      if (category && category !== "all") {
        query = query.eq("category", category);
      }
      const { data, error } = await query
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (data) {
        const deletingIds = publicAccess ? new Set<string>() : await pendingCatalogDeleteIds();
        const serverRows = (data as unknown as CatalogModelRow[]).filter((m) => !deletingIds.has(m.id));
        if (publicAccess) return serverRows;

        const localModels = await getAllLocalItems<CatalogModelRow>("catalog_models");
        const serverIds = new Set(serverRows.map((m) => m.id));
        const pendingLocals = localModels.filter(
          (m) =>
            m.is_active &&
            !serverIds.has(m.id) &&
            !deletingIds.has(m.id) &&
            (!businessId || m.business_id === businessId || !m.business_id)
        );
        const combined = [...serverRows, ...pendingLocals];
        setLocalItems("catalog_models", combined).catch(() => {});
        return combined;
      }
    } catch (err) {
      if (publicAccess) throw err;
      // Fallback IndexedDB pour le propriétaire hors-ligne
    }
  }

  if (publicAccess) return [];

  const all = await getAllLocalItems<CatalogModelRow>("catalog_models");
  let filtered = all.filter((m) => m.is_active && (!businessId || m.business_id === businessId || !m.business_id));
  if (category && category !== "all") {
    filtered = filtered.filter((m) => m.category === category);
  }
  return filtered;
}

export async function fetchCatalogModel(id: string): Promise<CatalogModelRow | null> {
  const businessId = await currentBusinessId();
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("catalog_models").select("*").eq("id", id);
      if (businessId) query = query.eq("business_id", businessId);
      const { data, error } = await query.maybeSingle();
      if (!error && data) {
        const model = data as unknown as CatalogModelRow;
        setLocalItem("catalog_models", model).catch(() => {});
        return model;
      }
    } catch {
      // Fallback
    }
  }
  return getLocalItem<CatalogModelRow>("catalog_models", id);
}

function isNetworkError(error: { message?: string; name?: string } | null | undefined): boolean {
  const msg = `${error?.name ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("offline") ||
    msg.includes("abort")
  );
}

export function isMissingDbRoutine(error: { message?: string; code?: string } | null | undefined): boolean {
  const msg = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    msg.includes("pgrst202") ||
    msg.includes("could not find the function") ||
    msg.includes("schema cache") ||
    (msg.includes("function") && msg.includes("does not exist"))
  );
}

export function parseCatalogRpcPayload(data: unknown): Record<string, unknown> | null {
  if (data == null) return null;
  try {
    const obj = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return obj as Record<string, unknown>;
  } catch {
    return null;
  }
}

function catalogRpcPhotoPaths(data: unknown, fallback: string[] = []): string[] {
  const parsed = parseCatalogRpcPayload(data);
  const paths = parsed?.["photo_paths"];
  if (!Array.isArray(paths)) return fallback;
  return paths.filter((p): p is string => typeof p === "string" && p.length > 0);
}

function catalogRpcRow(data: unknown): CatalogModelRow | null {
  const parsed = parseCatalogRpcPayload(data);
  if (!parsed || typeof parsed["id"] !== "string" || typeof parsed["name"] !== "string") {
    return null;
  }
  const photoPaths = Array.isArray(parsed["photo_paths"])
    ? parsed["photo_paths"].filter((p): p is string => typeof p === "string")
    : [];
  const tags = Array.isArray(parsed["tags"])
    ? parsed["tags"].filter((t): t is string => typeof t === "string")
    : [];
  return {
    id: parsed["id"],
    business_id: typeof parsed["business_id"] === "string" ? parsed["business_id"] : "",
    name: parsed["name"],
    category: typeof parsed["category"] === "string" ? parsed["category"] : "boubou",
    description: typeof parsed["description"] === "string" ? parsed["description"] : null,
    default_price:
      typeof parsed["default_price"] === "number"
        ? parsed["default_price"]
        : parsed["default_price"] == null
          ? null
          : Number(parsed["default_price"]) || null,
    fabric_needed: typeof parsed["fabric_needed"] === "string" ? parsed["fabric_needed"] : null,
    photo_paths: photoPaths,
    tags,
    is_active: parsed["is_active"] !== false,
    created_at: typeof parsed["created_at"] === "string" ? parsed["created_at"] : new Date().toISOString(),
    updated_at: typeof parsed["updated_at"] === "string" ? parsed["updated_at"] : new Date().toISOString(),
  };
}

async function pendingCatalogDeleteIds(): Promise<Set<string>> {
  try {
    const queue = await getPendingSyncQueue();
    return new Set(
      queue
        .filter((item) => item.entity === "catalog_model" && item.action === "delete")
        .map((item) => String(item.payload["id"] ?? item.tempId ?? ""))
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

export async function deleteCatalogModel(id: string): Promise<void> {
  const businessId = await currentBusinessId();
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const local = await getLocalItem<CatalogModelRow>("catalog_models", id);
  const localPhotoPaths = local?.photo_paths ?? [];

  async function queueOfflineDelete() {
    await deleteLocalItem("catalog_models", id);
    try {
      await addToSyncQueue({
        entity: "catalog_model",
        action: "delete",
        payload: { id, business_id: businessId, photo_paths: localPhotoPaths },
      });
    } catch { /* ignore */ }
  }

  if (isOnline) {
    try {
      const rpc = await supabase.rpc("delete_catalog_model", { p_model_id: id });
      if (!rpc.error) {
        await deleteLocalItem("catalog_models", id);
        await deleteStorageFiles(catalogRpcPhotoPaths(rpc.data, localPhotoPaths));
        return;
      }
      if (!isMissingDbRoutine(rpc.error)) {
        const rpcMsg = (rpc.error.message ?? "").toLowerCase();
        if (rpcMsg.includes("autoris") || rpcMsg.includes("permission") || rpcMsg.includes("row-level")) {
          throw new Error(rpc.error.message || "Impossible de supprimer ce modèle.");
        }
      }
    } catch (err) {
      if (err instanceof Error && !isNetworkError(err)) {
        const msg = err.message.toLowerCase();
        if (msg.includes("autoris") || msg.includes("permission") || msg.includes("row-level")) {
          throw err;
        }
      }
    }

    let query = supabase.from("catalog_models").delete().eq("id", id);
    if (businessId) query = query.eq("business_id", businessId);
    let { data, error } = await query.select("id, photo_paths");

    if (!error && (data ?? []).length === 0) {
      const retry = await supabase.from("catalog_models").delete().eq("id", id).select("id, photo_paths");
      data = retry.data;
      error = retry.error;
    }

    if (error && isNetworkError(error)) {
      await queueOfflineDelete();
      return;
    }

    if (error) {
      throw new Error(error.message || "Impossible de supprimer ce modèle.");
    }

    let deleted = (data ?? []) as Array<{ id: string; photo_paths?: string[] | null }>;

    if (deleted.length === 0) {
      let softQuery = supabase
        .from("catalog_models")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (businessId) softQuery = softQuery.eq("business_id", businessId);
      const soft = await softQuery.select("id, photo_paths");
      if (soft.error && isNetworkError(soft.error)) {
        await queueOfflineDelete();
        return;
      }
      if (soft.error) {
        throw new Error(soft.error.message || "Impossible de supprimer ce modèle.");
      }
      deleted = (soft.data ?? []) as Array<{ id: string; photo_paths?: string[] | null }>;
    }

    if (deleted.length === 0) {
      throw new Error(
        "Le modèle n'a pas pu être supprimé. Vérifiez que vous êtes bien connecté avec le compte de l'atelier.",
      );
    }

    await deleteLocalItem("catalog_models", id);
    const paths = deleted[0]?.photo_paths ?? localPhotoPaths;
    await deleteStorageFiles(paths);
    return;
  }

  await queueOfflineDelete();
}

export async function saveCatalogModelOffline(
  modelData: Record<string, unknown>,
  isNew: boolean,
  existingId?: string,
): Promise<CatalogModelRow> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mData: Record<string, any> = modelData;
  const modelId = existingId || uuid();

  let existingModel: CatalogModelRow | null = null;
  if (existingId) {
    existingModel = await getLocalItem<CatalogModelRow>("catalog_models", existingId);
  }

  const businessId =
    (mData["business_id"] as string) ||
    existingModel?.business_id ||
    (await currentBusinessId());

  if (!businessId) {
    throw new Error("Atelier introuvable. Rechargez la page puis réessayez.");
  }

  const localModel: CatalogModelRow = {
    id: modelId,
    business_id: businessId,
    name: (mData["name"] as string) ?? existingModel?.name ?? "",
    category: (mData["category"] as string) ?? existingModel?.category ?? "boubou",
    description: mData["description"] !== undefined ? (mData["description"] as string | null) : (existingModel?.description ?? null),
    default_price: mData["default_price"] !== undefined ? (mData["default_price"] as number | null) : (existingModel?.default_price ?? null),
    fabric_needed: mData["fabric_needed"] !== undefined ? (mData["fabric_needed"] as string | null) : (existingModel?.fabric_needed ?? null),
    photo_paths: (mData["photo_paths"] as string[]) ?? existingModel?.photo_paths ?? [],
    tags: (mData["tags"] as string[]) ?? existingModel?.tags ?? [],
    is_active: true,
    created_at:
      existingModel?.created_at ||
      (typeof mData["created_at"] === "string" ? mData["created_at"] : null) ||
      new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  localModel.photo_paths = await materializeStoragePaths(businessId, localModel.photo_paths, "catalog");
  const hasLocalOnlyPhotos = localModel.photo_paths.some((path) => path.startsWith("data:"));
  await setLocalItem("catalog_models", localModel);

  if (isOnline && businessId && !hasLocalOnlyPhotos) {
    try {
      const rpc = await supabase.rpc("save_catalog_model", {
        p_model: localModel as unknown as Json,
      });
      if (!rpc.error) {
        const row = catalogRpcRow(rpc.data);
        if (row) {
          await setLocalItem("catalog_models", row);
          return row;
        }
      } else if (!isMissingDbRoutine(rpc.error) && !isNetworkError(rpc.error)) {
        const rpcMsg = (rpc.error.message ?? "").toLowerCase();
        if (rpcMsg.includes("autoris") || rpcMsg.includes("permission") || rpcMsg.includes("row-level")) {
          throw new Error(rpc.error.message || "Impossible d'enregistrer le modèle.");
        }
      }
    } catch (err) {
      if (err instanceof Error && !isNetworkError(err)) {
        const msg = err.message.toLowerCase();
        if (msg.includes("autoris") || msg.includes("permission") || msg.includes("row-level")) {
          throw err;
        }
      }
    }

    const { data, error } = await supabase
      .from("catalog_models")
      .upsert(localModel as never, { onConflict: "id" })
      .select()
      .single();
    if (error) {
      if (!isNetworkError(error)) {
        throw new Error(error.message || "Impossible d'enregistrer le modèle.");
      }
    } else if (data) {
      const row = data as unknown as CatalogModelRow;
      await setLocalItem("catalog_models", row);
      return row;
    }
  }

  try {
    await addToSyncQueue({
      entity: "catalog_model",
      action: isNew ? "create" : "update",
      payload: localModel,
      tempId: modelId,
    });
  } catch { /* ignore */ }

  return localModel;
}

// ============================================================
// OPÉRATIONS D'ÉCRITURE OFFLINE-FIRST (Clients, Commandes, etc.)
// ============================================================

export async function saveClientOffline(
  clientData: Record<string, unknown>,
  isNew: boolean,
  existingId?: string,
): Promise<ClientRow> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cData: Record<string, any> = clientData;

  let existingClient: ClientRow | null = null;
  let resolvedId = existingId;

  if (existingId) {
    // 1. Chercher par l'ID fourni dans IndexedDB
    existingClient = await getLocalItem<ClientRow>("clients", existingId);

    // 2. Si non trouvé localement et que c'est un ID temp_ déjà synchronisé,
    //    chercher via Supabase pour obtenir le vrai UUID
    if (!existingClient && existingId.startsWith("temp_") && isOnline) {
      try {
        const bId = (cData["business_id"] as string) || (await currentBusinessId());
        const { data } = await supabase
          .from("clients")
          .select("*")
          .eq("business_id", bId)
          .eq("first_name", cData["first_name"] as string)
          .maybeSingle();
        if (data) {
          existingClient = data as unknown as ClientRow;
          resolvedId = existingClient.id; // Utiliser le vrai UUID Supabase
        }
      } catch { /* ignore */ }
    }

    // 3. Si toujours pas trouvé localement, essayer getAllLocalItems pour matcher par ID
    if (!existingClient) {
      try {
        const allLocal = await getAllLocalItems<ClientRow>("clients");
        // Chercher un client dont l'ID correspond (peut-être stocké différemment)
        const found = allLocal.find((c) => c.id === existingId);
        if (found) existingClient = found;
      } catch { /* ignore */ }
    }
  }

  const businessId =
    (cData["business_id"] as string) ||
    existingClient?.business_id ||
    (await currentBusinessId());

  // Toujours utiliser le resolvedId (peut être le vrai UUID si temp_ était mappé)
  const clientId = resolvedId || uuid();

  const localClient: ClientRow = {
    id: clientId,
    business_id: businessId,
    first_name: (cData["first_name"] as string) ?? existingClient?.first_name ?? "",
    last_name: (cData["last_name"] as string) ?? existingClient?.last_name ?? "",
    phone: cData["phone"] !== undefined ? (cData["phone"] as string | null) : (existingClient?.phone ?? null),
    whatsapp: cData["whatsapp"] !== undefined ? (cData["whatsapp"] as string | null) : (existingClient?.whatsapp ?? null),
    gender: cData["gender"] !== undefined ? (cData["gender"] as string | null) : (existingClient?.gender ?? null),
    birth_date: cData["birth_date"] !== undefined ? (cData["birth_date"] as string | null) : (existingClient?.birth_date ?? null),
    address: cData["address"] !== undefined ? (cData["address"] as string | null) : (existingClient?.address ?? null),
    city: cData["city"] !== undefined ? (cData["city"] as string | null) : (existingClient?.city ?? null),
    notes: cData["notes"] !== undefined ? (cData["notes"] as string | null) : (existingClient?.notes ?? null),
    photo_url: cData["photo_url"] !== undefined ? (cData["photo_url"] as string | null) : (existingClient?.photo_url ?? null),
    created_at: existingClient?.created_at || new Date().toISOString(),
  };

  await setLocalItem("clients", localClient);

  if (isOnline && businessId) {
    try {
      // Si la photo est un DataURL local, la téléverser vers le bucket storage pour pérenniser l'URL
      if (typeof localClient.photo_url === "string" && localClient.photo_url.startsWith("data:")) {
        const uploadedPath = await uploadDataUrl(businessId, localClient.photo_url, "clients");
        if (uploadedPath) {
          localClient.photo_url = uploadedPath;
          await setLocalItem("clients", localClient);
        }
      }

      // Utiliser UPDATE si c'est une modification existante, INSERT+UPSERT pour création
      let data: unknown = null;
      let error: unknown = null;
      if (!isNew && resolvedId && !resolvedId.startsWith("temp_")) {
        // Modification d'un client connu - UPDATE ciblé par ID
        const { data: d, error: e } = await supabase
          .from("clients")
          .update({
            first_name: localClient.first_name,
            last_name: localClient.last_name,
            phone: localClient.phone,
            whatsapp: localClient.whatsapp,
            gender: localClient.gender,
            birth_date: localClient.birth_date,
            address: localClient.address,
            city: localClient.city,
            notes: localClient.notes,
            photo_url: localClient.photo_url,
          })
          .eq("id", resolvedId)
          .eq("business_id", businessId)
          .select()
          .single();
        data = d; error = e;
      } else {
        // Nouveau client ou temp_ ID - UPSERT par ID
        const { data: d, error: e } = await supabase
          .from("clients")
          .upsert(localClient as never, { onConflict: "id" })
          .select()
          .single();
        data = d; error = e;
      }
      if (!error && data) {
        const row = data as unknown as ClientRow;
        await setLocalItem("clients", row);
        return row;
      }
      // Si l'UPDATE n'a rien retourné (client non trouvé en base), continuer vers sync_queue
    } catch {
      // Fallback hors-ligne
    }
  }


  // Ne jamais throw ici : la sauvegarde locale a déjà réussi
  try {
    await addToSyncQueue({
      entity: "client",
      action: isNew ? "create" : "update",
      payload: localClient,
      tempId: clientId,
    });
  } catch { /* ignore - données déjà sauvegardées en local */ }

  return localClient;
}

export async function saveOrderOffline(
  orderData: Record<string, unknown>,
  isNew: boolean,
  existingId?: string,
): Promise<OrderRow> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oData: Record<string, any> = orderData;
  const orderId = existingId || uuid();

  // Si c'est une mise à jour d'une commande existante, récupérer l'état existant pour fusionner !
  let existingOrder: OrderRow | null = null;
  if (existingId) {
    existingOrder = await getLocalItem<OrderRow>("orders", existingId);
    if (!existingOrder && isOnline) {
      try {
        const { data } = await supabase
          .from("orders")
          .select(ORDER_SELECT)
          .eq("id", existingId)
          .maybeSingle();
        if (data) existingOrder = data as unknown as OrderRow;
      } catch {
        // ignore
      }
    }
  }

  const businessId =
    (oData["business_id"] as string) ||
    existingOrder?.business_id ||
    (await currentBusinessId());

  const localOrder: OrderRow = {
    id: orderId,
    business_id: businessId,
    client_id: (oData["client_id"] as string) ?? existingOrder?.client_id ?? "",
    reference: (oData["reference"] as string) ?? existingOrder?.reference ?? `CMD-${Date.now().toString().slice(-4)}`,
    garment_type: (oData["garment_type"] as string) ?? existingOrder?.garment_type ?? "",
    fabric: oData["fabric"] !== undefined ? (oData["fabric"] as string | null) : (existingOrder?.fabric ?? null),
    quantity: oData["quantity"] !== undefined
      ? (() => { const v = Number(oData["quantity"]); return isNaN(v) || v < 1 ? 1 : Math.round(v); })()
      : (existingOrder?.quantity ?? 1),
    description: oData["description"] !== undefined ? (oData["description"] as string | null) : (existingOrder?.description ?? null),
    price: oData["price"] !== undefined
      ? (() => { const v = Number(oData["price"]); return isNaN(v) || v < 0 ? 0 : v; })()
      : (existingOrder?.price ?? 0),
    ordered_at: (oData["ordered_at"] as string) ?? existingOrder?.ordered_at ?? (new Date().toISOString().split("T")[0] as string),
    due_date: oData["due_date"] !== undefined ? (oData["due_date"] as string | null) : (existingOrder?.due_date ?? null),
    status: (oData["status"] as OrderStatus) ?? existingOrder?.status ?? "nouvelle",
    notes: oData["notes"] !== undefined ? (oData["notes"] as string | null) : (existingOrder?.notes ?? null),
    delivered_at: oData["delivered_at"] !== undefined ? (oData["delivered_at"] as string | null) : (existingOrder?.delivered_at ?? null),
    delivered_to: oData["delivered_to"] !== undefined ? (oData["delivered_to"] as string | null) : (existingOrder?.delivered_to ?? null),
    delivery_note: oData["delivery_note"] !== undefined ? (oData["delivery_note"] as string | null) : (existingOrder?.delivery_note ?? null),
    created_at: existingOrder?.created_at || new Date().toISOString(),
    clients: existingOrder?.clients,
    payments: existingOrder?.payments,
  };

  await setLocalItem("orders", localOrder);

  if (isOnline && businessId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const upsertPayload: Record<string, any> = { ...localOrder };
      delete upsertPayload["clients"];
      delete upsertPayload["payments"];
      const { data, error } = await supabase
        .from("orders")
        .upsert(upsertPayload as never, { onConflict: "id" })
        .select()
        .single();
      if (!error && data) {
        const row: OrderRow = {
          ...localOrder,
          ...(data as unknown as OrderRow),
          clients: localOrder.clients,
          payments: localOrder.payments,
        };
        await setLocalItem("orders", row);
        return row;
      }
    } catch {
      // Fallback hors-ligne
    }
  }

  try {
    await addToSyncQueue({
      entity: "order",
      action: isNew ? "create" : "update",
      payload: localOrder,
      tempId: orderId,
    });
  } catch { /* ignore */ }

  return localOrder;
}

export async function savePaymentOffline(paymentData: Record<string, unknown>): Promise<PaymentRow> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const paymentId = (paymentData["id"] as string) || uuid();
  let businessId = (paymentData["business_id"] as string) || "";
  if (!businessId) {
    try {
      businessId = await currentBusinessId();
    } catch {
      // ignore
    }
  }

  const localPayment: PaymentRow = {
    id: paymentId,
    business_id: businessId,
    order_id: (paymentData["order_id"] as string) || "",
    amount: (() => { const v = Number(paymentData["amount"] || 0); return isNaN(v) || v < 0 ? 0 : v; })(),
    method: (paymentData["method"] as string) || "especes",
    paid_at: (paymentData["paid_at"] as string) || (new Date().toISOString().split("T")[0] as string),
    note: (paymentData["note"] as string) || null,
  };

  await setLocalItem("payments", localPayment);

  // Mettre à jour immédiatement la commande locale pour que son solde soit à jour instantanément
  if (localPayment.order_id) {
    try {
      const ord = await getLocalItem<OrderRow>("orders", localPayment.order_id);
      if (ord) {
        const existingPayments = (ord.payments || []).filter((p) => p.id !== localPayment.id);
        const updatedOrder: OrderRow = {
          ...ord,
          payments: [...existingPayments, { id: localPayment.id, amount: localPayment.amount }],
        };
        await setLocalItem("orders", updatedOrder);
      }
    } catch {
      // ignore
    }
  }

  if (isOnline && businessId) {
    try {
      const { data, error } = await supabase
        .from("payments")
        .upsert(localPayment as never, { onConflict: "id" })
        .select()
        .single();
      if (!error && data) {
        const row = data as unknown as PaymentRow;
        await setLocalItem("payments", row);
        return row;
      }
    } catch {
      // Fallback
    }
  }

  try {
    await addToSyncQueue({
      entity: "payment",
      action: "create",
      payload: localPayment,
      tempId: paymentId,
    });
  } catch { /* ignore */ }

  return localPayment;
}

export async function deletePaymentOffline(paymentId: string, orderId?: string): Promise<void> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // 1. Supprimer du stockage local
  await deleteLocalItem("payments", paymentId);

  // 2. Mettre à jour la commande locale si fournie
  if (orderId) {
    try {
      const ord = await getLocalItem<OrderRow>("orders", orderId);
      if (ord && ord.payments) {
        const updatedOrder: OrderRow = {
          ...ord,
          payments: ord.payments.filter((p) => p.id !== paymentId),
        };
        await setLocalItem("orders", updatedOrder);
      }
    } catch {
      // ignore
    }
  }

  // 3. Si en ligne, tenter la suppression distante
  if (isOnline) {
    try {
      const { error } = await supabase.from("payments").delete().eq("id", paymentId);
      if (!error) return;
    } catch {
      // ignore
    }
  }

  // 4. Mettre en file de synchronisation (ne jamais throw ici)
  try {
    await addToSyncQueue({
      entity: "payment",
      action: "delete",
      payload: { id: paymentId, order_id: orderId },
      tempId: paymentId,
    });
  } catch { /* ignore */ }
}

export async function saveMeasurementSetOffline(
  setData: Record<string, unknown>,
  values: Array<{ name: string; value: number | null; unit: string; position: number }>,
  isNew: boolean = true,
  existingId?: string,
): Promise<FullMeasurementSetRow> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const setId = existingId || (setData["id"] as string) || uuid();

  let existingSet: FullMeasurementSetRow | null = null;
  if (existingId) {
    existingSet = await getLocalItem<FullMeasurementSetRow>("measurement_sets", existingId);
  }

  const clientId = (setData["client_id"] as string) || existingSet?.client_id || "";
  let clientInfo = existingSet?.clients ?? null;
  if (!clientInfo && clientId) {
    try {
      const localClient = await getLocalItem<ClientRow>("clients", clientId);
      if (localClient) {
        clientInfo = {
          id: localClient.id,
          first_name: localClient.first_name,
          last_name: localClient.last_name,
          phone: localClient.phone,
          whatsapp: localClient.whatsapp,
          gender: localClient.gender,
        };
      }
    } catch {
      // ignore
    }
  }

  const businessId = (setData["business_id"] as string) || existingSet?.business_id || (await currentBusinessId());

  const localValues = values.map((v, i) => ({
    id: `val_${i}`,
    name: v.name,
    value: v.value,
    unit: v.unit || "cm",
    position: v.position ?? i,
  }));

  const localSet: FullMeasurementSetRow = {
    id: setId,
    business_id: businessId,
    client_id: clientId,
    label: (setData["label"] as string) ?? existingSet?.label ?? null,
    template_name: (setData["template_name"] as string) ?? existingSet?.template_name ?? null,
    notes: (setData["notes"] as string) ?? existingSet?.notes ?? null,
    recorded_at: (setData["recorded_at"] as string) || existingSet?.recorded_at || new Date().toISOString(),
    created_at: existingSet?.created_at || new Date().toISOString(),
    clients: clientInfo,
    measurement_values: localValues,
  };

  await setLocalItem("measurement_sets", localSet);

  if (isOnline && businessId) {
    try {
      const payloadSet = {
        id: setId,
        business_id: businessId,
        client_id: clientId,
        label: localSet.label,
        template_name: localSet.template_name,
        notes: localSet.notes,
        recorded_at: localSet.recorded_at,
      };

      const { data: setRow, error: setError } = await supabase
        .from("measurement_sets")
        .upsert(payloadSet as never, { onConflict: "id" })
        .select()
        .single();

      if (!setError && setRow) {
        const { error: deleteValuesError } = await supabase
          .from("measurement_values")
          .delete()
          .eq("set_id", setId);
        if (deleteValuesError) throw deleteValuesError;
        if (values.length > 0) {
          const { error: insertValuesError } = await supabase
            .from("measurement_values")
            .insert(
              values.map((v, i) => ({
                business_id: businessId,
                set_id: setId,
                name: v.name,
                value: v.value,
                unit: v.unit || "cm",
                position: v.position ?? i,
              })) as never,
            );
          if (insertValuesError) throw insertValuesError;
        }
        const fullRow: FullMeasurementSetRow = {
          ...localSet,
          ...(setRow as unknown as FullMeasurementSetRow),
          clients: clientInfo,
          measurement_values: localValues,
        };
        await setLocalItem("measurement_sets", fullRow);
        return fullRow;
      }
    } catch {
      // Fallback
    }
  }

  // Ne jamais throw ici : la sauvegarde locale a déjà réussi
  try {
    await addToSyncQueue({
      entity: "measurement_set",
      action: isNew ? "create" : "update",
      payload: {
        ...setData,
        id: setId,
        business_id: businessId,
        client_id: clientId,
        values: values.map((v, i) => ({
          business_id: businessId,
          name: v.name,
          value: v.value,
          unit: v.unit || "cm",
          position: v.position ?? i,
        })),
      },
      tempId: setId,
    });
  } catch { /* ignore - données déjà sauvegardées en local */ }

  return localSet;
}

export async function saveAppointmentOffline(
  data: Record<string, unknown>,
  isNew: boolean,
  existingId?: string,
): Promise<AppointmentRow> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const apptId = existingId || (data["id"] as string) || uuid();

  let existingAppt: AppointmentRow | null = null;
  if (existingId) {
    existingAppt = await getLocalItem<AppointmentRow>("appointments", existingId);
  }

  const businessId = (data["business_id"] as string) || existingAppt?.business_id || (await currentBusinessId());
  const clientId = (data["client_id"] as string) || existingAppt?.client_id || null;

  let clientInfo = existingAppt?.clients ?? null;
  if (!clientInfo && clientId) {
    try {
      const localClient = await getLocalItem<ClientRow>("clients", clientId);
      if (localClient) {
        clientInfo = {
          first_name: localClient.first_name,
          last_name: localClient.last_name,
          phone: localClient.phone,
          whatsapp: localClient.whatsapp,
        };
      }
    } catch {
      // ignore
    }
  }

  const localAppt: AppointmentRow = {
    id: apptId,
    business_id: businessId,
    client_id: clientId,
    scheduled_date: (data["scheduled_date"] as string) || existingAppt?.scheduled_date || new Date().toISOString().slice(0, 10),
    scheduled_time: (data["scheduled_time"] as string | null) ?? existingAppt?.scheduled_time ?? null,
    type: (data["type"] as string) || existingAppt?.type || "essayage",
    notes: (data["notes"] as string | null) ?? existingAppt?.notes ?? null,
    status: (data["status"] as string) || existingAppt?.status || "prevu",
    created_at: existingAppt?.created_at || new Date().toISOString(),
    clients: clientInfo,
  };

  await setLocalItem("appointments", localAppt);

  if (isOnline && businessId) {
    try {
      const payload = {
        id: apptId,
        business_id: businessId,
        client_id: clientId,
        scheduled_date: localAppt.scheduled_date,
        scheduled_time: localAppt.scheduled_time,
        type: localAppt.type,
        notes: localAppt.notes,
        status: localAppt.status,
      };

      const { data: savedRow, error } = await supabase
        .from("appointments")
        .upsert(payload as never, { onConflict: "id" })
        .select()
        .single();

      if (!error && savedRow) {
        const fullRow: AppointmentRow = {
          ...localAppt,
          ...(savedRow as unknown as AppointmentRow),
          clients: clientInfo,
        };
        await setLocalItem("appointments", fullRow);
        return fullRow;
      }
    } catch {
      // Fallback
    }
  }

  // Ne jamais throw ici : la sauvegarde locale a déjà réussi
  try {
    await addToSyncQueue({
      entity: "appointment",
      action: isNew ? "create" : "update",
      payload: {
        id: apptId,
        business_id: businessId,
        client_id: clientId,
        scheduled_date: localAppt.scheduled_date,
        scheduled_time: localAppt.scheduled_time,
        type: localAppt.type,
        notes: localAppt.notes,
        status: localAppt.status,
      },
      tempId: apptId,
    });
  } catch { /* ignore */ }

  return localAppt;
}

export async function updateAppointmentStatusOffline(id: string, status: string): Promise<void> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const existing = await getLocalItem<AppointmentRow>("appointments", id);
  if (existing) {
    const updated = { ...existing, status };
    await setLocalItem("appointments", updated);
  }

  const businessId = existing?.business_id || (await currentBusinessId());

  if (isOnline && businessId) {
    try {
      const { error } = await supabase
        .from("appointments")
        .update({ status })
        .eq("id", id)
        .eq("business_id", businessId);
      if (!error) return;
    } catch {
      // Fallback
    }
  }

  try {
    await addToSyncQueue({
      entity: "appointment",
      action: "update",
      payload: { id, business_id: businessId, status },
      tempId: id,
    });
  } catch { /* ignore */ }
}

export async function deleteAppointmentOffline(id: string): Promise<void> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const existing = await getLocalItem<AppointmentRow>("appointments", id);
  await deleteLocalItem("appointments", id);

  const businessId = existing?.business_id || (await currentBusinessId());

  if (isOnline && businessId) {
    try {
      const { error } = await supabase
        .from("appointments")
        .delete()
        .eq("id", id)
        .eq("business_id", businessId);
      if (!error) return;
    } catch {
      // Fallback
    }
  }

  try {
    await addToSyncQueue({
      entity: "appointment",
      action: "delete",
      payload: { id, business_id: businessId },
      tempId: id,
    });
  } catch { /* ignore */ }
}

// ============================================================
// Fonctions de suppression en cascade (avec purge Storage)
// ============================================================

export async function deleteClientCascade(clientId: string, businessId?: string) {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // Suppression locale immédiate (Optimistic UI)
  await deleteLocalItem("clients", clientId);

  if (!isOnline) {
    try {
      await addToSyncQueue({
        entity: "client",
        action: "delete",
        payload: { id: clientId, business_id: businessId },
      });
    } catch { /* ignore - suppression locale déjà effectuée */ }
    return;
  }

  try {
    // 1. Récupère les avatars client
    const { data: clientData } = await supabase
      .from("clients")
      .select("photo_url")
      .eq("id", clientId)
      .maybeSingle();

    // 2. Récupère les commandes du client
    let ordersQuery = supabase
      .from("orders")
      .select("id")
      .eq("client_id", clientId);
    if (businessId) ordersQuery = ordersQuery.eq("business_id", businessId);
    const { data: orders } = await ordersQuery;
    const orderIds = (orders ?? []).map((o) => o.id);

    // 3. Récupère les paths de toutes les photos de commandes
    let photoPaths: string[] = [];
    if (orderIds.length > 0) {
      const { data: images } = await supabase
        .from("order_images")
        .select("path")
        .in("order_id", orderIds);
      photoPaths = (images ?? []).map((img) => img.path).filter(Boolean) as string[];
    }

    // 4. Purge Storage (photo profil + photos commandes)
    const storagePaths = [clientData?.photo_url, ...photoPaths].filter(Boolean) as string[];
    if (storagePaths.length > 0) {
      await deleteStorageFiles(storagePaths);
    }

    // 5. Suppression RPC si disponible
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcError } = await (supabase.rpc as any)("delete_client_cascade", {
        p_client_id: clientId,
        p_business_id: businessId ?? null,
      });
      if (!rpcError) return;
    } catch {
      // ignore
    }

    // 6. Suppression applicative
    if (orderIds.length > 0) {
      await supabase.from("order_images").delete().in("order_id", orderIds);
      await supabase.from("payments").delete().in("order_id", orderIds);
    }
    let ordDel = supabase.from("orders").delete().eq("client_id", clientId);
    if (businessId) ordDel = ordDel.eq("business_id", businessId);
    await ordDel;

    let setsDel = supabase.from("measurement_sets").delete().eq("client_id", clientId);
    if (businessId) setsDel = setsDel.eq("business_id", businessId);
    await setsDel;

    let clientDel = supabase.from("clients").delete().eq("id", clientId);
    if (businessId) clientDel = clientDel.eq("business_id", businessId);
    await clientDel;
  } catch {
    // Si la suppression échoue côté réseau, planifier la suppression dans la file
    await addToSyncQueue({
      entity: "client",
      action: "delete",
      payload: { id: clientId, business_id: businessId },
    });
  }
}

export async function deleteOrderCascade(orderId: string, businessId?: string) {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // Suppression locale immédiate
  await deleteLocalItem("orders", orderId);

  if (!isOnline) {
    try {
      await addToSyncQueue({
        entity: "order",
        action: "delete",
        payload: { id: orderId, business_id: businessId },
      });
    } catch { /* ignore - suppression locale déjà effectuée */ }
    return;
  }

  try {
    let imagesQuery = supabase
      .from("order_images")
      .select("path")
      .eq("order_id", orderId);
    if (businessId) imagesQuery = imagesQuery.eq("business_id", businessId);
    const { data: images } = await imagesQuery;
    const photoPaths = (images ?? []).map((img) => img.path).filter(Boolean) as string[];

    if (photoPaths.length > 0) {
      await deleteStorageFiles(photoPaths);
    }

    await supabase.from("order_images").delete().eq("order_id", orderId);
    await supabase.from("payments").delete().eq("order_id", orderId);

    let orderDel = supabase.from("orders").delete().eq("id", orderId);
    if (businessId) orderDel = orderDel.eq("business_id", businessId);
    await orderDel;
  } catch {
    await addToSyncQueue({
      entity: "order",
      action: "delete",
      payload: { id: orderId, business_id: businessId },
    });
  }
}

export async function deleteMeasurementSetCascade(setId: string, businessId?: string) {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  await deleteLocalItem("measurement_sets", setId);

  if (!isOnline) {
    try {
      await addToSyncQueue({
        entity: "measurement_set",
        action: "delete",
        payload: { id: setId, business_id: businessId },
      });
    } catch { /* ignore - suppression locale déjà effectuée */ }
    return;
  }

  try {
    let query = supabase.from("measurement_sets").delete().eq("id", setId);
    if (businessId) query = query.eq("business_id", businessId);
    await query;
  } catch {
    await addToSyncQueue({
      entity: "measurement_set",
      action: "delete",
      payload: { id: setId, business_id: businessId },
    });
  }
}
