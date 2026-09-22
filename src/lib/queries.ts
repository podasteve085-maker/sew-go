import { supabase } from "@/integrations/supabase/client";
import type { OrderStatus } from "@/lib/domain";
import { deleteStorageFiles } from "@/hooks/use-signed-url";
import {
  setLocalItem,
  setLocalItems,
  getLocalItem,
  getAllLocalItems,
  deleteLocalItem,
  addToSyncQueue,
} from "./offline-storage";

export async function currentBusinessId(): Promise<string> {
  // 0. Si hors-ligne avéré, accès instantané au cache local (0ms de latence)
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (typeof window !== "undefined") {
      const cachedBizId = localStorage.getItem("couturpro_current_business_id");
      if (cachedBizId) return cachedBizId;
    }
  }

  // 1. Tenter la session active Supabase
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("id")
        .eq("owner_id", data.user.id)
        .maybeSingle();
      if (!businessError && business?.id) {
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem("couturpro_current_business_id", business.id);
            localStorage.setItem("couturpro_current_user_id", data.user.id);
          } catch {
            // ignore
          }
        }
        return business.id as string;
      }
    }
  } catch {
    // Mode hors-ligne : bascule sur le cache local
  }

  // 2. Fallback cache local hors-ligne
  if (typeof window !== "undefined") {
    const cachedBizId = localStorage.getItem("couturpro_current_business_id");
    if (cachedBizId) return cachedBizId;
  }

  throw new Error("Session atelier introuvable. Connectez-vous une première fois en ligne.");
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
  order_id: string;
  amount: number;
  method: string;
  paid_at: string;
  note: string | null;
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
  clients?: Pick<ClientRow, "first_name" | "last_name" | "phone" | "whatsapp"> | null;
  payments?: { amount: number }[];
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
  client_id: string;
  label: string | null;
  template_name: string | null;
  notes: string | null;
  recorded_at: string;
  measurement_values?: {
    id: string;
    name: string;
    value: number | null;
    unit: string;
    position: number;
  }[];
};

const ORDER_SELECT =
  "*, clients(first_name, last_name, phone, whatsapp), payments(amount)";

