/**
 * CouturPro — Moteur d'Exportation, Portabilité & Sauvegarde Intégrale de l'Atelier
 * Génère des exports 100% hors-ligne (IndexedDB) ou synchronisés (Supabase) :
 * 1. Dossier ZIP Complet (Tous les fichiers Excel CSV + Sauvegarde JSON + Lisez-moi)
 * 2. Rapport PDF Imprimable du Grand Livre de l'Atelier
 * 3. Fichiers Excel individuels (Clients, Mesures, Commandes, Charges & Dépenses, Paiements)
 * 4. Fichier d'archive brute JSON conforme RGPD Art. 20.
 */

import { supabase } from "@/integrations/supabase/client";
import { getAllLocalItems, getLocalItem } from "@/lib/offline-storage";
import {
  type ClientRow,
  type OrderRow,
  type AppointmentRow,
  type FullMeasurementSetRow,
  paidTotal,
  balance,
} from "@/lib/queries";
import type { ExpenseRow } from "@/lib/expenses-types";
import { EXPENSE_CATEGORIES } from "@/lib/expenses-types";
import { SimpleZip } from "@/lib/zip-builder";
import { fcfa } from "@/lib/format";

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

// -----------------------------------------------------------------------------
// COLLECTE UNIFIÉE DES DONNÉES ATELIER (OFFLINE-FIRST)
// -----------------------------------------------------------------------------

export interface CompleteWorkshopData {
  business: Record<string, unknown> | null;
  clients: ClientRow[];
  orders: OrderRow[];
  payments: Array<Record<string, unknown>>;
  measurementSets: FullMeasurementSetRow[];
  appointments: AppointmentRow[];
  expenses: ExpenseRow[];
  garmentTypes: Array<Record<string, unknown>>;
  catalogModels: Array<Record<string, unknown>>;
}

export async function fetchFullWorkshopData(businessId: string): Promise<CompleteWorkshopData> {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  if (isOnline) {
    try {
      const [
        bizRes,
        clientsRes,
        ordersRes,
        paymentsRes,
        setsRes,
        apptsRes,
        expensesRes,
        garmentsRes,
        modelsRes,
      ] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", businessId).maybeSingle(),
        supabase.from("clients").select("*").eq("business_id", businessId).order("first_name", { ascending: true }),
        supabase.from("orders").select("*, clients(first_name, last_name, phone)").eq("business_id", businessId).order("ordered_at", { ascending: false }),
        supabase.from("payments").select("*"),
        supabase.from("measurement_sets").select("*, clients(first_name, last_name, phone), measurement_values(*)").eq("business_id", businessId),
        supabase.from("appointments").select("*, clients(first_name, last_name, phone)").eq("business_id", businessId),
        supabase.from("expenses").select("*").eq("business_id", businessId).order("expense_date", { ascending: false }),
        supabase.from("garment_types").select("*").eq("business_id", businessId),
        supabase.from("catalog_models").select("*").eq("business_id", businessId),
      ]);

      return {
        business: bizRes.data,
        clients: (clientsRes.data as ClientRow[]) || [],
        orders: (ordersRes.data as OrderRow[]) || [],
        payments: (paymentsRes.data as Array<Record<string, unknown>>) || [],
        measurementSets: (setsRes.data as FullMeasurementSetRow[]) || [],
        appointments: (apptsRes.data as AppointmentRow[]) || [],
        expenses: (expensesRes.data as ExpenseRow[]) || [],
        garmentTypes: (garmentsRes.data as Array<Record<string, unknown>>) || [],
        catalogModels: (modelsRes.data as Array<Record<string, unknown>>) || [],
      };
    } catch {
      // Fallback local en cas d'erreur réseau
    }
  }

  // Lecture instantanée 0ms depuis le stockage local IndexedDB
  const business = (await getLocalItem<Record<string, unknown>>("workshop_data", businessId)) || null;
  const allClients = await getAllLocalItems<ClientRow>("clients");
  const allOrders = await getAllLocalItems<OrderRow>("orders");
  const allPayments = await getAllLocalItems<Record<string, unknown>>("payments");
  const allSets = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
  const allAppts = await getAllLocalItems<AppointmentRow>("appointments");
  const allExpenses = await getAllLocalItems<ExpenseRow>("expenses");
  const allGarments = await getAllLocalItems<Record<string, unknown>>("garment_types");
  const allModels = await getAllLocalItems<Record<string, unknown>>("catalog_models");

  return {
    business,
    clients: allClients.filter((c) => c.business_id === businessId),
    orders: allOrders.filter((o) => o.business_id === businessId),
    payments: allPayments,
    measurementSets: allSets.filter((s) => s.business_id === businessId),
    appointments: allAppts.filter((a) => a.business_id === businessId),
    expenses: allExpenses.filter((e) => e.business_id === businessId),
    garmentTypes: allGarments.filter((g) => (g as Record<string, unknown>)["business_id"] === businessId),
    catalogModels: allModels.filter((m) => (m as Record<string, unknown>)["business_id"] === businessId),
  };
}

