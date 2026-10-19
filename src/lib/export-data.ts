/**
 * CouturPro — Moteur d'Exportation & Portabilité des Données (RGPD Art. 20 & Vie Privée)
 * Fonctionne 100% en ligne (Supabase) et hors-ligne (IndexedDB PWA).
 */

import { supabase } from "@/integrations/supabase/client";
import { getAllLocalItems, getLocalItem } from "@/lib/offline-storage";
import { type ClientRow, type OrderRow, type AppointmentRow, type FullMeasurementSetRow } from "@/lib/queries";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Enregistre une trace d'audit si le réseau est disponible
 */
async function logAudit(businessId: string, action: string, details: Record<string, unknown>) {
  if (typeof navigator !== "undefined" && navigator.onLine) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)("log_privacy_audit_event", {
        p_business_id: businessId,
        p_action: action,
        p_details: details,
      });
    } catch {
      // Non bloquant
    }
  }
}

/**
 * 1. EXPORTATION COMPLÈTE DE L'ARCHIVE ATELIER (JSON - Art. 20 RGPD)
 * Télécharge l'ensemble des données de l'atelier, des clients, mensurations,
 * commandes, paiements et rendez-vous dans un format structuré et interopérable.
 */
export async function exportCompleteWorkshopJson(businessId: string, businessName: string): Promise<void> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  let businessData: Record<string, unknown> | null = null;
  let clientsData: unknown[] = [];
  let ordersData: unknown[] = [];
  let paymentsData: unknown[] = [];
  let measurementSetsData: unknown[] = [];
  let measurementValuesData: unknown[] = [];
  let appointmentsData: unknown[] = [];
  let garmentTypesData: unknown[] = [];
  let catalogModelsData: unknown[] = [];

  if (isOnline) {
    try {
      const [
        bizRes,
        clientsRes,
        ordersRes,
        paymentsRes,
        setsRes,
        valuesRes,
        apptsRes,
        garmentsRes,
        modelsRes,
      ] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", businessId).maybeSingle(),
        supabase.from("clients").select("*").eq("business_id", businessId),
        supabase.from("orders").select("*").eq("business_id", businessId),
        supabase.from("payments").select("*").in(
          "order_id",
          (await supabase.from("orders").select("id").eq("business_id", businessId)).data?.map((o) => o.id) || []
        ),
        supabase.from("measurement_sets").select("*").eq("business_id", businessId),
        supabase.from("measurement_values").select("*").eq("business_id", businessId),
        supabase.from("appointments").select("*").eq("business_id", businessId),
        supabase.from("garment_types").select("*").eq("business_id", businessId),
        supabase.from("catalog_models").select("*").eq("business_id", businessId),
      ]);

      businessData = bizRes.data;
      clientsData = clientsRes.data || [];
      ordersData = ordersRes.data || [];
      paymentsData = paymentsRes.data || [];
      measurementSetsData = setsRes.data || [];
      measurementValuesData = valuesRes.data || [];
      appointmentsData = apptsRes.data || [];
      garmentTypesData = garmentsRes.data || [];
      catalogModelsData = modelsRes.data || [];
    } catch {
      // Repli sur le stockage hors-ligne si la requête distante échoue
      businessData = (await getLocalItem<Record<string, unknown>>("workshop_data", businessId)) || null;
      clientsData = await getAllLocalItems("clients");
      ordersData = await getAllLocalItems("orders");
      paymentsData = await getAllLocalItems("payments");
      measurementSetsData = await getAllLocalItems("measurement_sets");
      appointmentsData = await getAllLocalItems("appointments");
      garmentTypesData = await getAllLocalItems("garment_types");
      catalogModelsData = await getAllLocalItems("catalog_models");
    }
  } else {
    // Mode hors-ligne PWA
    businessData = (await getLocalItem<Record<string, unknown>>("workshop_data", businessId)) || null;
    clientsData = await getAllLocalItems("clients");
    ordersData = await getAllLocalItems("orders");
    paymentsData = await getAllLocalItems("payments");
    measurementSetsData = await getAllLocalItems("measurement_sets");
    appointmentsData = await getAllLocalItems("appointments");
    garmentTypesData = await getAllLocalItems("garment_types");
    catalogModelsData = await getAllLocalItems("catalog_models");
  }

  const exportArchive = {
    export_metadata: {
      application: "CouturPro",
      version: "1.0",
      compliance: "RGPD Art. 20 (Droit à la portabilité des données)",
      exported_at: new Date().toISOString(),
      business_id: businessId,
      business_name: businessName,
      source: isOnline ? "Cloud_Supabase" : "PWA_Offline_IndexedDB",
      counts: {
        clients: clientsData.length,
        orders: ordersData.length,
        payments: paymentsData.length,
        measurement_sets: measurementSetsData.length,
        measurement_values: measurementValuesData.length,
        appointments: appointmentsData.length,
        garment_types: garmentTypesData.length,
        catalog_models: catalogModelsData.length,
      },
    },
    workshop: businessData,
    clients: clientsData,
    orders: ordersData,
    payments: paymentsData,
    measurement_sets: measurementSetsData,
    measurement_values: measurementValuesData,
    appointments: appointmentsData,
    garment_types: garmentTypesData,
    catalog_models: catalogModelsData,
  };

  const jsonStr = JSON.stringify(exportArchive, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `couturpro_sauvegarde_${sanitizeFilename(businessName)}_${dateStr}.json`;

  downloadBlob(blob, filename);
  await logAudit(businessId, "DATA_PORTABILITY_EXPORT_JSON", {
    client_count: clientsData.length,
    order_count: ordersData.length,
  });
}

