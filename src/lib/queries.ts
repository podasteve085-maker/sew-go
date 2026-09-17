import { supabase } from "@/integrations/supabase/client";
import type { OrderStatus } from "@/lib/domain";

async function currentBusinessId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Session utilisateur introuvable");

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", data.user.id)
    .single();
  if (businessError) throw businessError;
  return business.id as string;
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

export async function fetchOrders(opts?: { clientId?: string }) {
  const businessId = await currentBusinessId();
  let query = supabase.from("orders").select(ORDER_SELECT).eq("business_id", businessId);
  if (opts?.clientId) query = query.eq("client_id", opts.clientId);
  const { data, error } = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as OrderRow[];
}

export async function fetchOrder(id: string) {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as OrderRow | null;
}

export async function fetchClients(term?: string) {
  const businessId = await currentBusinessId();
  let query = supabase.from("clients").select("*").eq("business_id", businessId);
  if (term && term.trim().length >= 1) {
    const like = `%${term.trim()}%`;
    query = query.or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`);
  }
  const { data, error } = await query.order("first_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ClientRow[];
}

export async function fetchClient(id: string) {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).eq("business_id", businessId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as ClientRow | null;
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

export async function fetchAllMeasurementSets() {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase
    .from("measurement_sets")
    .select(
      "*, clients(id, first_name, last_name, phone, whatsapp, gender), measurement_values(id, name, value, unit, position)",
    )
    .eq("business_id", businessId)
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as FullMeasurementSetRow[];
}

export async function fetchMeasurementSets(clientId: string) {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase
    .from("measurement_sets")
    .select("*, measurement_values(id, name, value, unit, position)")
    .eq("client_id", clientId)
    .eq("business_id", businessId)
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MeasurementSetRow[];
}

export async function fetchAppointments(opts?: { clientId?: string }) {
  const businessId = await currentBusinessId();
  let query = supabase
    .from("appointments")
    .select("*, clients(first_name, last_name, phone, whatsapp)")
    .eq("business_id", businessId);
  if (opts?.clientId) query = query.eq("client_id", opts.clientId);
  const { data, error } = await query
    .order("scheduled_date", { ascending: true })
    .order("scheduled_time", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as unknown as AppointmentRow[];
}

export async function fetchPayments(orderId: string) {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .eq("business_id", businessId)
    .order("paid_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PaymentRow[];
}

export async function fetchOrderImages(orderId: string) {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase
    .from("order_images")
    .select("*")
    .eq("order_id", orderId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OrderImageRow[];
}

export async function fetchGarmentTypes() {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase
    .from("garment_types")
    .select("id, name, default_price")
    .eq("business_id", businessId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as unknown as { id: string; name: string; default_price: number | null }[];
}

export async function fetchTemplates() {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase
    .from("measurement_templates")
    .select("id, name, fields")
    .eq("business_id", businessId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as unknown as { id: string; name: string; fields: string[] }[];
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

export async function fetchCatalogModels(category?: string) {
  try {
    const businessId = await currentBusinessId();
    let query = supabase.from("catalog_models").select("*").eq("business_id", businessId);
    if (category && category !== "all") {
      query = query.eq("category", category);
    }
    const { data, error } = await query
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("fetchCatalogModels:", error.message);
      return [] as CatalogModelRow[];
    }
    return (data ?? []) as unknown as CatalogModelRow[];
  } catch (err) {
    console.warn("fetchCatalogModels catch:", err);
    return [] as CatalogModelRow[];
  }
}

export async function fetchCatalogModel(id: string) {
  const businessId = await currentBusinessId();
  const { data, error } = await supabase
    .from("catalog_models")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as CatalogModelRow | null;
}

export async function deleteCatalogModel(id: string) {
  const businessId = await currentBusinessId();
  const { error } = await supabase
    .from("catalog_models")
    .update({ is_active: false })
    .eq("id", id)
    .eq("business_id", businessId);
  if (error) throw error;
}