// -----------------------------------------------------------------------------
// GÉNÉRATION DES CONTENUS CSV (UTF-8 AVEC BOM EXCEL)
// -----------------------------------------------------------------------------

export function generateClientsCsvContent(clients: ClientRow[]): string {
  const headers = [
    "Nom",
    "Prénom",
    "Téléphone",
    "WhatsApp",
    "Ville",
    "Adresse_Quartier",
    "Genre",
    "Notes",
    "Date_Enregistrement",
  ];

  const rows = clients.map((c) => [
    escapeCsvField(c.last_name || ""),
    escapeCsvField(c.first_name || ""),
    escapeCsvField(c.phone || ""),
    escapeCsvField(c.whatsapp || ""),
    escapeCsvField(c.city || ""),
    escapeCsvField(c.address || ""),
    escapeCsvField(c.gender || ""),
    escapeCsvField(c.notes || ""),
    escapeCsvField(c.created_at ? c.created_at.slice(0, 10) : ""),
  ]);

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

export function generateMeasurementsCsvContent(sets: FullMeasurementSetRow[]): string {
  const headers = [
    "Client",
    "Telephone",
    "Libelle_Modele",
    "Gabarit",
    "Date_Prise_Mesures",
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
      escapeCsvField(clientName),
      escapeCsvField(clientPhone),
      escapeCsvField(s.label || ""),
      escapeCsvField(s.template_name || ""),
      escapeCsvField(s.recorded_at ? s.recorded_at.slice(0, 10) : ""),
      escapeCsvField(measuresStr),
      escapeCsvField(s.notes || ""),
    ];
  });

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