/**
 * 2. EXPORTATION DES CLIENTS EN CSV (Compatible Excel / LibreOffice)
 * Format tabulaire encodé en UTF-8 avec BOM (\uFEFF) pour préserver les accents et caractères spéciaux.
 */
export async function exportClientsCsv(businessId: string, businessName: string): Promise<void> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  let clients: ClientRow[] = [];

  if (isOnline) {
    try {
      const { data } = await supabase
        .from("clients")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true });
      clients = (data as ClientRow[]) || [];
    } catch {
      clients = await getAllLocalItems<ClientRow>("clients");
    }
  } else {
    clients = await getAllLocalItems<ClientRow>("clients");
  }

  const headers = [
    "Identifiant",
    "Nom",
    "Prénom",
    "Téléphone",
    "WhatsApp",
    "Genre",
    "Date_Naissance",
    "Ville",
    "Adresse_Quartier",
    "Notes_Confidentielles",
    "Date_Creation",
  ];

  const rows = clients.map((c) => [
    escapeCsvField(c.id),
    escapeCsvField(c.last_name || ""),
    escapeCsvField(c.first_name || ""),
    escapeCsvField(c.phone || ""),
    escapeCsvField(c.whatsapp || ""),
    escapeCsvField(c.gender || ""),
    escapeCsvField(c.birth_date || ""),
    escapeCsvField(c.city || ""),
    escapeCsvField(c.address || ""),
    escapeCsvField(c.notes || ""),
    escapeCsvField(c.created_at || ""),
  ]);

  const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `couturpro_clients_${sanitizeFilename(businessName)}_${dateStr}.csv`;

  downloadBlob(blob, filename);
  await logAudit(businessId, "DATA_PORTABILITY_EXPORT_CLIENTS_CSV", {
    client_count: clients.length,
  });
}

/**
 * 3. EXPORTATION DU CARNET DE MESURES EN CSV
 */