export function paidTotal(order: OrderRow) {
  return (order.payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
}

export function balance(order: OrderRow) {
  return Number(order.price) - paidTotal(order);
}

export async function fetchOrders(opts?: { clientId?: string }): Promise<OrderRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("orders").select(ORDER_SELECT).eq("business_id", businessId);
      if (opts?.clientId) query = query.eq("client_id", opts.clientId);
      const { data, error } = await query
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (!error && data) {
        const rows = data as unknown as OrderRow[];
        setLocalItems("orders", rows).catch(() => {});
        return rows;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const localOrders = await getAllLocalItems<OrderRow>("orders");
  let filtered = localOrders.filter((o) => o.business_id === businessId);
  if (opts?.clientId) {
    filtered = filtered.filter((o) => o.client_id === opts.clientId);
  }
  return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function fetchOrder(id: string): Promise<OrderRow | null> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("id", id)
        .eq("business_id", businessId)
        .maybeSingle();
      if (!error && data) {
        const order = data as unknown as OrderRow;
        setLocalItem("orders", order).catch(() => {});
        return order;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  return getLocalItem<OrderRow>("orders", id);
}

export async function fetchClients(term?: string): Promise<ClientRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase.from("clients").select("*").eq("business_id", businessId);
      if (term && term.trim().length >= 1) {
        const like = `%${term.trim()}%`;
        query = query.or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`);
      }
      const { data, error } = await query.order("first_name", { ascending: true });
      if (!error && data) {
        const rows = data as unknown as ClientRow[];
        setLocalItems("clients", rows).catch(() => {});
        return rows;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const localClients = await getAllLocalItems<ClientRow>("clients");
  let filtered = localClients.filter((c) => c.business_id === businessId);
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
  return filtered.sort((a, b) => a.first_name.localeCompare(b.first_name));
}

export async function fetchClient(id: string): Promise<ClientRow | null> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .maybeSingle();
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
        setLocalItems("measurement_sets", rows).catch(() => {});
        return rows;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
  return all.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
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
        setLocalItems("measurement_sets", rows).catch(() => {});
        return rows;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<MeasurementSetRow>("measurement_sets");
  return all
    .filter((s) => s.client_id === clientId)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
}

export async function fetchAppointments(opts?: { clientId?: string }): Promise<AppointmentRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase
        .from("appointments")
        .select("*, clients(first_name, last_name, phone, whatsapp)")
        .eq("business_id", businessId);
      if (opts?.clientId) query = query.eq("client_id", opts.clientId);
      const { data, error } = await query
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true, nullsFirst: true });
      if (!error && data) {
        const rows = data as unknown as AppointmentRow[];
        setLocalItems("appointments", rows).catch(() => {});
        return rows;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<AppointmentRow & { business_id?: string }>("appointments");
  let filtered = all.filter((a) => a.business_id === businessId || !a.business_id);
  if (opts?.clientId) filtered = filtered.filter((a) => a.client_id === opts.clientId);
  return filtered.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
}

export async function fetchPayments(orderId: string): Promise<PaymentRow[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("order_id", orderId)
        .eq("business_id", businessId)
        .order("paid_at", { ascending: false });
      if (!error && data) {
        const rows = data as unknown as PaymentRow[];
        setLocalItems("payments", rows).catch(() => {});
        return rows;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<PaymentRow>("payments");
  return all.filter((p) => p.order_id === orderId).sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
}

export async function fetchOrderImages(orderId: string): Promise<OrderImageRow[]> {
  const businessId = await currentBusinessId();
  try {
    const { data, error } = await supabase
      .from("order_images")
      .select("*")
      .eq("order_id", orderId)
      .eq("business_id", businessId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as OrderImageRow[];
  } catch {
    return [];
  }
}

export async function fetchGarmentTypes(): Promise<{ id: string; name: string; default_price: number | null }[]> {
  const businessId = await currentBusinessId();

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from("garment_types")
        .select("id, name, default_price")
        .eq("business_id", businessId)
        .order("name");
      if (!error && data) {
        const rows = data as unknown as { id: string; name: string; default_price: number | null }[];
        setLocalItems("garment_types", rows).catch(() => {});
        return rows;
      }
    } catch {
      // Fallback IndexedDB
    }
  }

  const all = await getAllLocalItems<{ id: string; name: string; default_price: number | null; business_id?: string }>("garment_types");
  return all.filter((g) => g.business_id === businessId || !g.business_id);
}

export async function fetchTemplates(): Promise<{ id: string; name: string; fields: string[] }[]> {
  const businessId = await currentBusinessId();
  try {
    const { data, error } = await supabase
      .from("measurement_templates")
      .select("id, name, fields")
      .eq("business_id", businessId)
      .order("name");
    if (error) throw error;
    return (data ?? []) as unknown as { id: string; name: string; fields: string[] }[];
  } catch {
    return [];
  }
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

export async function fetchCatalogModels(category?: string): Promise<CatalogModelRow[]> {
  try {
    const businessId = await currentBusinessId();
    let query = supabase.from("catalog_models").select("*").eq("business_id", businessId);
    if (category && category !== "all") {
      query = query.eq("category", category);
    }
    const { data, error } = await query
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (!error && data) {
      const rows = data as unknown as CatalogModelRow[];
      setLocalItems("catalog_models", rows).catch(() => {});
      return rows;
    }
  } catch {
    // Fallback IndexedDB
  }

  const all = await getAllLocalItems<CatalogModelRow>("catalog_models");
  let filtered = all.filter((m) => m.is_active);
  if (category && category !== "all") {
    filtered = filtered.filter((m) => m.category === category);
  }
  return filtered;
}

export async function fetchCatalogModel(id: string): Promise<CatalogModelRow | null> {
  const businessId = await currentBusinessId();
  try {
    const { data, error } = await supabase
      .from("catalog_models")
      .select("*")
      .eq("id", id)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!error && data) {
      const model = data as unknown as CatalogModelRow;
      setLocalItem("catalog_models", model).catch(() => {});
      return model;
    }
  } catch {
    // Fallback
  }
  return getLocalItem<CatalogModelRow>("catalog_models", id);
}

export async function deleteCatalogModel(id: string): Promise<void> {
  const businessId = await currentBusinessId();
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  if (isOnline) {
    try {
      const { error } = await supabase
        .from("catalog_models")
        .update({ is_active: false })
        .eq("id", id)
        .eq("business_id", businessId);
      if (!error) {
        deleteLocalItem("catalog_models", id).catch(() => {});
        return;
      }
    } catch {
      // Fallback
    }
  }

  await deleteLocalItem("catalog_models", id);
  await addToSyncQueue({
    entity: "catalog_model",
    action: "delete",
    payload: { id },
  });
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
  const businessId = (cData["business_id"] as string) || (await currentBusinessId());

  if (isOnline) {
    try {
      if (isNew) {
        const { data, error } = await supabase.from("clients").insert({ ...cData, business_id: businessId } as never).select().single();
        if (!error && data) {
          const row = data as unknown as ClientRow;
          await setLocalItem("clients", row);
          return row;
        }
      } else if (existingId) {
        const { data, error } = await supabase.from("clients").update(cData as never).eq("id", existingId).select().single();
        if (!error && data) {
          const row = data as unknown as ClientRow;
          await setLocalItem("clients", row);
          return row;
        }
      }
    } catch {
      // Fallback hors-ligne
    }
  }

  // Écriture locale optimiste
  const tempId = existingId || `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const localClient: ClientRow = {
    id: tempId,
    business_id: businessId,
    first_name: (cData["first_name"] as string) || "",
    last_name: (cData["last_name"] as string) || "",
    phone: (cData["phone"] as string) || null,
    whatsapp: (cData["whatsapp"] as string) || null,
    gender: (cData["gender"] as string) || null,
    birth_date: (cData["birth_date"] as string) || null,
    address: (cData["address"] as string) || null,
    city: (cData["city"] as string) || null,
    notes: (cData["notes"] as string) || null,
    photo_url: (cData["photo_url"] as string) || null,
    created_at: new Date().toISOString(),
  };

  await setLocalItem("clients", localClient);
  await addToSyncQueue({
    entity: "client",
    action: isNew ? "create" : "update",
    payload: localClient,
    tempId: isNew ? tempId : undefined,
  });

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
  const businessId = (oData["business_id"] as string) || (await currentBusinessId());

  if (isOnline) {
    try {
      if (isNew) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const insertPayload: Record<string, any> = { ...oData, business_id: businessId };
        delete insertPayload["clients"];
        delete insertPayload["payments"];
        const { data, error } = await supabase.from("orders").insert(insertPayload as never).select().single();
        if (!error && data) {
          const row = data as unknown as OrderRow;
          await setLocalItem("orders", row);
          return row;
        }
      } else if (existingId) {
        const updatePayload = { ...oData };
        delete updatePayload["clients"];
        delete updatePayload["payments"];
        const { data, error } = await supabase.from("orders").update(updatePayload as never).eq("id", existingId).select().single();
        if (!error && data) {
          const row = data as unknown as OrderRow;
          await setLocalItem("orders", row);
          return row;
        }
      }
    } catch {
      // Fallback hors-ligne
    }
  }

  // Écriture locale optimiste
  const tempId = existingId || `temp_ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const localOrder: OrderRow = {
    id: tempId,
    business_id: businessId,
    client_id: (oData["client_id"] as string) || "",
    reference: (oData["reference"] as string) || `CMD-${Date.now().toString().slice(-4)}`,
    garment_type: (oData["garment_type"] as string) || "",
    fabric: (oData["fabric"] as string) || null,
    quantity: Number(oData["quantity"] || 1),
    description: (oData["description"] as string) || null,
    price: Number(oData["price"] || 0),
    ordered_at: (oData["ordered_at"] as string) || (new Date().toISOString().split("T")[0] as string),
    due_date: (oData["due_date"] as string) || null,
    status: (oData["status"] as OrderStatus) || "nouvelle",
    notes: (oData["notes"] as string) || null,
    delivered_at: (oData["delivered_at"] as string) || null,
    delivered_to: (oData["delivered_to"] as string) || null,
    delivery_note: (oData["delivery_note"] as string) || null,
    created_at: new Date().toISOString(),
  };

  await setLocalItem("orders", localOrder);
  await addToSyncQueue({
    entity: "order",
    action: isNew ? "create" : "update",
    payload: localOrder,
    tempId: isNew ? tempId : undefined,
  });

  return localOrder;
}

export async function savePaymentOffline(paymentData: Record<string, unknown>): Promise<PaymentRow> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  if (isOnline) {
    try {
      const { data, error } = await supabase.from("payments").insert(paymentData as never).select().single();
      if (!error && data) {
        const row = data as unknown as PaymentRow;
        await setLocalItem("payments", row);
        return row;
      }
    } catch {
      // Fallback
    }
  }

  const tempId = `temp_pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const localPayment: PaymentRow = {
    id: tempId,
    order_id: (paymentData["order_id"] as string) || "",
    amount: Number(paymentData["amount"] || 0),
    method: (paymentData["method"] as string) || "especes",
    paid_at: (paymentData["paid_at"] as string) || (new Date().toISOString().split("T")[0] as string),
    note: (paymentData["note"] as string) || null,
  };

  await setLocalItem("payments", localPayment);
  await addToSyncQueue({
    entity: "payment",
    action: "create",
    payload: localPayment,
    tempId,
  });

  return localPayment;
}

export async function saveMeasurementSetOffline(
  setData: Record<string, unknown>,
  values: Array<{ name: string; value: number | null; unit: string; position: number }>,
): Promise<MeasurementSetRow> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  if (isOnline) {
    try {
      const { data: setRow, error: setError } = await supabase.from("measurement_sets").insert(setData as never).select().single();
      if (!setError && setRow) {
        if (values.length > 0) {
          await supabase.from("measurement_values").insert(
            values.map((v) => ({
              set_id: (setRow as { id: string }).id,
              name: v.name,
              value: v.value,
              unit: v.unit,
              position: v.position,
            })) as never,
          );
        }
        const fullRow: MeasurementSetRow = {
          ...(setRow as unknown as MeasurementSetRow),
          measurement_values: values.map((v, i) => ({ ...v, id: `val_${i}` })),
        };
        await setLocalItem("measurement_sets", fullRow);
        return fullRow;
      }
    } catch {
      // Fallback
    }
  }

  const tempId = `temp_meas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const localSet: MeasurementSetRow = {
    id: tempId,
    client_id: (setData["client_id"] as string) || "",
    label: (setData["label"] as string) || null,
    template_name: (setData["template_name"] as string) || null,
    notes: (setData["notes"] as string) || null,
    recorded_at: new Date().toISOString(),
    measurement_values: values.map((v, i) => ({ ...v, id: `val_${i}` })),
  };

  await setLocalItem("measurement_sets", localSet);
  await addToSyncQueue({
    entity: "measurement_set",
    action: "create",
    payload: { ...setData, id: tempId, values },
    tempId,
  });

  return localSet;
}

// ============================================================
// Fonctions de suppression en cascade (avec purge Storage)
// ============================================================

export async function deleteClientCascade(clientId: string, businessId?: string) {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // Suppression locale immédiate (Optimistic UI)
  await deleteLocalItem("clients", clientId);

  if (!isOnline) {
    await addToSyncQueue({
      entity: "client",
      action: "delete",
      payload: { id: clientId, business_id: businessId },
    });
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
    await addToSyncQueue({
      entity: "order",
      action: "delete",
      payload: { id: orderId, business_id: businessId },
    });
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
    await addToSyncQueue({
      entity: "measurement_set",
      action: "delete",
      payload: { id: setId, business_id: businessId },
    });
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