export function generateOrdersCsvContent(orders: OrderRow[]): string {
  const headers = [
    "Reference",
    "Client",
    "Habit_Modele",
    "Prix_Total",
    "Montant_Paye",
    "Reste_A_Payer",
    "Statut",
    "Date_Commande",
    "Date_Livraison_Prevue",
    "Notes",
  ];

  const rows = orders.map((o) => {
    const c = o.clients;
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "—";
    const total = Number(o.price) || 0;
    const paid = paidTotal(o);
    const rest = Math.max(0, balance(o));

    return [
      escapeCsvField(o.order_number || o.id),
      escapeCsvField(clientName),
      escapeCsvField(o.garment_type || ""),
      escapeCsvField(total),
      escapeCsvField(paid),
      escapeCsvField(rest),
      escapeCsvField(o.status || ""),
      escapeCsvField(o.ordered_at ? o.ordered_at.slice(0, 10) : ""),
      escapeCsvField(o.due_date ? o.due_date.slice(0, 10) : ""),
      escapeCsvField(o.notes || ""),
    ];
  });

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

export function generateExpensesCsvContent(expenses: ExpenseRow[]): string {
  const headers = [
    "Date",
    "Categorie",
    "Motif_Depense",
    "Montant",
    "Beneficiaire",
    "Moyen_Reglement",
    "Notes",
  ];

  const rows = expenses.map((e) => {
    const catLabel = EXPENSE_CATEGORIES[e.category]?.label || e.category;
    return [
      escapeCsvField(e.expense_date || ""),
      escapeCsvField(catLabel),
      escapeCsvField(e.title || ""),
      escapeCsvField(Number(e.amount) || 0),
      escapeCsvField(e.beneficiary_name || ""),
      escapeCsvField(e.payment_method || ""),
      escapeCsvField(e.notes || ""),
    ];
  });

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

export function generateAppointmentsCsvContent(appts: AppointmentRow[]): string {
  const headers = [
    "Client",
    "Type_Rendez_Vous",
    "Date_Prevue",
    "Heure",
    "Statut",
    "Notes",
  ];

  const rows = appts.map((a) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (a as any).clients;
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "—";
    return [
      escapeCsvField(clientName),
      escapeCsvField(a.type || ""),
      escapeCsvField(a.scheduled_date || ""),
      escapeCsvField(a.scheduled_time || ""),
      escapeCsvField(a.status || ""),
      escapeCsvField(a.notes || ""),
    ];
  });

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

// -----------------------------------------------------------------------------
// 1. EXPORT DU DOSSIER ZIP COMPLET DE L'ATELIER (TOUT EN UN)
// -----------------------------------------------------------------------------

export async function exportWorkshopFullZip(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const dateStr = new Date().toISOString().slice(0, 10);
  const zip = new SimpleZip();

  // Fichiers Excel CSV
  zip.addFile("01_Clients_Excel.csv", generateClientsCsvContent(data.clients));
  zip.addFile("02_Mesures_Excel.csv", generateMeasurementsCsvContent(data.measurementSets));
  zip.addFile("03_Commandes_Excel.csv", generateOrdersCsvContent(data.orders));
  zip.addFile("04_Charges_Depenses_Excel.csv", generateExpensesCsvContent(data.expenses));
  zip.addFile("05_Rendez_Vous_Excel.csv", generateAppointmentsCsvContent(data.appointments));

  // Sauvegarde brute JSON conforme RGPD
  const jsonArchive = {
    metadata: {
      application: "CouturPro",
      version: "2.0",
      type: "Sauvegarde Complète Atelier",
      exported_at: new Date().toISOString(),
      business_id: businessId,
      business_name: businessName,
      stats: {
        total_clients: data.clients.length,
        total_orders: data.orders.length,
        total_measurements: data.measurementSets.length,
        total_expenses: data.expenses.length,
      },
    },
    ...data,
  };
  zip.addFile("00_Sauvegarde_Integrale.json", JSON.stringify(jsonArchive, null, 2));

  // Notice explicative
  const readme = [
    `==============================================================================`,
    `COUTURPRO — DOSSIER COMPLET D'EXPORTATION D'ATELIER`,
    `==============================================================================`,
    `Atelier : ${businessName}`,
    `Date d'exportation : ${new Date().toLocaleDateString("fr-FR", { dateStyle: "full" })}`,
    `Nombre de clients : ${data.clients.length}`,
    `Nombre de commandes : ${data.orders.length}`,
    `Fiches de mesures : ${data.measurementSets.length}`,
    `Dépenses enregistrées : ${data.expenses.length}`,
    ``,
    `CONTENU DU DOSSIER :`,
    `1. 01_Clients_Excel.csv          -> Liste complète de vos clients avec téléphones et adresses`,
    `2. 02_Mesures_Excel.csv          -> Relevés détaillés de toutes les mesures clients`,
    `3. 03_Commandes_Excel.csv        -> Historique des commandes, prix, acomptes et soldes`,
    `4. 04_Charges_Depenses_Excel.csv -> Registre de toutes les sorties d'argent (salaires, loyer, mercerie)`,
    `5. 05_Rendez_Vous_Excel.csv      -> Agenda des rendez-vous clients`,
    `6. 00_Sauvegarde_Integrale.json  -> Fichier de sauvegarde informatique réutilisable`,
    ``,
    `IMPORTANT :`,
    `Ces fichiers sont compatibles avec Microsoft Excel, LibreOffice, Google Sheets,`,
    `et lisibles sur tout ordinateur ou smartphone sans logiciel spécial.`,
    `Vos données vous appartiennent définitivement.`,
    `==============================================================================`,
  ].join("\r\n");

  zip.addFile("LISEZ_MOI_ARCHIVE.txt", readme);

  const zipBlob = zip.generateBlob();
  const filename = `dossier_atelier_${sanitizeFilename(businessName)}_${dateStr}.zip`;
  downloadBlob(zipBlob, filename);

  await logAudit(businessId, "DATA_PORTABILITY_EXPORT_FULL_ZIP", {
    client_count: data.clients.length,
    order_count: data.orders.length,
  });
}

// -----------------------------------------------------------------------------
// 2. EXPORT DU RAPPORT PDF IMPRIMABLE DU GRAND LIVRE D'ATELIER
// -----------------------------------------------------------------------------

export async function exportWorkshopPdfReport(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const currency = (data.business?.currency as string) || "FCFA";
  const dateStr = new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });

  const totalCA = data.orders.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const totalEncaisse = data.orders.reduce((s, o) => s + paidTotal(o), 0);
  const totalImpayes = data.orders.reduce((s, o) => s + Math.max(0, balance(o)), 0);
  const totalDepenses = data.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const beneficeNet = totalEncaisse - totalDepenses;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Grand Livre d'Atelier — ${businessName}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      background: #fff;
      font-size: 11px;
      line-height: 1.4;
      margin: 0;
      padding: 10px;
    }
    .header {
      border-bottom: 2px solid #8B4513;
      padding-bottom: 12px;
      margin-bottom: 15px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .atelier-title {
      font-size: 22px;
      font-weight: bold;
      color: #8B4513;
      margin: 0 0 4px 0;
    }
    .atelier-subtitle {
      font-size: 12px;
      color: #666;
      margin: 0;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }
    .kpi-box {
      background: #fdfaf6;
      border: 1px solid #e8dfd5;
      border-radius: 6px;
      padding: 8px 10px;
      text-align: center;
    }
    .kpi-box .val {
      font-size: 15px;
      font-weight: bold;
      color: #8B4513;
      margin-top: 2px;
    }
    .kpi-box .lbl {
      font-size: 9px;
      text-transform: uppercase;
      color: #777;
      font-weight: 600;
    }
    .section-title {
      font-size: 13px;
      font-weight: bold;
      color: #333;
      border-bottom: 1px solid #ddd;
      padding-bottom: 4px;
      margin: 20px 0 10px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      font-size: 10px;
    }
    th {
      background: #f5ede6;
      color: #5a3825;
      font-weight: bold;
      text-align: left;
      padding: 6px 8px;
      border: 1px solid #e0d5cb;
    }
    td {
      padding: 5px 8px;
      border: 1px solid #e8e8e8;
    }
    tr:nth-child(even) td {
      background: #fafafa;
    }
    .tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: bold;
    }
    .footer {
      margin-top: 30px;
      border-top: 1px solid #ddd;
      padding-top: 10px;
      text-align: center;
      font-size: 9px;
      color: #888;
    }
    .no-print {
      margin-bottom: 15px;
      padding: 10px;
      background: #eef7ee;
      border: 1px solid #bce2be;
      border-radius: 6px;
      text-align: center;
    }
    .btn-print {
      background: #8B4513;
      color: #fff;
      border: none;
      padding: 8px 16px;
      font-size: 12px;
      font-weight: bold;
      border-radius: 6px;
      cursor: pointer;
    }
    @media print {
      .no-print { display: none; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <strong>Dossier d'Atelier Prêt pour Impression & Sauvegarde PDF</strong><br />
    <span style="font-size:11px; color:#555;">Cliquez sur le bouton ci-dessous pour enregistrer ce document au format PDF sur votre appareil.</span><br /><br />
    <button class="btn-print" onclick="window.print()">Imprimer / Enregistrer en PDF</button>
  </div>

  <div class="header">
    <div>
      <h1 class="atelier-title">${businessName}</h1>
      <p class="atelier-subtitle">Grand Livre & Registre d'Exploitation d'Atelier — CouturPro</p>
      <p style="font-size:10px; color:#666; margin:2px 0 0 0;">
        ${data.business?.address ? data.business.address + " • " : ""}${data.business?.city || ""} • Tél: ${data.business?.phone || "—"}
      </p>
    </div>
    <div style="text-align: right;">
      <span style="font-weight: bold; color: #555;">Date d'édition :</span><br />
      <span>${dateStr}</span>
    </div>
  </div>

  <!-- KPI SUMMARY -->
  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="lbl">Clients enregistrés</div>
      <div class="val">${data.clients.length}</div>
    </div>
    <div class="kpi-box">
      <div class="lbl">Commandes totales</div>
      <div class="val">${data.orders.length}</div>
    </div>
    <div class="kpi-box">
      <div class="lbl">Total Encaissé</div>
      <div class="val">${fcfa(totalEncaisse, currency)}</div>
    </div>
    <div class="kpi-box">
      <div class="lbl">Bénéfice Net Réel</div>
      <div class="val" style="color: ${beneficeNet >= 0 ? '#10b981' : '#ef4444'}">${fcfa(beneficeNet, currency)}</div>
    </div>
  </div>

  <!-- SECTION CLIENTS -->
  <div class="section-title">1. Répertoire des Clients (${data.clients.length})</div>
  <table>
    <thead>
      <tr>
        <th style="width: 25%;">Nom & Prénom</th>
        <th style="width: 20%;">Téléphone</th>
        <th style="width: 15%;">Ville / Quartier</th>
        <th style="width: 10%;">Genre</th>
        <th style="width: 30%;">Notes</th>
      </tr>
    </thead>
    <tbody>
      ${data.clients.length === 0 ? '<tr><td colspan="5" style="text-align:center;">Aucun client enregistré.</td></tr>' : data.clients.map((c) => `
        <tr>
          <td><strong>${c.first_name || ""} ${c.last_name || ""}</strong></td>
          <td>${c.phone || c.whatsapp || "—"}</td>
          <td>${c.city || c.address || "—"}</td>
          <td>${c.gender || "—"}</td>
          <td>${c.notes || "—"}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <!-- SECTION COMMANDES -->
  <div class="section-title">2. Registre des Commandes (${data.orders.length})</div>
  <table>
    <thead>
      <tr>
        <th style="width: 15%;">Réf / Date</th>
        <th style="width: 25%;">Client</th>
        <th style="width: 20%;">Modèle / Habit</th>
        <th style="width: 12%; text-align:right;">Prix</th>
        <th style="width: 12%; text-align:right;">Encaissé</th>
        <th style="width: 16%;">Statut</th>
      </tr>
    </thead>
    <tbody>
      ${data.orders.length === 0 ? '<tr><td colspan="6" style="text-align:center;">Aucune commande enregistrée.</td></tr>' : data.orders.map((o) => `
        <tr>
          <td><strong>${o.order_number || o.id.slice(0, 8)}</strong><br /><span style="font-size:9px; color:#777;">${o.ordered_at ? o.ordered_at.slice(0, 10) : ""}</span></td>
          <td>${o.clients ? o.clients.first_name + " " + o.clients.last_name : "—"}</td>
          <td>${o.garment_type || "—"}</td>
          <td style="text-align:right;">${fcfa(Number(o.price) || 0, currency)}</td>
          <td style="text-align:right; font-weight:bold;">${fcfa(paidTotal(o), currency)}</td>
          <td><span class="tag" style="background:#eef; color:#336;">${o.status}</span></td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <!-- SECTION MESURES -->
  <div class="section-title">3. Relevés du Carnet de Mesures (${data.measurementSets.length})</div>
  <table>
    <thead>
      <tr>
        <th style="width: 25%;">Client</th>
        <th style="width: 20%;">Libellé / Modèle</th>
        <th style="width: 15%;">Date relevé</th>
        <th style="width: 40%;">Mensurations clés</th>
      </tr>
    </thead>
    <tbody>
      ${data.measurementSets.length === 0 ? '<tr><td colspan="4" style="text-align:center;">Aucun relevé de mesure.</td></tr>' : data.measurementSets.slice(0, 100).map((s) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = (s as any).clients;
        const cName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "—";
        const valStr = (s.values || []).map((v) => `${v.name}: ${v.value ?? "-"}`).join(", ");
        return `
          <tr>
            <td><strong>${cName}</strong></td>
            <td>${s.label || s.template_name || "—"}</td>
            <td>${s.recorded_at ? s.recorded_at.slice(0, 10) : "—"}</td>
            <td style="font-size:9px;">${valStr || "Aucune valeur renseignée"}</td>
          </tr>
        `;
      }).join("")}
    </tbody>
  </table>

  <!-- SECTION CHARGES & COMPTABILITÉ -->
  <div class="section-title">4. Registre des Charges & Dépenses d'Atelier (${data.expenses.length})</div>
  <table>
    <thead>
      <tr>
        <th style="width: 15%;">Date</th>
        <th style="width: 25%;">Catégorie</th>
        <th style="width: 30%;">Motif de la dépense</th>
        <th style="width: 15%;">Bénéficiaire</th>
        <th style="width: 15%; text-align:right;">Montant</th>
      </tr>
    </thead>
    <tbody>
      ${data.expenses.length === 0 ? '<tr><td colspan="5" style="text-align:center;">Aucune dépense enregistrée.</td></tr>' : data.expenses.map((e) => `
        <tr>
          <td>${e.expense_date || ""}</td>
          <td><strong>${EXPENSE_CATEGORIES[e.category]?.label || e.category}</strong></td>
          <td>${e.title || "—"}</td>
          <td>${e.beneficiary_name || "—"}</td>
          <td style="text-align:right; font-weight:bold; color:#ef4444;">- ${fcfa(e.amount, currency)}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <div class="footer">
    Document officiel généré par CouturPro — Logiciel de Gestion pour Ateliers de Couture.<br />
    Toutes les données présentées ci-dessus constituent la propriété exclusive de l'atelier ${businessName}.
  </div>
</body>
</html>`;

  // Ouvrir dans un nouvel onglet ou fenêtre d'impression
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  } else {
    // Si popup bloqué, télécharger directement en document HTML imprimable
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const filename = `grand_livre_atelier_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.html`;
    downloadBlob(blob, filename);
  }

  await logAudit(businessId, "DATA_PORTABILITY_EXPORT_PDF_REPORT", {
    client_count: data.clients.length,
    order_count: data.orders.length,
  });
}

// -----------------------------------------------------------------------------
// 3. EXPORTS INDIVIDUELS EXCEL / CSV
// -----------------------------------------------------------------------------

export async function exportClientsCsv(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const csv = generateClientsCsvContent(data.clients);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `couturpro_clients_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function exportMeasurementsCsv(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const csv = generateMeasurementsCsvContent(data.measurementSets);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `couturpro_mesures_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function exportOrdersCsv(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const csv = generateOrdersCsvContent(data.orders);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `couturpro_commandes_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function exportExpensesCsv(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const csv = generateExpensesCsvContent(data.expenses);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `couturpro_charges_depenses_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function exportCompleteWorkshopJson(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const jsonArchive = {
    metadata: {
      application: "CouturPro",
      version: "2.0",
      compliance: "RGPD Art. 20 (Portabilité intégrale des données)",
      exported_at: new Date().toISOString(),
      business_id: businessId,
      business_name: businessName,
      source: typeof navigator !== "undefined" && navigator.onLine ? "Cloud_Supabase" : "PWA_Offline_IndexedDB",
      counts: {
        clients: data.clients.length,
        orders: data.orders.length,
        measurement_sets: data.measurementSets.length,
        expenses: data.expenses.length,
        appointments: data.appointments.length,
      },
    },
    ...data,
  };

  const jsonStr = JSON.stringify(jsonArchive, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `couturpro_sauvegarde_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.json`);
}

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
  downloadBlob(blob, `fiche_client_${sanitizeFilename(clientName)}_${new Date().toISOString().slice(0, 10)}.json`);
  if (businessId) {
    await logAudit(businessId, "DATA_ACCESS_EXPORT_SINGLE_CLIENT", {
      client_id: clientId,
      client_name: clientName,
    });
  }
}