export async function exportMeasurementsCsv(businessId: string, businessName: string): Promise<void> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  let sets: FullMeasurementSetRow[] = [];

  if (isOnline) {
    try {
      const { data } = await supabase
        .from("measurement_sets")
        .select("*, clients(first_name, last_name, phone), measurement_values(*)")
        .eq("business_id", businessId)
        .order("recorded_at", { ascending: false });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sets = (data as any[]) || [];
    } catch {
      sets = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
    }
  } else {
    sets = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
  }

  const headers = [
    "Identifiant_Releve",
    "Client",
    "Telephone",
    "Libelle",
    "Modele_Gabarit",
    "Date_Releve",
    "Mesures_Detaillees",
    "Notes",
  ];

  const rows = sets.map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (s as any).clients;
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "";
    const clientPhone = c?.phone || "";

    const measuresStr = (s.values || [])
      .map((v) => `${v.name}: ${v.value ?? "-"} ${v.unit}`)
      .join(" | ");

    return [
      escapeCsvField(s.id),
      escapeCsvField(clientName),
      escapeCsvField(clientPhone),
      escapeCsvField(s.label || ""),
      escapeCsvField(s.template_name || ""),
      escapeCsvField(s.recorded_at || ""),
      escapeCsvField(measuresStr),
      escapeCsvField(s.notes || ""),
    ];
  });

  const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `couturpro_mesures_${sanitizeFilename(businessName)}_${dateStr}.csv`;

  downloadBlob(blob, filename);
  await logAudit(businessId, "DATA_PORTABILITY_EXPORT_MEASURES_CSV", {
    sets_count: sets.length,
  });
}

/**
 * 4. EXPORTATION DE LA FICHE CLIENT INDIVIDUELLE (Art. 15 RGPD - Droit d'accès)
 * Permet au couturier de fournir à son client son dossier personnel complet
 * (coordonnées, historique des mensurations, historique des commandes et paiements).
 */
export async function exportSingleClientJson(clientId: string, clientName: string, businessId?: string): Promise<void> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  let clientData: ClientRow | null = null;
  let ordersData: OrderRow[] = [];
  let setsData: FullMeasurementSetRow[] = [];
  let apptsData: AppointmentRow[] = [];

  if (isOnline) {
    try {
      const [cRes, oRes, sRes, aRes] = await Promise.all([
        supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
        supabase.from("orders").select("*, payments(*)").eq("client_id", clientId),
        supabase.from("measurement_sets").select("*, measurement_values(*)").eq("client_id", clientId),
        supabase.from("appointments").select("*").eq("client_id", clientId),
      ]);
      clientData = cRes.data as ClientRow;
      ordersData = (oRes.data as OrderRow[]) || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setsData = (sRes.data as any[]) || [];
      apptsData = (aRes.data as AppointmentRow[]) || [];
    } catch {
      clientData = await getLocalItem<ClientRow>("clients", clientId);
      const allOrders = await getAllLocalItems<OrderRow>("orders");
      ordersData = allOrders.filter((o) => o.client_id === clientId);
      const allSets = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
      setsData = allSets.filter((s) => s.client_id === clientId);
      const allAppts = await getAllLocalItems<AppointmentRow>("appointments");
      apptsData = allAppts.filter((a) => a.client_id === clientId);
    }
  } else {
    clientData = await getLocalItem<ClientRow>("clients", clientId);
    const allOrders = await getAllLocalItems<OrderRow>("orders");
    ordersData = allOrders.filter((o) => o.client_id === clientId);
    const allSets = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
    setsData = allSets.filter((s) => s.client_id === clientId);
    const allAppts = await getAllLocalItems<AppointmentRow>("appointments");
    apptsData = allAppts.filter((a) => a.client_id === clientId);
  }

  const dossier = {
    metadata: {
      application: "CouturPro",
      type: "Fiche Personnelle Client (RGPD Art. 15)",
      generated_at: new Date().toISOString(),
      client_id: clientId,
      client_name: clientName,
    },
    client: clientData,
    mesures: setsData,
    commandes_et_paiements: ordersData,
    rendez_vous: apptsData,
  };

  const jsonStr = JSON.stringify(dossier, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `fiche_client_${sanitizeFilename(clientName)}_${dateStr}.json`;

  downloadBlob(blob, filename);
  if (businessId) {
    await logAudit(businessId, "DATA_ACCESS_EXPORT_SINGLE_CLIENT", {
      client_id: clientId,
      client_name: clientName,
    });
  }
}
