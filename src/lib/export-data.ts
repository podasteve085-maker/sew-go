/**
 * CouturPro — Moteur d'Exportation Multi-Formats, Portabilité & Sauvegarde Intégrale
 * Formats universels adaptés à TOUT type d'appareil (Smartphones Android, iPhone, Tablettes, PC) :
 * 1. Tableur (.csv) — Compatible Microsoft Excel, Google Sheets, LibreOffice avec UTF-8 BOM
 * 2. Document Imprimable (PDF / A4) — Mise en page officielle avec en-tête, bilans et bouton d'impression
 * 3. Fiche Web Autonome (.html) — Consultable hors-ligne dans n'importe quel navigateur mobile, interactif
 * 4. Fiche Texte Lisible (.txt) — Compatible bloc-notes, SMS, WhatsApp
 * 5. Dossier ZIP Complet Multi-Formats — Contient l'application web hors-ligne, les CSV, TXT, JSON et notices
 * 6. Sauvegarde Brute JSON conforme RGPD Art. 20
 */

import { supabase } from "@/integrations/supabase/client";
import { getAllLocalItems, getLocalItem } from "@/lib/offline-storage";
import {
  fetchOrders,
  fetchClients,
  fetchAllMeasurementSets,
  fetchAppointments,
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
import { PdfDocument } from "@/lib/pdf-builder";
import { fcfa } from "@/lib/format";

export type ExportFormat = "csv" | "pdf" | "html" | "txt";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
// COLLECTE UNIFIÉE DES DONNÉES ATELIER (OFFLINE-FIRST AVEC ENRICHISSEMENT EXACT)
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

async function safeGetLocalItems<T>(storeName: string): Promise<T[]> {
  try {
    return await getAllLocalItems<T>(storeName);
  } catch {
    return [];
  }
}

async function safeGetLocalItem<T>(storeName: string, id: string): Promise<T | null> {
  try {
    return await getLocalItem<T>(storeName, id);
  } catch {
    return null;
  }
}

export async function fetchFullWorkshopData(businessId: string): Promise<CompleteWorkshopData> {
  let bizData: Record<string, unknown> | null = null;
  try {
    bizData = await safeGetLocalItem<Record<string, unknown>>("workshop_data", businessId);
  } catch {
    bizData = null;
  }

  // 1. Récupération 100% sécurisée des données avec fallback local systématique
  const [clientsList, ordersList, setsList, apptsList, localExpenses] = await Promise.all([
    fetchClients().catch(async () => safeGetLocalItems<ClientRow>("clients")),
    fetchOrders().catch(async () => safeGetLocalItems<OrderRow>("orders")),
    fetchAllMeasurementSets().catch(async () => safeGetLocalItems<FullMeasurementSetRow>("measurement_sets")),
    fetchAppointments().catch(async () => safeGetLocalItems<AppointmentRow>("appointments")),
    safeGetLocalItems<ExpenseRow>("expenses"),
  ]);

  let serverExpenses: ExpenseRow[] = [];
  let businessData = bizData;

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const [bizRes, expRes] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", businessId).maybeSingle().catch(() => ({ data: null })),
        supabase.from("expenses").select("*").eq("business_id", businessId).order("expense_date", { ascending: false }).catch(() => ({ data: null })),
      ]);
      if (bizRes && bizRes.data) businessData = bizRes.data as Record<string, unknown>;
      if (expRes && expRes.data) serverExpenses = (expRes.data as ExpenseRow[]) || [];
    } catch {
      // Ignorer si échec réseau
    }
  }

  // Fusionner les dépenses (locales + serveur sans doublons)
  const expenseMap = new Map<string, ExpenseRow>();
  for (const e of [...serverExpenses, ...localExpenses]) {
    if (e && e.id && (!businessId || !e.business_id || e.business_id === businessId)) {
      expenseMap.set(e.id, e);
    }
  }
  const mergedExpenses = Array.from(expenseMap.values()).sort(
    (a, b) => (b.expense_date || "").localeCompare(a.expense_date || "")
  );

  // Filtrer pour l'atelier courant
  const workshopOrders = ordersList.filter(
    (o) => !businessId || !o.business_id || o.business_id === businessId
  );

  const workshopClients = clientsList.filter(
    (c) => !businessId || !c.business_id || c.business_id === businessId
  );

  const workshopSets = setsList.filter(
    (s) => !businessId || !s.business_id || s.business_id === businessId
  );

  const workshopAppts = apptsList.filter(
    (a) => !businessId || !a.business_id || a.business_id === businessId
  );

  // Consolider la cohérence relationnelle : enrichir commandes, mesures et RDV avec les fiches clients réelles
  const clientMap = new Map<string, ClientRow>();
  for (const c of workshopClients) {
    if (c && c.id) clientMap.set(c.id, c);
  }

  const enrichedOrders = workshopOrders.map((o) => {
    let clientObj = o.clients;
    if ((!clientObj || !clientObj.first_name) && o.client_id && clientMap.has(o.client_id)) {
      const c = clientMap.get(o.client_id)!;
      clientObj = {
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone,
        whatsapp: c.whatsapp,
      };
    }
    return {
      ...o,
      clients: clientObj,
    };
  });

  const enrichedSets = workshopSets.map((s) => {
    let clientObj = s.clients;
    if ((!clientObj || !clientObj.first_name) && s.client_id && clientMap.has(s.client_id)) {
      const c = clientMap.get(s.client_id)!;
      clientObj = {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone,
        whatsapp: c.whatsapp,
        gender: c.gender,
      };
    }
    return {
      ...s,
      clients: clientObj,
    };
  });

  const enrichedAppts = workshopAppts.map((a) => {
    let clientObj = a.clients;
    if ((!clientObj || !clientObj.first_name) && a.client_id && clientMap.has(a.client_id)) {
      const c = clientMap.get(a.client_id)!;
      clientObj = {
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone,
        whatsapp: c.whatsapp,
      };
    }
    return {
      ...a,
      clients: clientObj,
    };
  });

  return {
    business: businessData || null,
    clients: workshopClients,
    orders: enrichedOrders,
    payments: [],
    measurementSets: enrichedSets,
    appointments: enrichedAppts,
    expenses: mergedExpenses,
    garmentTypes: [],
    catalogModels: [],
  };
}

// -----------------------------------------------------------------------------
// STYLES CSS POUR LES FICHES & LE PORTAIL MOBILE HORS-LIGNE
// -----------------------------------------------------------------------------

function getCommonCss(): string {
  return `
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background: #fdfaf6;
      font-size: 13px;
      line-height: 1.5;
      margin: 0;
      padding: 16px;
    }
    .top-navigation-bar {
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      background: #8B4513;
      color: #ffffff;
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 999999;
      margin: -16px -16px 20px -16px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .btn-nav-return {
      background: #ffffff;
      color: #8B4513;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      border: none;
    }
    .btn-nav-print {
      background: #10b981;
      color: #ffffff;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .header-box {
      background: #8B4513;
      color: #ffffff;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(139, 69, 19, 0.15);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .atelier-title { font-size: 22px; font-weight: 800; margin: 0 0 4px 0; letter-spacing: -0.5px; }
    .atelier-subtitle { font-size: 12px; opacity: 0.9; margin: 0; }
    .search-box {
      width: 100%;
      padding: 12px 16px;
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      font-size: 14px;
      margin-bottom: 16px;
      background: #ffffff;
      outline: none;
      transition: border-color 0.2s;
    }
    .search-box:focus { border-color: #8B4513; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .kpi-card .val { font-size: 18px; font-weight: 800; color: #8B4513; margin-top: 2px; }
    .kpi-card .lbl { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .item-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 10px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
    }
    .badge-paid { background: #dcfce7; color: #166534; }
    .badge-unpaid { background: #fee2e2; color: #991b1b; }
    .badge-neutral { background: #f1f5f9; color: #475569; }
    .btn-contact {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      text-decoration: none;
      margin-right: 6px;
    }
    .btn-call { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .btn-wa { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
    .tab-nav {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 8px;
      margin-bottom: 16px;
      border-bottom: 2px solid #e2e8f0;
    }
    .tab-btn {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      color: #475569;
    }
    .tab-btn.active {
      background: #8B4513;
      color: #ffffff;
      border-color: #8B4513;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
    }
    th {
      background: #f5ede6;
      color: #5a3825;
      font-weight: 700;
      text-align: left;
      padding: 8px 10px;
      border-bottom: 2px solid #e2e8f0;
      font-size: 11px;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 11px;
    }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #faf8f5; }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #cbd5e1;
      color: #64748b;
      font-size: 11px;
    }
    @page { size: A4 portrait; margin: 12mm; }
    @media print {
      body { background: #ffffff !important; padding: 0 !important; }
      .no-print { display: none !important; }
      .container { max-width: 100% !important; }
      .header-box { background: #ffffff !important; color: #1e293b !important; border: 2px solid #8B4513 !important; box-shadow: none !important; }
      .atelier-title { color: #8B4513 !important; }
      .atelier-subtitle { color: #64748b !important; }
      .item-card, table { break-inside: avoid; }
      .tab-content { display: block !important; }
    }
  `;
}

function openPrintDocument(htmlContent: string, fallbackFilename: string): void {
  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  // Ouvre dans un nouvel onglet avec URL Blob réelle (évite about:blank et la perte d'historique)
  const printWindow = window.open(blobUrl, "_blank");

  if (!printWindow || printWindow.closed || typeof printWindow.closed === "undefined") {
    // Si popup bloqué par le navigateur mobile, télécharger directement le document
    downloadBlob(blob, fallbackFilename);
  }
}

// -----------------------------------------------------------------------------
// 1. GÉNÉRATEURS DE DOCUMENTS CLIENTS (CSV, PDF, WEB .HTML, TEXTE)
// -----------------------------------------------------------------------------

export function generateClientsCsvContent(clients: ClientRow[]): string {
  const headers = [
    "Nom",
    "Prenom",
    "Telephone",
    "WhatsApp",
    "Ville",
    "Adresse",
    "Genre",
    "Date_Ajout",
    "Notes",
  ];

  const rows = clients.map((c) => [
    escapeCsvField(c.last_name || ""),
    escapeCsvField(c.first_name || ""),
    escapeCsvField(c.phone || ""),
    escapeCsvField(c.whatsapp || ""),
    escapeCsvField(c.city || ""),
    escapeCsvField(c.address || ""),
    escapeCsvField(c.gender || ""),
    escapeCsvField(c.created_at ? c.created_at.slice(0, 10) : ""),
    escapeCsvField(c.notes || ""),
  ]);

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

export function generateClientsHtmlContent(clients: ClientRow[], businessName: string): string {
  const dateStr = new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Répertoire Clients — ${businessName}</title>
  <style>${getCommonCss()}</style>
</head>
<body>
  <!-- BARRE DE RETOUR FIXE -->
  <div class="no-print top-navigation-bar">
    <a href="/atelier" onclick="if(window.history.length > 1) { window.history.back(); return false; }" class="btn-nav-return">
      ⬅️ Retour à l'Atelier CouturPro
    </a>
    <button onclick="window.print()" class="btn-nav-print">
      🖨️ Enregistrer PDF / Imprimer
    </button>
  </div>

  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Répertoire Complet des Clients (${clients.length} contact${clients.length > 1 ? "s" : ""}) — Édité le ${dateStr}</p>
      </div>
    </div>

    <div class="no-print">
      <input type="text" id="searchInput" class="search-box" placeholder="🔍 Rechercher un client (nom, téléphone, quartier, notes)..." oninput="filterClients()" />
    </div>

    <div id="clientsContainer">
      ${clients.length === 0 ? '<div class="item-card" style="text-align:center; color:#64748b;">Aucun client enregistré dans cet atelier.</div>' : clients.map((c, idx) => {
        const fullName = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Client sans nom";
        const phone = c.phone || c.whatsapp || "";
        const cleanPhone = phone.replace(/[^0-9+]/g, "");
        const location = [c.city, c.address].filter(Boolean).join(" • ");

        return `
          <div class="item-card client-item" data-search="${fullName.toLowerCase()} ${phone.toLowerCase()} ${location.toLowerCase()} ${(c.notes || '').toLowerCase()}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
              <div>
                <span style="font-size:10px; font-weight:700; color:#8B4513; text-transform:uppercase;">#${idx + 1}</span>
                <h3 style="margin:2px 0 4px 0; font-size:15px; font-weight:700; color:#0f172a;">${fullName}</h3>
                <div style="color:#64748b; font-size:12px;">${location || "Aucune adresse"}</div>
              </div>
              <div class="no-print" style="margin-top:2px;">
                ${cleanPhone ? `
                  <a href="tel:${cleanPhone}" class="btn-contact btn-call">📞 Appeler</a>
                  <a href="https://wa.me/${cleanPhone.replace('+', '')}" target="_blank" class="btn-contact btn-wa">💬 WhatsApp</a>
                ` : '<span style="color:#94a3b8; font-size:11px;">Aucun téléphone</span>'}
              </div>
            </div>
            ${c.notes ? `<div style="margin-top:8px; padding-top:8px; border-top:1px dashed #e2e8f0; font-size:12px; color:#475569;"><strong>Notes :</strong> ${c.notes}</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>

    <div class="footer">
      Document généré par CouturPro — Vos données sont votre propriété exclusive.<br />
      Consultable sur tout smartphone, tablette ou ordinateur sans installer aucune application.
    </div>
  </div>

  <script>
    function filterClients() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const items = document.querySelectorAll('.client-item');
      items.forEach(el => {
        const text = el.getAttribute('data-search') || '';
        el.style.display = text.includes(q) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

export function generateClientsTxtContent(clients: ClientRow[], businessName: string): string {
  const lines = [
    "==============================================================================",
    `COUTURPRO — RÉPERTOIRE DES CLIENTS : ${businessName}`,
    `Date d'édition : ${new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })}`,
    `Total clients : ${clients.length}`,
    "==============================================================================",
    "",
  ];

  clients.forEach((c, idx) => {
    const fullName = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Client sans nom";
    lines.push(`[${idx + 1}] ${fullName}`);
    if (c.phone) lines.push(`    Téléphone : ${c.phone}`);
    if (c.whatsapp && c.whatsapp !== c.phone) lines.push(`    WhatsApp  : ${c.whatsapp}`);
    if (c.city || c.address) lines.push(`    Adresse   : ${[c.city, c.address].filter(Boolean).join(" - ")}`);
    if (c.notes) lines.push(`    Notes     : ${c.notes}`);
    lines.push("------------------------------------------------------------------------------");
  });

  return lines.join("\r\n");
}

export function generateClientsPdf(clients: ClientRow[], businessName: string): PdfDocument {
  const doc = new PdfDocument({
    title: "RÉPERTOIRE OFFICIEL DES CLIENTS",
    businessName,
  });

  const withPhone = clients.filter((c) => c.phone).length;
  const withWa = clients.filter((c) => c.whatsapp).length;
  const uniqueCities = new Set(clients.map((c) => c.city).filter(Boolean)).size;

  doc.addSummaryCards([
    { label: "Total Clients", value: String(clients.length), color: [0.1, 0.5, 0.3] },
    { label: "Numéros Téléphone", value: String(withPhone), color: [0.2, 0.4, 0.8] },
    { label: "WhatsApp Actifs", value: String(withWa), color: [0.15, 0.65, 0.4] },
    { label: "Villes / Secteurs", value: String(uniqueCities), color: [0.8, 0.5, 0.1] },
  ]);

  doc.addSectionTitle(`Fichier des Coordonnées Clients (${clients.length} fiches)`);

  const columns = [
    { header: "Nom & Prénom", width: 140, bold: true },
    { header: "Téléphone", width: 85 },
    { header: "WhatsApp", width: 85 },
    { header: "Ville / Adresse", width: 130 },
    { header: "Date d'Ajout", width: 75, align: "center" as const },
  ];

  const rows = clients.map((c) => [
    `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Sans nom",
    c.phone || "-",
    c.whatsapp || "-",
    [c.city, c.address].filter(Boolean).join(" • ") || "-",
    c.created_at ? c.created_at.slice(0, 10) : "-",
  ]);

  doc.addTable(columns, rows);
  return doc;
}

// -----------------------------------------------------------------------------
// 2. GÉNÉRATEURS DE DOCUMENTS COMMANDES (CSV, PDF, WEB .HTML, TEXTE)
// -----------------------------------------------------------------------------

export function generateOrdersCsvContent(orders: OrderRow[]): string {
  const headers = [
    "Reference",
    "Client",
    "Telephone_Client",
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
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client anonyme";
    const phone = c?.phone || c?.whatsapp || "";
    const total = Number(o.price) || 0;
    const paid = paidTotal(o);
    const rest = Math.max(0, balance(o));

    return [
      escapeCsvField(o.order_number || o.id.slice(0, 8)),
      escapeCsvField(clientName),
      escapeCsvField(phone),
      escapeCsvField(o.garment_type || "Sur-mesure"),
      escapeCsvField(total),
      escapeCsvField(paid),
      escapeCsvField(rest),
      escapeCsvField(o.status || "En cours"),
      escapeCsvField(o.ordered_at ? o.ordered_at.slice(0, 10) : ""),
      escapeCsvField(o.due_date ? o.due_date.slice(0, 10) : ""),
      escapeCsvField(o.notes || ""),
    ];
  });

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

export function generateOrdersHtmlContent(orders: OrderRow[], businessName: string, currency = "FCFA"): string {
  const dateStr = new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });
  const totalCA = orders.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const totalEncaisse = orders.reduce((s, o) => s + paidTotal(o), 0);
  const totalReste = orders.reduce((s, o) => s + Math.max(0, balance(o)), 0);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Registre des Commandes — ${businessName}</title>
  <style>${getCommonCss()}</style>
</head>
<body>
  <!-- BARRE DE RETOUR FIXE (EMPECHE TOUT BLOCAGE SUR SMARTPHONE) -->
  <div class="no-print top-navigation-bar">
    <a href="/atelier" onclick="if(window.history.length > 1) { window.history.back(); return false; }" class="btn-nav-return">
      ⬅️ Retour à l'Atelier CouturPro
    </a>
    <button onclick="window.print()" class="btn-nav-print">
      🖨️ Enregistrer PDF / Imprimer
    </button>
  </div>

  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Registre des Commandes (${orders.length} commande${orders.length > 1 ? "s" : ""}) — Édité le ${dateStr}</p>
      </div>
    </div>

    <!-- RECAPITULATIF FINANCIER REEL & EXACT -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="lbl">Total Commandes</div>
        <div class="val">${orders.length}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Total Facturé</div>
        <div class="val">${fcfa(totalCA, currency)}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Total Encaissé</div>
        <div class="val" style="color:#166534;">${fcfa(totalEncaisse, currency)}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Reste à Recouvrer</div>
        <div class="val" style="color:#991b1b;">${fcfa(totalReste, currency)}</div>
      </div>
    </div>

    <div class="no-print">
      <input type="text" id="searchInput" class="search-box" placeholder="🔍 Rechercher une commande (client, modèle, réf, statut)..." oninput="filterOrders()" />
    </div>

    <div id="ordersContainer">
      ${orders.length === 0 ? '<div class="item-card" style="text-align:center; color:#64748b;">Aucune commande enregistrée.</div>' : orders.map((o) => {
        const c = o.clients;
        const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : (o.client_id ? "Client #" + o.client_id.slice(0, 6) : "Client non spécifié");
        const phone = c?.phone || c?.whatsapp || "";
        const cleanPhone = phone.replace(/[^0-9+]/g, "");
        const price = Number(o.price) || 0;
        const paid = paidTotal(o);
        const rest = Math.max(0, balance(o));
        const ref = o.order_number || o.id.slice(0, 8);
        const isFullyPaid = rest <= 0;

        return `
          <div class="item-card order-item" data-search="${ref.toLowerCase()} ${clientName.toLowerCase()} ${(o.garment_type || '').toLowerCase()} ${(o.status || '').toLowerCase()}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
              <div>
                <span style="font-size:10px; font-weight:700; color:#8B4513; text-transform:uppercase;">Réf: ${ref}</span>
                <h3 style="margin:2px 0 2px 0; font-size:15px; font-weight:700; color:#0f172a;">${clientName}</h3>
                <div style="color:#64748b; font-size:12px;">Modèle : <strong>${o.garment_type || "Sur-mesure"}</strong></div>
              </div>
              <div style="text-align:right;">
                <span class="badge ${isFullyPaid ? 'badge-paid' : 'badge-unpaid'}">
                  ${isFullyPaid ? 'Soldé (100% payé)' : `Reste : ${fcfa(rest, currency)}`}
                </span>
                <div style="font-size:11px; color:#64748b; margin-top:4px;">Statut : <strong>${o.status || 'En cours'}</strong></div>
              </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:8px; border-top:1px dashed #e2e8f0; font-size:12px; flex-wrap:wrap; gap:6px;">
              <div>
                Prix : <strong>${fcfa(price, currency)}</strong> • Acompte payé : <strong style="color:#166534;">${fcfa(paid, currency)}</strong>
              </div>
              <div style="color:#64748b; font-size:11px;">
                Livraison : <strong>${o.due_date ? o.due_date.slice(0, 10) : "Non définie"}</strong>
              </div>
            </div>

            ${(cleanPhone || o.notes) ? `
              <div style="margin-top:8px; padding-top:6px; border-top:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                <div style="font-size:11px; color:#64748b;">${o.notes ? `<em>Notes : ${o.notes}</em>` : ""}</div>
                ${cleanPhone ? `
                  <div class="no-print">
                    <a href="tel:${cleanPhone}" class="btn-contact btn-call">📞 Appeler</a>
                    <a href="https://wa.me/${cleanPhone.replace('+', '')}" target="_blank" class="btn-contact btn-wa">💬 WhatsApp</a>
                  </div>
                ` : ""}
              </div>
            ` : ""}
          </div>
        `;
      }).join("")}
    </div>

    <div class="footer">
      Document officiel généré par CouturPro — Registre des Commandes d'Atelier.<br />
      Tous droits réservés à l'atelier ${businessName}.
    </div>
  </div>

  <script>
    function filterOrders() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const items = document.querySelectorAll('.order-item');
      items.forEach(el => {
        const text = el.getAttribute('data-search') || '';
        el.style.display = text.includes(q) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

export function generateOrdersTxtContent(orders: OrderRow[], businessName: string, currency = "FCFA"): string {
  const lines = [
    "==============================================================================",
    `COUTURPRO — REGISTRE DES COMMANDES : ${businessName}`,
    `Date d'édition : ${new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })}`,
    `Total commandes : ${orders.length}`,
    "==============================================================================",
    "",
  ];

  orders.forEach((o) => {
    const c = o.clients;
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client anonyme";
    const phone = c?.phone || c?.whatsapp || "";
    const price = Number(o.price) || 0;
    const paid = paidTotal(o);
    const rest = Math.max(0, balance(o));
    const ref = o.order_number || o.id.slice(0, 8);

    lines.push(`COMMANDE Réf: ${ref} | Client: ${clientName} ${phone ? '(' + phone + ')' : ''}`);
    lines.push(`    Modèle     : ${o.garment_type || "Sur-mesure"}`);
    lines.push(`    Prix total : ${fcfa(price, currency)} | Payé: ${fcfa(paid, currency)} | Solde restant: ${fcfa(rest, currency)}`);
    lines.push(`    Statut     : ${o.status || "En cours"} | Livraison: ${o.due_date ? o.due_date.slice(0, 10) : "Non définie"}`);
    if (o.notes) lines.push(`    Notes      : ${o.notes}`);
    lines.push("------------------------------------------------------------------------------");
  });

  return lines.join("\r\n");
}

export function generateOrdersPdf(orders: OrderRow[], businessName: string, currency = "FCFA"): PdfDocument {
  const doc = new PdfDocument({
    title: "LIVRE DES COMMANDES & ENCAISSEMENTS",
    businessName,
  });

  const totalCA = orders.reduce((sum, o) => sum + (Number(o.price) || 0), 0);
  const totalPaid = orders.reduce((sum, o) => sum + paidTotal(o), 0);
  const totalBalance = orders.reduce((sum, o) => sum + Math.max(0, balance(o)), 0);

  doc.addSummaryCards([
    { label: "Total Commandes", value: String(orders.length), color: [0.2, 0.4, 0.8] },
    { label: "Chiffre d'Affaires", value: fcfa(totalCA, currency), color: [0.1, 0.6, 0.3] },
    { label: "Total Encaissé", value: fcfa(totalPaid, currency), color: [0.1, 0.5, 0.7] },
    { label: "Solde Dû", value: fcfa(totalBalance, currency), color: [0.8, 0.2, 0.2] },
  ]);

  doc.addSectionTitle(`Registre Chronologique des Commandes (${orders.length})`);

  const columns = [
    { header: "Réf", width: 45, bold: true },
    { header: "Client", width: 110 },
    { header: "Modèle / Tenue", width: 115 },
    { header: "Statut", width: 70 },
    { header: "Prix Total", width: 60, align: "right" as const },
    { header: "Acompte", width: 55, align: "right" as const },
    { header: "Solde Dû", width: 60, align: "right" as const, bold: true, color: [0.8, 0.15, 0.15] as [number, number, number] },
  ];

  const statusLabels: Record<string, string> = {
    pending: "En attente",
    in_progress: "Confection",
    ready: "Prêt",
    delivered: "Livré",
    cancelled: "Annulé",
  };

  const rows = orders.map((o) => {
    const c = o.clients;
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client anonyme";
    const ref = o.order_number || o.id.slice(0, 8);
    const status = statusLabels[o.status] || o.status || "En cours";
    const price = Number(o.price) || 0;
    const paid = paidTotal(o);
    const rest = Math.max(0, balance(o));

    return [
      `#${ref}`,
      clientName,
      o.garment_type || "Sur-mesure",
      status,
      fcfa(price, currency),
      fcfa(paid, currency),
      rest > 0 ? fcfa(rest, currency) : "Soldé",
    ];
  });

  doc.addTable(columns, rows);
  return doc;
}

// -----------------------------------------------------------------------------
// 3. GÉNÉRATEURS DE DOCUMENTS MESURES PAR ESPACE CLIENT (CSV, PDF, WEB .HTML, TEXTE)
// -----------------------------------------------------------------------------

export interface ExtractedMeasurementValue {
  id: string;
  name: string;
  value: number | string | null;
  unit: string;
  position: number;
}

export function extractMeasurementValues(
  set: FullMeasurementSetRow | Record<string, unknown> | null | undefined
): ExtractedMeasurementValue[] {
  if (!set) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = set as any;
  const raw = s.measurement_values ?? s.values ?? s.measurementValues ?? s.measures ?? [];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item: any, idx: number) => {
      const name = String(item?.name || item?.label || "").trim();
      let val = item?.value;
      if (val === undefined || val === null || val === "" || String(val).trim() === "-") {
        val = null;
      }
      const unit = String(item?.unit || "cm").trim();
      const pos = typeof item?.position === "number" ? item.position : idx;
      return {
        id: String(item?.id || `val_${idx}`),
        name,
        value: val,
        unit,
        position: pos,
      };
    })
    .filter((m) => m.name.length > 0)
    .sort((a, b) => a.position - b.position);
}

export interface ClientMeasurementSpace {
  client: {
    id: string;
    first_name: string;
    last_name: string;
    fullName: string;
    phone: string;
    whatsapp: string;
    city: string;
    address: string;
    gender: string;
    notes: string;
    created_at?: string;
  };
  sets: Array<{
    id: string;
    label: string | null;
    template_name: string | null;
    displayName: string;
    recorded_at: string;
    notes: string | null;
    values: ExtractedMeasurementValue[];
    totalValuesCount: number;
    filledValuesCount: number;
  }>;
  totalSetsCount: number;
  totalMeasurementsCount: number;
}

export function buildClientMeasurementSpaces(
  sets: FullMeasurementSetRow[],
  clients?: ClientRow[]
): ClientMeasurementSpace[] {
  // 1. Indexer tous les clients par ID
  const clientMap = new Map<string, ClientRow>();
  if (clients && Array.isArray(clients)) {
    for (const c of clients) {
      if (c && c.id) clientMap.set(c.id, c);
    }
  }

  // 2. Grouper les fiches de mesures par client_id
  const setsByClientId = new Map<string, FullMeasurementSetRow[]>();
  for (const s of sets) {
    const cId = s.client_id || s.id;
    if (!setsByClientId.has(cId)) {
      setsByClientId.set(cId, []);
    }
    setsByClientId.get(cId)!.push(s);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sClient = (s as any).clients;
    if (sClient && !clientMap.has(cId)) {
      clientMap.set(cId, {
        id: cId,
        first_name: sClient.first_name || "",
        last_name: sClient.last_name || "",
        phone: sClient.phone || null,
        whatsapp: sClient.whatsapp || null,
        city: null,
        address: null,
        gender: sClient.gender || null,
        notes: null,
        photo_url: null,
        birth_date: null,
        created_at: s.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        business_id: s.business_id || "",
      });
    }
  }

  // 3. Construire les espaces clients
  const spaces: ClientMeasurementSpace[] = [];
  const processedClientIds = new Set<string>();

  for (const [clientId, client] of clientMap.entries()) {
    processedClientIds.add(clientId);
    const clientSets = setsByClientId.get(clientId) || [];

    const mappedSets = clientSets.map((s) => {
      const vals = extractMeasurementValues(s);
      const displayName = s.template_name || s.label || "Mesures standards";
      return {
        id: s.id,
        label: s.label,
        template_name: s.template_name,
        displayName,
        recorded_at: s.recorded_at,
        notes: s.notes,
        values: vals,
        totalValuesCount: vals.length,
        filledValuesCount: vals.filter((v) => v.value !== null).length,
      };
    });

    const totalFilled = mappedSets.reduce((sum, s) => sum + s.filledValuesCount, 0);
    const fullName = `${client.first_name || ""} ${client.last_name || ""}`.trim() || "Client sans nom";

    spaces.push({
      client: {
        id: client.id,
        first_name: client.first_name || "",
        last_name: client.last_name || "",
        fullName,
        phone: client.phone || "",
        whatsapp: client.whatsapp || "",
        city: client.city || "",
        address: client.address || "",
        gender: client.gender || "",
        notes: client.notes || "",
        created_at: client.created_at,
      },
      sets: mappedSets,
      totalSetsCount: mappedSets.length,
      totalMeasurementsCount: totalFilled,
    });
  }

  // Gabarits sans fiche client préalable
  for (const [clientId, clientSets] of setsByClientId.entries()) {
    if (processedClientIds.has(clientId)) continue;
    processedClientIds.add(clientId);

    const firstSet = clientSets[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sClient = (firstSet as any)?.clients;
    const fullName = sClient
      ? `${sClient.first_name || ""} ${sClient.last_name || ""}`.trim()
      : `Client #${clientId.slice(0, 6)}`;

    const mappedSets = clientSets.map((s) => {
      const vals = extractMeasurementValues(s);
      const displayName = s.template_name || s.label || "Mesures standards";
      return {
        id: s.id,
        label: s.label,
        template_name: s.template_name,
        displayName,
        recorded_at: s.recorded_at,
        notes: s.notes,
        values: vals,
        totalValuesCount: vals.length,
        filledValuesCount: vals.filter((v) => v.value !== null).length,
      };
    });

    const totalFilled = mappedSets.reduce((sum, s) => sum + s.filledValuesCount, 0);

    spaces.push({
      client: {
        id: clientId,
        first_name: sClient?.first_name || "",
        last_name: sClient?.last_name || "",
        fullName,
        phone: sClient?.phone || "",
        whatsapp: sClient?.whatsapp || "",
        city: "",
        address: "",
        gender: sClient?.gender || "",
        notes: "",
      },
      sets: mappedSets,
      totalSetsCount: mappedSets.length,
      totalMeasurementsCount: totalFilled,
    });
  }

  return spaces.sort((a, b) => {
    if (a.sets.length > 0 && b.sets.length === 0) return -1;
    if (a.sets.length === 0 && b.sets.length > 0) return 1;
    return a.client.fullName.localeCompare(b.client.fullName, "fr", { sensitivity: "base" });
  });
}

export function generateMeasurementsCsvContent(
  sets: FullMeasurementSetRow[],
  clients?: ClientRow[]
): string {
  const spaces = buildClientMeasurementSpaces(sets, clients);

  const headers = [
    "Client_Nom_Complet",
    "Client_Nom",
    "Client_Prenom",
    "Client_Telephone",
    "Client_WhatsApp",
    "Client_Ville",
    "Gabarit_Modele",
    "Date_Releve",
    "Toutes_Les_Mesures_Resume",
    "Nom_Mesure",
    "Valeur_Mesure",
    "Unite",
    "Notes_Gabarit",
  ];

  const rows: string[][] = [];

  for (const space of spaces) {
    const c = space.client;
    if (space.sets.length === 0) {
      rows.push([
        escapeCsvField(c.fullName),
        escapeCsvField(c.last_name),
        escapeCsvField(c.first_name),
        escapeCsvField(c.phone),
        escapeCsvField(c.whatsapp),
        escapeCsvField(c.city),
        escapeCsvField("Aucun gabarit"),
        escapeCsvField(""),
        escapeCsvField("Aucune mesure enregistrée"),
        escapeCsvField(""),
        escapeCsvField(""),
        escapeCsvField(""),
        escapeCsvField(c.notes || ""),
      ]);
    } else {
      for (const set of space.sets) {
        const resume = set.values
          .filter((v) => v.value !== null)
          .map((v) => `${v.name}: ${v.value} ${v.unit}`)
          .join(" | ") || "Aucune valeur renseignée";

        if (set.values.length === 0) {
          rows.push([
            escapeCsvField(c.fullName),
            escapeCsvField(c.last_name),
            escapeCsvField(c.first_name),
            escapeCsvField(c.phone),
            escapeCsvField(c.whatsapp),
            escapeCsvField(c.city),
            escapeCsvField(set.displayName),
            escapeCsvField(set.recorded_at ? set.recorded_at.slice(0, 10) : ""),
            escapeCsvField(resume),
            escapeCsvField(""),
            escapeCsvField(""),
            escapeCsvField(""),
            escapeCsvField(set.notes || ""),
          ]);
        } else {
          for (const v of set.values) {
            rows.push([
              escapeCsvField(c.fullName),
              escapeCsvField(c.last_name),
              escapeCsvField(c.first_name),
              escapeCsvField(c.phone),
              escapeCsvField(c.whatsapp),
              escapeCsvField(c.city),
              escapeCsvField(set.displayName),
              escapeCsvField(set.recorded_at ? set.recorded_at.slice(0, 10) : ""),
              escapeCsvField(resume),
              escapeCsvField(v.name),
              escapeCsvField(v.value !== null ? v.value : ""),
              escapeCsvField(v.unit),
              escapeCsvField(set.notes || ""),
            ]);
          }
        }
      }
    }
  }

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

export function generateMeasurementsHtmlContent(
  sets: FullMeasurementSetRow[],
  businessName: string,
  clients?: ClientRow[]
): string {
  const dateStr = new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });
  const spaces = buildClientMeasurementSpaces(sets, clients);
  const measuredCount = spaces.filter((sp) => sp.sets.length > 0).length;
  const totalMeasures = spaces.reduce((sum, sp) => sum + sp.totalMeasurementsCount, 0);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Carnet de Mesures par Client — ${businessName}</title>
  <style>${getCommonCss()}</style>
</head>
<body>
  <!-- BARRE DE RETOUR FIXE (EMPECHE TOUT BLOCAGE SUR SMARTPHONE) -->
  <div class="no-print top-navigation-bar">
    <a href="/atelier" onclick="if(window.history.length > 1) { window.history.back(); return false; }" class="btn-nav-return">
      ⬅️ Retour à l'Atelier CouturPro
    </a>
    <button onclick="window.print()" class="btn-nav-print">
      🖨️ Enregistrer PDF / Imprimer
    </button>
  </div>

  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Carnet de Mesures par Client (${spaces.length} client${spaces.length > 1 ? "s" : ""} référencé${spaces.length > 1 ? "s" : ""}) — Édité le ${dateStr}</p>
      </div>
    </div>

    <!-- SYNTHESE ATELIER REELLE & CONFORME -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="lbl">Total Clients</div>
        <div class="val">${spaces.length}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Clients Mesurés</div>
        <div class="val" style="color:#166534;">${measuredCount}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Fiches de Mesures</div>
        <div class="val" style="color:#8B4513;">${sets.length}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Mensurations Saisies</div>
        <div class="val" style="color:#2563eb;">${totalMeasures}</div>
      </div>
    </div>

    <div class="no-print">
      <input type="text" id="searchInput" class="search-box" placeholder="🔍 Rechercher un client, téléphone, modèle ou mesure (ex: poitrine, taille, 0708, Kouamé)..." oninput="filterClientCards()" />
    </div>

    <div id="clientSpacesContainer">
      ${spaces.length === 0 ? '<div class="item-card" style="text-align:center; color:#64748b;">Aucun client ni relevé de mesure dans cet atelier.</div>' : spaces.map((space) => {
        const c = space.client;
        const phone = c.phone || c.whatsapp || "";
        const cleanPhone = phone.replace(/[^0-9+]/g, "");
        const searchTokens = [
          c.fullName,
          c.phone,
          c.whatsapp,
          c.city,
          ...space.sets.map(s => `${s.displayName} ${s.notes || ""} ${s.values.map(v => `${v.name} ${v.value ?? ""}`).join(" ")}`)
        ].join(" ").toLowerCase();

        return `
          <div class="item-card client-space-card" data-search="${searchTokens}">
            <!-- EN-TETE DE L'ESPACE CLIENT -->
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
              <div>
                <span style="font-size:10px; font-weight:700; color:#8B4513; text-transform:uppercase; letter-spacing:0.5px;">Espace Client</span>
                <h3 style="margin:2px 0 2px 0; font-size:16px; font-weight:700; color:#0f172a;">${c.fullName}</h3>
                <div style="color:#64748b; font-size:12px; margin-top:2px;">
                  ${c.phone ? `<span>📞 ${c.phone}</span>` : ""}
                  ${c.whatsapp && c.whatsapp !== c.phone ? ` • <span>💬 WhatsApp : ${c.whatsapp}</span>` : ""}
                  ${c.city ? ` • <span>📍 ${c.city}</span>` : ""}
                  ${c.gender ? ` • <span>👤 ${c.gender}</span>` : ""}
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge ${space.sets.length > 0 ? 'badge-paid' : 'badge-neutral'}">
                  ${space.sets.length} gabarit${space.sets.length > 1 ? "s" : ""}
                </span>
                ${cleanPhone ? `
                  <div class="no-print">
                    <a href="tel:${cleanPhone}" class="btn-contact btn-call">📞 Appeler</a>
                    <a href="https://wa.me/${cleanPhone.replace('+', '')}" target="_blank" class="btn-contact btn-wa">💬 WhatsApp</a>
                  </div>
                ` : ""}
              </div>
            </div>

            <!-- FICHES ET MENSURATIONS DE CE CLIENT -->
            ${space.sets.length === 0 ? `
              <div style="margin-top:10px; padding:10px; text-align:center; color:#94a3b8; font-size:12px; font-style:italic;">
                Aucune fiche de mesure enregistrée pour ce client.
              </div>
            ` : space.sets.map((s, idx) => `
              <div style="margin-top:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
                  <div>
                    <span style="font-size:10px; font-weight:700; color:#475569; text-transform:uppercase;">Gabarit #${idx + 1}</span>
                    <div style="font-size:14px; font-weight:700; color:#0f172a;">${s.displayName}</div>
                  </div>
                  <div style="font-size:11px; color:#64748b;">
                    Relevé le : <strong>${s.recorded_at ? s.recorded_at.slice(0, 10) : "Non précisé"}</strong>
                  </div>
                </div>

                <!-- GRILLE COMPLETE DES MESURES REELLES -->
                ${s.values.length === 0 ? `
                  <div style="font-size:11px; color:#94a3b8; font-style:italic;">Aucune mesure renseignée pour ce gabarit.</div>
                ` : `
                  <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:6px;">
                    ${s.values.map(v => `
                      <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px;">
                        <span style="display:block; font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">${v.name}</span>
                        <strong style="display:block; font-size:13px; color:#8B4513; margin-top:2px;">${v.value !== null ? `${v.value} ${v.unit}` : '—'}</strong>
                      </div>
                    `).join("")}
                  </div>
                `}

                ${s.notes ? `
                  <div style="margin-top:8px; font-size:11px; color:#475569; background:#ffffff; border-left:3px solid #8B4513; padding:6px 10px; border-radius:0 4px 4px 0;">
                    <strong>Note de confection :</strong> ${s.notes}
                  </div>
                ` : ""}
              </div>
            `).join("")}
          </div>
        `;
      }).join("")}
    </div>

    <div class="footer">
      Document officiel généré par CouturPro — Carnet des Mesures par Client.<br />
      Tous droits réservés à l'atelier ${businessName}.
    </div>
  </div>

  <script>
    function filterClientCards() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const items = document.querySelectorAll('.client-space-card');
      items.forEach(el => {
        const text = el.getAttribute('data-search') || '';
        el.style.display = text.includes(q) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

export function generateMeasurementsTxtContent(
  sets: FullMeasurementSetRow[],
  businessName: string,
  clients?: ClientRow[]
): string {
  const spaces = buildClientMeasurementSpaces(sets, clients);
  const totalMeasures = spaces.reduce((sum, sp) => sum + sp.totalMeasurementsCount, 0);

  const lines = [
    "==============================================================================",
    `COUTURPRO — CARNET OFFICIEL DES MESURES PAR CLIENT : ${businessName}`,
    `Date d'édition : ${new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })}`,
    `Total clients : ${spaces.length} | Fiches : ${sets.length} | Mensurations enregistrées : ${totalMeasures}`,
    "==============================================================================",
    "",
  ];

  spaces.forEach((space, sIdx) => {
    const c = space.client;
    lines.push(`==============================================================================`);
    lines.push(`ESPACE CLIENT #${sIdx + 1} : ${c.fullName.toUpperCase()}`);
    if (c.phone || c.whatsapp) {
      lines.push(`  Téléphone : ${c.phone || "—"} | WhatsApp : ${c.whatsapp || "—"}`);
    }
    if (c.city || c.address) {
      lines.push(`  Localisation : ${[c.city, c.address].filter(Boolean).join(" - ")}`);
    }
    if (c.gender) {
      lines.push(`  Genre : ${c.gender}`);
    }
    lines.push(`  Fiches de mesures associées : ${space.sets.length}`);
    lines.push(`------------------------------------------------------------------------------`);

    if (space.sets.length === 0) {
      lines.push("  (Aucune fiche de mesure enregistrée pour ce client)");
    } else {
      space.sets.forEach((set, setIdx) => {
        lines.push(`  FICHE N°${setIdx + 1} : ${set.displayName} (Relevé le ${set.recorded_at ? set.recorded_at.slice(0, 10) : "—"})`);
        if (set.notes) lines.push(`  Note atelier : ${set.notes}`);
        lines.push("  Mensurations relevées :");
        if (set.values.length === 0) {
          lines.push("    - Aucune mesure renseignée");
        } else {
          set.values.forEach((v) => {
            const valStr = v.value !== null ? `${v.value} ${v.unit}` : "—";
            lines.push(`    • ${v.name.padEnd(28, " ")}: ${valStr}`);
          });
        }
        lines.push("");
      });
    }
    lines.push("");
  });

  return lines.join("\r\n");
}

export function generateMeasurementsPdf(
  sets: FullMeasurementSetRow[],
  businessName: string,
  clients?: ClientRow[]
): PdfDocument {
  const doc = new PdfDocument({
    title: "CARNET OFFICIEL DES MESURES DE L'ATELIER",
    businessName,
  });

  const spaces = buildClientMeasurementSpaces(sets, clients);
  const measuredClients = spaces.filter((sp) => sp.sets.length > 0);
  const totalMeasures = spaces.reduce((sum, sp) => sum + sp.totalMeasurementsCount, 0);

  doc.addSummaryCards([
    { label: "Clients Référencés", value: String(spaces.length), color: [0.2, 0.4, 0.8] },
    { label: "Clients Mesurés", value: String(measuredClients.length), color: [0.1, 0.6, 0.3] },
    { label: "Total Gabarits", value: String(sets.length), color: [0.85, 0.55, 0.1] },
    { label: "Mensurations Relevées", value: String(totalMeasures), color: [0.55, 0.25, 0.75] },
  ]);

  doc.addSectionTitle(`Espaces Mesures par Client (${measuredClients.length} clients avec mensurations)`);

  const measureColumns: PdfTableColumn[] = [
    { header: "Point de Mesure", width: 145, bold: true },
    { header: "Valeur (cm)", width: 100, align: "center" as const, color: [0.55, 0.25, 0.05] as [number, number, number], bold: true },
    { header: "Point de Mesure", width: 145, bold: true },
    { header: "Valeur (cm)", width: 100, align: "center" as const, color: [0.55, 0.25, 0.05] as [number, number, number], bold: true },
  ];

  for (const space of measuredClients) {
    const c = space.client;
    const contactParts = [
      c.phone ? `Tél: ${c.phone}` : null,
      c.whatsapp && c.whatsapp !== c.phone ? `WhatsApp: ${c.whatsapp}` : null,
      c.city ? `Ville: ${c.city}` : null,
      c.gender ? `Genre: ${c.gender}` : null,
      `${space.sets.length} gabarit${space.sets.length > 1 ? "s" : ""}`,
    ].filter(Boolean).join("  •  ");

    doc.addClientHeader(c.fullName, contactParts);

    for (const set of space.sets) {
      doc.ensureSpace(30);
      const setDate = set.recorded_at ? set.recorded_at.slice(0, 10) : "-";
      doc.drawText(
        `Gabarit : ${set.displayName.toUpperCase()} (Relevé le ${setDate})`,
        doc.margin + 8,
        doc.cursorY - 8,
        9,
        "bold",
        [0.2, 0.25, 0.35]
      );
      doc.cursorY -= 16;

      if (set.notes) {
        doc.ensureSpace(18);
        doc.drawText(
          `Note atelier : ${set.notes}`,
          doc.margin + 12,
          doc.cursorY - 6,
          8,
          "italic",
          [0.45, 0.5, 0.55]
        );
        doc.cursorY -= 14;
      }

      const values = set.values;
      if (values.length === 0) {
        doc.addTable(
          [
            { header: "Mensurations", width: 245 },
            { header: "État", width: 245, align: "center" as const },
          ],
          [["Relevé anatomique", "Aucune mesure renseignée"]]
        );
      } else {
        const tableRows: string[][] = [];
        for (let i = 0; i < values.length; i += 2) {
          const v1 = values[i];
          const v2 = values[i + 1];
          const val1Str = v1.value !== null ? `${v1.value} ${v1.unit}` : "—";
          const val2Str = v2 ? (v2.value !== null ? `${v2.value} ${v2.unit}` : "—") : "";
          tableRows.push([v1.name, val1Str, v2 ? v2.name : "", val2Str]);
        }
        doc.addTable(measureColumns, tableRows);
      }
      doc.cursorY -= 10;
    }
  }

  // Section des clients sans fiches de mesures
  const unmeasuredClients = spaces.filter((sp) => sp.sets.length === 0);
  if (unmeasuredClients.length > 0) {
    doc.ensureSpace(80);
    doc.addSectionTitle(`Clients en attente de prise de mesures (${unmeasuredClients.length})`);
    const unCols = [
      { header: "Client", width: 160, bold: true },
      { header: "Téléphone", width: 110 },
      { header: "WhatsApp", width: 110 },
      { header: "Ville / Quartier", width: 110 },
    ];
    const unRows = unmeasuredClients.map((sp) => [
      sp.client.fullName,
      sp.client.phone || "—",
      sp.client.whatsapp || "—",
      [sp.client.city, sp.client.address].filter(Boolean).join(" • ") || "—",
    ]);
    doc.addTable(unCols, unRows);
  }

  return doc;
}

// -----------------------------------------------------------------------------
// 4. GÉNÉRATEURS DE DOCUMENTS CHARGES & DÉPENSES (CSV, PDF, WEB .HTML, TEXTE)
// -----------------------------------------------------------------------------

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

export function generateExpensesHtmlContent(expenses: ExpenseRow[], businessName: string, currency = "FCFA"): string {
  const dateStr = new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });
  const totalDepenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Registre des Charges & Dépenses — ${businessName}</title>
  <style>${getCommonCss()}</style>
</head>
<body>
  <!-- BARRE DE RETOUR FIXE -->
  <div class="no-print top-navigation-bar">
    <a href="/atelier" onclick="if(window.history.length > 1) { window.history.back(); return false; }" class="btn-nav-return">
      ⬅️ Retour à l'Atelier CouturPro
    </a>
    <button onclick="window.print()" class="btn-nav-print">
      🖨️ Enregistrer PDF / Imprimer
    </button>
  </div>

  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Registre des Charges & Dépenses (${expenses.length} dépense${expenses.length > 1 ? "s" : ""}) — Édité le ${dateStr}</p>
      </div>
    </div>

    <!-- TOTAL DES CHARGES -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="lbl">Nombre de dépenses</div>
        <div class="val">${expenses.length}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Total des Sorties d'Argent</div>
        <div class="val" style="color:#ef4444;">- ${fcfa(totalDepenses, currency)}</div>
      </div>
    </div>

    <div class="no-print">
      <input type="text" id="searchInput" class="search-box" placeholder="🔍 Rechercher une dépense (motif, bénéficiaire, catégorie)..." oninput="filterExpenses()" />
    </div>

    <div id="expensesContainer">
      ${expenses.length === 0 ? '<div class="item-card" style="text-align:center; color:#64748b;">Aucune dépense enregistrée.</div>' : expenses.map((e) => {
        const catLabel = EXPENSE_CATEGORIES[e.category]?.label || e.category;
        const amount = Number(e.amount) || 0;

        return `
          <div class="item-card expense-item" data-search="${(e.title || '').toLowerCase()} ${catLabel.toLowerCase()} ${(e.beneficiary_name || '').toLowerCase()}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
              <div>
                <span class="badge badge-neutral">${catLabel}</span>
                <h3 style="margin:4px 0 2px 0; font-size:15px; font-weight:700; color:#0f172a;">${e.title || "Dépense d'atelier"}</h3>
                <div style="color:#64748b; font-size:12px;">
                  ${e.expense_date ? `Date : ${e.expense_date}` : ""}
                  ${e.beneficiary_name ? ` • Payé à : ${e.beneficiary_name}` : ""}
                </div>
              </div>
              <div style="text-align:right;">
                <span style="font-size:16px; font-weight:800; color:#ef4444;">- ${fcfa(amount, currency)}</span>
                ${e.payment_method ? `<div style="font-size:10px; color:#64748b; margin-top:2px;">${e.payment_method}</div>` : ""}
              </div>
            </div>
            ${e.notes ? `<div style="margin-top:6px; font-size:11px; color:#475569;"><strong>Notes :</strong> ${e.notes}</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>

    <div class="footer">
      Document généré par CouturPro — Comptabilité & Gestion des Charges d'Atelier.<br />
      Tous droits réservés à l'atelier ${businessName}.
    </div>
  </div>

  <script>
    function filterExpenses() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const items = document.querySelectorAll('.expense-item');
      items.forEach(el => {
        const text = el.getAttribute('data-search') || '';
        el.style.display = text.includes(q) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

export function generateExpensesTxtContent(expenses: ExpenseRow[], businessName: string, currency = "FCFA"): string {
  const lines = [
    "==============================================================================",
    `COUTURPRO — REGISTRE DES CHARGES & DÉPENSES : ${businessName}`,
    `Date d'édition : ${new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })}`,
    `Total dépenses : ${expenses.length}`,
    "==============================================================================",
    "",
  ];

  expenses.forEach((e) => {
    const catLabel = EXPENSE_CATEGORIES[e.category]?.label || e.category;
    lines.push(`[${e.expense_date || "—"}] ${catLabel.toUpperCase()} : ${e.title || "Dépense"}`);
    lines.push(`    Montant      : ${fcfa(e.amount, currency)}`);
    if (e.beneficiary_name) lines.push(`    Bénéficiaire : ${e.beneficiary_name}`);
    if (e.payment_method) lines.push(`    Règlement    : ${e.payment_method}`);
    if (e.notes) lines.push(`    Notes        : ${e.notes}`);
    lines.push("------------------------------------------------------------------------------");
  });

  return lines.join("\r\n");
}

export function generateExpensesPdf(expenses: ExpenseRow[], businessName: string, currency = "FCFA"): PdfDocument {
  const doc = new PdfDocument({
    title: "REGISTRE DES CHARGES & DÉPENSES",
    businessName,
  });

  const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const avg = expenses.length > 0 ? Math.round(total / expenses.length) : 0;

  doc.addSummaryCards([
    { label: "Total Dépenses", value: String(expenses.length), color: [0.2, 0.4, 0.8] },
    { label: "Total Décaissé", value: `- ${fcfa(total, currency)}`, color: [0.8, 0.2, 0.2] },
    { label: "Dépense Moyenne", value: fcfa(avg, currency), color: [0.7, 0.4, 0.1] },
  ]);

  doc.addSectionTitle(`Comptabilité Analytique des Sorties d'Argent (${expenses.length})`);

  const columns = [
    { header: "Date", width: 65, align: "center" as const },
    { header: "Catégorie", width: 95, bold: true },
    { header: "Motif / Description", width: 165 },
    { header: "Bénéficiaire", width: 95 },
    { header: "Montant", width: 95, align: "right" as const, bold: true, color: [0.8, 0.2, 0.2] as [number, number, number] },
  ];

  const rows = expenses.map((e) => {
    const catLabel = EXPENSE_CATEGORIES[e.category]?.label || e.category || "Autre";
    const amt = Number(e.amount) || 0;

    return [
      e.expense_date ? e.expense_date.slice(0, 10) : "-",
      catLabel,
      e.title || "Dépense d'atelier",
      e.beneficiary_name || "-",
      `- ${fcfa(amt, currency)}`,
    ];
  });

  doc.addTable(columns, rows);
  return doc;
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
// 5. APPLICATION WEB HORS-LIGNE AUTONOME (GRAND LIVRE & DOSSIER COMPLET)
// -----------------------------------------------------------------------------

export function generateFullWorkshopHtmlContent(data: CompleteWorkshopData, businessName: string): string {
  const currency = (data.business?.currency as string) || "FCFA";
  const dateStr = new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });

  const totalCA = data.orders.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const totalEncaisse = data.orders.reduce((s, o) => s + paidTotal(o), 0);
  const totalDepenses = data.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const beneficeNet = totalEncaisse - totalDepenses;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dossier Intégral d'Atelier — ${businessName}</title>
  <style>${getCommonCss()}</style>
</head>
<body>
  <!-- BARRE DE RETOUR FIXE -->
  <div class="no-print top-navigation-bar">
    <a href="/atelier" onclick="if(window.history.length > 1) { window.history.back(); return false; }" class="btn-nav-return">
      ⬅️ Retour à l'Atelier CouturPro
    </a>
    <button onclick="window.print()" class="btn-nav-print">
      🖨️ Enregistrer PDF / Imprimer
    </button>
  </div>

  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Grand Livre & Dossier Complet d'Atelier — CouturPro</p>
        <p style="font-size:11px; opacity:0.85; margin:3px 0 0 0;">
          ${data.business?.address ? data.business.address + " • " : ""}${data.business?.city || ""} • Tél: ${data.business?.phone || "—"}
        </p>
      </div>
    </div>

    <!-- BILAN FINANCIER GLOBAL 100% EXACT -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="lbl">Clients</div>
        <div class="val">${data.clients.length}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Commandes</div>
        <div class="val">${data.orders.length}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Chiffre d'Affaires</div>
        <div class="val">${fcfa(totalCA, currency)}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Total Encaissé</div>
        <div class="val" style="color:#166534;">${fcfa(totalEncaisse, currency)}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Total Charges</div>
        <div class="val" style="color:#ef4444;">- ${fcfa(totalDepenses, currency)}</div>
      </div>
      <div class="kpi-card">
        <div class="lbl">Bénéfice Net Réel</div>
        <div class="val" style="color:${beneficeNet >= 0 ? '#166534' : '#ef4444'}; font-size:20px;">
          ${fcfa(beneficeNet, currency)}
        </div>
      </div>
    </div>

    <!-- ONGLETS DE CONSULTATION (POUR SMARTPHONE & ORDINATEUR) -->
    <div class="tab-nav no-print">
      <button class="tab-btn active" onclick="switchTab('orders', this)">🧵 Commandes (${data.orders.length})</button>
      <button class="tab-btn" onclick="switchTab('clients', this)">👥 Clients (${data.clients.length})</button>
      <button class="tab-btn" onclick="switchTab('measures', this)">📐 Carnet de Mesures (${data.measurementSets.length})</button>
      <button class="tab-btn" onclick="switchTab('expenses', this)">💰 Charges (${data.expenses.length})</button>
    </div>

    <!-- SECTION COMMANDES -->
    <div id="tab-orders" class="tab-content">
      <div class="no-print">
        <input type="text" class="search-box" placeholder="🔍 Rechercher une commande..." oninput="filterList(this, '#list-orders .item-card')" />
      </div>
      <div id="list-orders">
        ${data.orders.map((o) => {
          const c = o.clients;
          const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : (o.client_id ? "Client #" + o.client_id.slice(0,6) : "Client non spécifié");
          const paid = paidTotal(o);
          const rest = Math.max(0, balance(o));
          return `
            <div class="item-card" data-search="${clientName.toLowerCase()} ${(o.garment_type||'').toLowerCase()} ${(o.order_number||'').toLowerCase()}">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
                <div>
                  <span style="font-size:10px; font-weight:700; color:#8B4513;">RÉF: ${o.order_number || o.id.slice(0,8)}</span>
                  <div style="font-size:14px; font-weight:700; color:#0f172a;">${clientName}</div>
                  <div style="font-size:12px; color:#64748b;">${o.garment_type || "Sur-mesure"}</div>
                </div>
                <div style="text-align:right;">
                  <span class="badge ${rest <= 0 ? 'badge-paid' : 'badge-unpaid'}">
                    ${rest <= 0 ? 'Soldé' : `Reste : ${fcfa(rest, currency)}`}
                  </span>
                  <div style="font-size:11px; color:#64748b; margin-top:4px;">Statut : ${o.status || 'En cours'}</div>
                </div>
              </div>
              <div style="margin-top:8px; padding-top:6px; border-top:1px dashed #e2e8f0; font-size:11px; display:flex; justify-content:space-between;">
                <span>Prix: ${fcfa(Number(o.price)||0, currency)} • Acompte: ${fcfa(paid, currency)}</span>
                <span>Livraison: ${o.due_date ? o.due_date.slice(0,10) : "Non définie"}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>

    <!-- SECTION CLIENTS -->
    <div id="tab-clients" class="tab-content" style="display:none;">
      <div class="no-print">
        <input type="text" class="search-box" placeholder="🔍 Rechercher un client..." oninput="filterList(this, '#list-clients .item-card')" />
      </div>
      <div id="list-clients">
        ${data.clients.map((c, i) => {
          const fullName = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Client sans nom";
          const phone = c.phone || c.whatsapp || "";
          const cleanPhone = phone.replace(/[^0-9+]/g, "");
          return `
            <div class="item-card" data-search="${fullName.toLowerCase()} ${phone}">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div>
                  <strong style="font-size:14px; color:#0f172a;">#${i+1} ${fullName}</strong>
                  <div style="color:#64748b; font-size:12px;">${[c.city, c.address].filter(Boolean).join(" • ") || "Aucune adresse"}</div>
                </div>
                <div class="no-print">
                  ${cleanPhone ? `
                    <a href="tel:${cleanPhone}" class="btn-contact btn-call">📞 Appeler</a>
                    <a href="https://wa.me/${cleanPhone.replace('+', '')}" target="_blank" class="btn-contact btn-wa">💬 WhatsApp</a>
                  ` : '<span style="color:#94a3b8; font-size:11px;">Pas de numéro</span>'}
                </div>
              </div>
              ${c.notes ? `<div style="margin-top:6px; font-size:11px; color:#475569;"><strong>Notes :</strong> ${c.notes}</div>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    </div>

    <!-- SECTION MESURES PAR ESPACE CLIENT -->
    <div id="tab-measures" class="tab-content" style="display:none;">
      <div class="no-print">
        <input type="text" class="search-box" placeholder="🔍 Rechercher un client, modèle ou mesure (ex: poitrine, tour de taille, Kouamé, 07...)..." oninput="filterList(this, '#list-measures .item-card')" />
      </div>
      <div id="list-measures">
        ${buildClientMeasurementSpaces(data.measurementSets, data.clients).map((sp) => {
          const c = sp.client;
          const searchKey = [
            c.fullName,
            c.phone,
            c.whatsapp,
            c.city,
            ...sp.sets.map(s => `${s.displayName} ${s.values.map(v => `${v.name} ${v.value ?? ""}`).join(" ")}`)
          ].join(" ").toLowerCase();

          return `
            <div class="item-card" data-search="${searchKey}">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px; border-bottom:1px solid #e2e8f0; padding-bottom:6px;">
                <div>
                  <span style="font-size:10px; font-weight:700; color:#8B4513; text-transform:uppercase;">Espace Client</span>
                  <div style="font-size:15px; font-weight:700; color:#0f172a;">${c.fullName}</div>
                  <div style="color:#64748b; font-size:11px;">
                    ${c.phone ? `<span>📞 ${c.phone}</span>` : ""}
                    ${c.whatsapp && c.whatsapp !== c.phone ? ` • <span>💬 ${c.whatsapp}</span>` : ""}
                    ${c.city ? ` • <span>📍 ${c.city}</span>` : ""}
                  </div>
                </div>
                <span class="badge ${sp.sets.length > 0 ? 'badge-paid' : 'badge-neutral'}">
                  ${sp.sets.length} gabarit${sp.sets.length > 1 ? "s" : ""}
                </span>
              </div>

              ${sp.sets.length === 0 ? `
                <div style="margin-top:8px; color:#94a3b8; font-size:11px; font-style:italic;">Aucune fiche de mesure enregistrée.</div>
              ` : sp.sets.map((s, idx) => `
                <div style="margin-top:8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px;">
                  <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; color:#0f172a;">
                    <span>📐 ${s.displayName}</span>
                    <span style="font-size:11px; font-weight:400; color:#64748b;">${s.recorded_at ? s.recorded_at.slice(0, 10) : ""}</span>
                  </div>
                  ${s.values.length === 0 ? `
                    <div style="font-size:11px; color:#94a3b8; font-style:italic; margin-top:4px;">Aucune mesure renseignée.</div>
                  ` : `
                    <div style="margin-top:6px; display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:6px;">
                      ${s.values.map(v => `
                        <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; padding:4px 8px; font-size:11px;">
                          <span style="color:#64748b; font-size:10px; display:block;">${v.name}</span>
                          <strong style="color:#8B4513;">${v.value !== null ? `${v.value} ${v.unit}` : '—'}</strong>
                        </div>
                      `).join("")}
                    </div>
                  `}
                  ${s.notes ? `<div style="margin-top:6px; font-size:11px; color:#475569;"><em>Note : ${s.notes}</em></div>` : ""}
                </div>
              `).join("")}
            </div>
          `;
        }).join("")}
      </div>
    </div>

    <!-- SECTION CHARGES -->
    <div id="tab-expenses" class="tab-content" style="display:none;">
      <div class="no-print">
        <input type="text" class="search-box" placeholder="🔍 Rechercher une dépense..." oninput="filterList(this, '#list-expenses .item-card')" />
      </div>
      <div id="list-expenses">
        ${data.expenses.map((e) => {
          const cat = EXPENSE_CATEGORIES[e.category]?.label || e.category;
          return `
            <div class="item-card" data-search="${(e.title||'').toLowerCase()} ${cat.toLowerCase()}">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <span class="badge badge-neutral">${cat}</span>
                  <div style="font-weight:700; margin-top:2px;">${e.title || "Dépense"}</div>
                  <div style="font-size:11px; color:#64748b;">${e.expense_date || ""} ${e.beneficiary_name ? "• " + e.beneficiary_name : ""}</div>
                </div>
                <div style="font-weight:800; color:#ef4444; font-size:15px;">- ${fcfa(e.amount, currency)}</div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>

    <div class="footer">
      Dossier officiel généré par CouturPro — Consultation 100% hors-ligne active.<br />
      Toutes les données ci-dessus constituent la propriété exclusive de l'atelier ${businessName}.
    </div>
  </div>

  <script>
    function switchTab(tabName, btn) {
      document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + tabName).style.display = 'block';
      if (btn) btn.classList.add('active');
    }
    function filterList(input, selector) {
      const q = input.value.toLowerCase().trim();
      document.querySelectorAll(selector).forEach(el => {
        const text = el.getAttribute('data-search') || '';
        el.style.display = text.includes(q) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

export function generateFullWorkshopPdf(data: CompleteWorkshopData, businessName: string): PdfDocument {
  const currency = (data.business?.currency as string) || "FCFA";
  const doc = new PdfDocument({
    title: "GRAND LIVRE D'ATELIER & DOSSIER COMPLET",
    businessName,
  });

  const totalCA = data.orders.reduce((sum, o) => sum + (Number(o.price) || 0), 0);
  const totalPaid = data.orders.reduce((sum, o) => sum + paidTotal(o), 0);
  const totalExpenses = data.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const netResult = totalPaid - totalExpenses;

  doc.addSummaryCards([
    { label: "Chiffre d'Affaires", value: fcfa(totalCA, currency), color: [0.1, 0.6, 0.3] },
    { label: "Encaissé Réel", value: fcfa(totalPaid, currency), color: [0.2, 0.4, 0.8] },
    { label: "Total Dépenses", value: `- ${fcfa(totalExpenses, currency)}`, color: [0.8, 0.2, 0.2] },
    {
      label: "Bénéfice Net Cash",
      value: `${netResult >= 0 ? "+" : ""}${fcfa(netResult, currency)}`,
      color: netResult >= 0 ? [0.1, 0.6, 0.3] : [0.8, 0.2, 0.2],
    },
  ]);

  // Section 1 : Commandes récentes
  doc.addSectionTitle(`1. Commandes Récentes d'Atelier (${data.orders.length} au total)`);
  const topOrders = data.orders.slice(0, 30);
  const orderColumns = [
    { header: "Réf", width: 45, bold: true },
    { header: "Client", width: 120 },
    { header: "Modèle", width: 120 },
    { header: "Statut", width: 65 },
    { header: "Prix", width: 55, align: "right" as const },
    { header: "Acompte", width: 55, align: "right" as const },
    { header: "Solde", width: 55, align: "right" as const, bold: true },
  ];
  const orderRows = topOrders.map((o) => {
    const c = o.clients;
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client";
    const ref = o.order_number || o.id.slice(0, 8);
    const rest = Math.max(0, balance(o));
    return [
      `#${ref}`,
      clientName,
      o.garment_type || "Sur-mesure",
      o.status || "En cours",
      fcfa(Number(o.price) || 0, currency),
      fcfa(paidTotal(o), currency),
      rest > 0 ? fcfa(rest, currency) : "Soldé",
    ];
  });
  doc.addTable(orderColumns, orderRows);

  // Section 2 : Dépenses récentes
  if (data.expenses.length > 0) {
    doc.startNewPage();
    doc.addSectionTitle(`2. Dernières Charges & Dépenses (${data.expenses.length} au total)`);
    const expColumns = [
      { header: "Date", width: 65, align: "center" as const },
      { header: "Catégorie", width: 95, bold: true },
      { header: "Motif", width: 165 },
      { header: "Bénéficiaire", width: 95 },
      { header: "Montant", width: 95, align: "right" as const, bold: true, color: [0.8, 0.2, 0.2] as [number, number, number] },
    ];
    const expRows = data.expenses.slice(0, 30).map((e) => [
      e.expense_date ? e.expense_date.slice(0, 10) : "-",
      EXPENSE_CATEGORIES[e.category]?.label || e.category || "Autre",
      e.title || "Dépense",
      e.beneficiary_name || "-",
      `- ${fcfa(Number(e.amount) || 0, currency)}`,
    ]);
    doc.addTable(expColumns, expRows);
  }

  // Section 3 : Clients
  if (data.clients.length > 0) {
    doc.startNewPage();
    doc.addSectionTitle(`3. Répertoire des Clients (${data.clients.length} au total)`);
    const clientColumns = [
      { header: "Nom & Prénom", width: 145, bold: true },
      { header: "Téléphone", width: 85 },
      { header: "WhatsApp", width: 85 },
      { header: "Ville / Quartier", width: 125 },
      { header: "Date Ajout", width: 75, align: "center" as const },
    ];
    const clientRows = data.clients.slice(0, 35).map((c) => [
      `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Sans nom",
      c.phone || "-",
      c.whatsapp || "-",
      [c.city, c.address].filter(Boolean).join(" • ") || "-",
      c.created_at ? c.created_at.slice(0, 10) : "-",
    ]);
    doc.addTable(clientColumns, clientRows);
  }

  // Section 4 : Mesures
  if (data.measurementSets.length > 0) {
    doc.startNewPage();
    doc.addSectionTitle(`4. Carnet de Mesures (${data.measurementSets.length} au total)`);
    const measColumns = [
      { header: "Client", width: 110, bold: true },
      { header: "Modèle", width: 95 },
      { header: "Date", width: 60, align: "center" as const },
      { header: "Mensurations Relevées", width: 250 },
    ];
    const measRows = data.measurementSets.map((s) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (s as any).clients;
      const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client";
      const values = extractMeasurementValues(s);
      const measuresStr = values
        .filter((v) => v.value !== null)
        .map((v) => `${v.name}: ${v.value} ${v.unit}`)
        .join(" • ") || "Aucune mesure saisie";
      return [
        clientName,
        s.label || s.template_name || "Modèle",
        s.recorded_at ? s.recorded_at.slice(0, 10) : "-",
        measuresStr,
      ];
    });
    doc.addTable(measColumns, measRows);
  }

  return doc;
}

// -----------------------------------------------------------------------------
// 6. EXPORT UNIVERSEL PAR CATÉGORIE ET FORMAT SOUHAITÉ
// -----------------------------------------------------------------------------

export async function exportCategoryData(
  category: "clients" | "orders" | "measurements" | "expenses",
  format: ExportFormat,
  businessId: string,
  businessName: string
): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const cleanName = sanitizeFilename(businessName);
  const dateStr = new Date().toISOString().slice(0, 10);
  const currency = (data.business?.currency as string) || "FCFA";

  let content = "";
  let filename = "";
  let mimeType = "";

  switch (category) {
    case "clients": {
      filename = `couturpro_clients_${cleanName}_${dateStr}`;
      if (format === "csv") {
        content = generateClientsCsvContent(data.clients);
        mimeType = "text/csv;charset=utf-8";
        filename += ".csv";
      } else if (format === "pdf") {
        const doc = generateClientsPdf(data.clients, businessName);
        const pdfBlob = doc.generateBlob();
        downloadBlob(pdfBlob, `${filename}.pdf`);
        await logAudit(businessId, "DATA_EXPORT_CLIENTS_PDF", { count: data.clients.length });
        return;
      } else if (format === "html") {
        content = generateClientsHtmlContent(data.clients, businessName);
        mimeType = "text/html;charset=utf-8";
        filename += ".html";
      } else if (format === "txt") {
        content = generateClientsTxtContent(data.clients, businessName);
        mimeType = "text/plain;charset=utf-8";
        filename += ".txt";
      }
      break;
    }

    case "orders": {
      filename = `couturpro_commandes_${cleanName}_${dateStr}`;
      if (format === "csv") {
        content = generateOrdersCsvContent(data.orders);
        mimeType = "text/csv;charset=utf-8";
        filename += ".csv";
      } else if (format === "pdf") {
        const doc = generateOrdersPdf(data.orders, businessName, currency);
        const pdfBlob = doc.generateBlob();
        downloadBlob(pdfBlob, `${filename}.pdf`);
        await logAudit(businessId, "DATA_EXPORT_ORDERS_PDF", { count: data.orders.length });
        return;
      } else if (format === "html") {
        content = generateOrdersHtmlContent(data.orders, businessName, currency);
        mimeType = "text/html;charset=utf-8";
        filename += ".html";
      } else if (format === "txt") {
        content = generateOrdersTxtContent(data.orders, businessName, currency);
        mimeType = "text/plain;charset=utf-8";
        filename += ".txt";
      }
      break;
    }

    case "measurements": {
      filename = `couturpro_mesures_${cleanName}_${dateStr}`;
      if (format === "csv") {
        content = generateMeasurementsCsvContent(data.measurementSets, data.clients);
        mimeType = "text/csv;charset=utf-8";
        filename += ".csv";
      } else if (format === "pdf") {
        const doc = generateMeasurementsPdf(data.measurementSets, businessName, data.clients);
        const pdfBlob = doc.generateBlob();
        downloadBlob(pdfBlob, `${filename}.pdf`);
        await logAudit(businessId, "DATA_EXPORT_MEASURES_PDF", { count: data.measurementSets.length });
        return;
      } else if (format === "html") {
        content = generateMeasurementsHtmlContent(data.measurementSets, businessName, data.clients);
        mimeType = "text/html;charset=utf-8";
        filename += ".html";
      } else if (format === "txt") {
        content = generateMeasurementsTxtContent(data.measurementSets, businessName, data.clients);
        mimeType = "text/plain;charset=utf-8";
        filename += ".txt";
      }
      break;
    }

    case "expenses": {
      filename = `couturpro_charges_depenses_${cleanName}_${dateStr}`;
      if (format === "csv") {
        content = generateExpensesCsvContent(data.expenses);
        mimeType = "text/csv;charset=utf-8";
        filename += ".csv";
      } else if (format === "pdf") {
        const doc = generateExpensesPdf(data.expenses, businessName, currency);
        const pdfBlob = doc.generateBlob();
        downloadBlob(pdfBlob, `${filename}.pdf`);
        await logAudit(businessId, "DATA_EXPORT_EXPENSES_PDF", { count: data.expenses.length });
        return;
      } else if (format === "html") {
        content = generateExpensesHtmlContent(data.expenses, businessName, currency);
        mimeType = "text/html;charset=utf-8";
        filename += ".html";
      } else if (format === "txt") {
        content = generateExpensesTxtContent(data.expenses, businessName, currency);
        mimeType = "text/plain;charset=utf-8";
        filename += ".txt";
      }
      break;
    }
  }

  if (content && filename && mimeType) {
    const blob = new Blob([content], { type: mimeType });
    downloadBlob(blob, filename);
    await logAudit(businessId, `DATA_EXPORT_${category.toUpperCase()}_${format.toUpperCase()}`, { format });
  }
}

// -----------------------------------------------------------------------------
// 7. EXPORT DU DOSSIER MULTI-FORMATS ZIP COMPLET
// -----------------------------------------------------------------------------

export async function exportWorkshopFullZip(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const zip = new SimpleZip();
  const dateStr = new Date().toISOString().slice(0, 10);
  const currency = (data.business?.currency as string) || "FCFA";

  // 1. APPLICATION WEB HORS-LIGNE AUTONOME (CONSULTABLE SANS EXCEL SUR TOUT TÉLÉPHONE)
  const fullHtml = generateFullWorkshopHtmlContent(data, businessName);
  zip.addFile("00_CONSULTER_MON_ATELIER.html", fullHtml);

  // 2. VÉRITABLES DOCUMENTS PDF STANDARDS (OUVRABLES SUR SMARTPHONE OU IMPRIMABLES DIRECTEMENT)
  zip.addFile("00_Grand_Livre_Complet.pdf", generateFullWorkshopPdf(data, businessName).generateBytes());
  zip.addFile("01_Clients_Document.pdf", generateClientsPdf(data.clients, businessName).generateBytes());
  zip.addFile("02_Mesures_Document.pdf", generateMeasurementsPdf(data.measurementSets, businessName, data.clients).generateBytes());
  zip.addFile("03_Commandes_Document.pdf", generateOrdersPdf(data.orders, businessName, currency).generateBytes());
  zip.addFile("04_Charges_Depenses_Document.pdf", generateExpensesPdf(data.expenses, businessName, currency).generateBytes());

  // 3. FICHIERS TABLEURS CSV (POUR EXCEL, SHEETS, LIBREOFFICE)
  zip.addFile("01_Clients_Excel.csv", generateClientsCsvContent(data.clients));
  zip.addFile("02_Mesures_Excel.csv", generateMeasurementsCsvContent(data.measurementSets, data.clients));
  zip.addFile("03_Commandes_Excel.csv", generateOrdersCsvContent(data.orders));
  zip.addFile("04_Charges_Depenses_Excel.csv", generateExpensesCsvContent(data.expenses));
  zip.addFile("05_Rendez_Vous_Excel.csv", generateAppointmentsCsvContent(data.appointments));

  // 4. FICHES TEXTES CLAIRES (LISIBLES SUR TOUT BLOC-NOTES)
  zip.addFile("01_Clients_Texte.txt", generateClientsTxtContent(data.clients, businessName));
  zip.addFile("02_Mesures_Texte.txt", generateMeasurementsTxtContent(data.measurementSets, businessName, data.clients));
  zip.addFile("03_Commandes_Texte.txt", generateOrdersTxtContent(data.orders, businessName, currency));
  zip.addFile("04_Charges_Depenses_Texte.txt", generateExpensesTxtContent(data.expenses, businessName, currency));

  // 5. SAUVEGARDE INFORMATIQUE BRUTE JSON (RGPD ART. 20)
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
  zip.addFile("00_Sauvegarde_Integrale.json", JSON.stringify(jsonArchive, null, 2));

  // 6. NOTICE EXPLICATIVE
  const readme = [
    "==============================================================================",
    "COUTURPRO — DOSSIER COMPLET MULTI-FORMATS D'ATELIER",
    "==============================================================================",
    `Atelier : ${businessName}`,
    `Date d'exportation : ${new Date().toLocaleDateString("fr-FR", { dateStyle: "full" })}`,
    `Nombre de clients : ${data.clients.length}`,
    `Nombre de commandes : ${data.orders.length}`,
    `Fiches de mesures : ${data.measurementSets.length}`,
    `Dépenses enregistrées : ${data.expenses.length}`,
    "",
    "COMMENT CONSULTER VOS DONNÉES SELON VOTRE APPAREIL :",
    "1. SUR N'IMPORTE QUEL SMARTPHONE OU ORDINATEUR (SANS EXCEL) :",
    "   -> Ouvrez les documents PDF : 00_Grand_Livre_Complet.pdf, 01_Clients_Document.pdf, etc.",
    "   -> Ou ouvrez '00_CONSULTER_MON_ATELIER.html' pour naviguer avec recherche interactive !",
    "",
    "2. SUR UN TABLEUR (MICROSOFT EXCEL, GOOGLE SHEETS, LIBREOFFICE) :",
    "   -> Ouvrez les fichiers 01_Clients_Excel.csv, 02_Mesures_Excel.csv, etc.",
    "",
    "3. SUR N'IMPORTE QUEL BLOC-NOTES OU TÉLÉPHONE BASIQUE :",
    "   -> Ouvrez les fichiers 01_Clients_Texte.txt, 02_Mesures_Texte.txt, etc.",
    "",
    "4. SAUVEGARDE INFORMATIQUE :",
    "   -> Le fichier 00_Sauvegarde_Integrale.json contient toutes les données brutes.",
    "==============================================================================",
  ].join("\r\n");

  zip.addFile("LISEZ_MOI_ARCHIVE.txt", readme);

  const zipBlob = zip.generateBlob();
  const filename = `dossier_complet_${sanitizeFilename(businessName)}_${dateStr}.zip`;
  downloadBlob(zipBlob, filename);

  await logAudit(businessId, "DATA_PORTABILITY_EXPORT_FULL_ZIP", {
    client_count: data.clients.length,
    order_count: data.orders.length,
  });
}

// -----------------------------------------------------------------------------
// 8. FONCTIONS RÉSERVÉES ET CONSERVÉES (RÉTROCOMPATIBILITÉ TOTALE)
// -----------------------------------------------------------------------------

export async function exportWorkshopPdfReport(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const doc = generateFullWorkshopPdf(data, businessName);
  const blob = doc.generateBlob();
  const filename = `grand_livre_atelier_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.pdf`;
  downloadBlob(blob, filename);

  await logAudit(businessId, "DATA_PORTABILITY_EXPORT_PDF_REPORT", {
    client_count: data.clients.length,
    order_count: data.orders.length,
  });
}

export async function exportWorkshopHtmlPortal(businessId: string, businessName: string): Promise<void> {
  const data = await fetchFullWorkshopData(businessId);
  const html = generateFullWorkshopHtmlContent(data, businessName);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, `portail_atelier_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.html`);
}

export async function exportClientsCsv(businessId: string, businessName: string): Promise<void> {
  return exportCategoryData("clients", "csv", businessId, businessName);
}

export async function exportMeasurementsCsv(businessId: string, businessName: string): Promise<void> {
  return exportCategoryData("measurements", "csv", businessId, businessName);
}

export async function exportOrdersCsv(businessId: string, businessName: string): Promise<void> {
  return exportCategoryData("orders", "csv", businessId, businessName);
}

export async function exportExpensesCsv(businessId: string, businessName: string): Promise<void> {
  return exportCategoryData("expenses", "csv", businessId, businessName);
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

  const blob = new Blob([JSON.stringify(jsonArchive, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `sauvegarde_atelier_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.json`);

  await logAudit(businessId, "DATA_PORTABILITY_EXPORT_JSON", {
    client_count: data.clients.length,
    order_count: data.orders.length,
  });
}

export async function exportSingleClientJson(clientId: string, clientName: string): Promise<void> {
  const [clientRes, setsRes, ordersRes] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
    supabase.from("measurement_sets").select("*, measurement_values(*)").eq("client_id", clientId),
    supabase.from("orders").select("*").eq("client_id", clientId),
  ]);

  let clientData = clientRes.data;
  let setsData = setsRes.data || [];
  let ordersData = ordersRes.data || [];

  if (!clientData) {
    const localClients = await getAllLocalItems<ClientRow>("clients");
    clientData = localClients.find((c) => c.id === clientId) || null;

    const localSets = await getAllLocalItems<FullMeasurementSetRow>("measurement_sets");
    setsData = localSets.filter((s) => s.client_id === clientId);

    const localOrders = await getAllLocalItems<OrderRow>("orders");
    ordersData = localOrders.filter((o) => o.client_id === clientId);
  }

  const exportPayload = {
    metadata: {
      application: "CouturPro",
      compliance: "RGPD Art. 20 (Droit d'accès et portabilité)",
      exported_at: new Date().toISOString(),
    },
    client: clientData,
    measurement_sets: setsData,
    orders: ordersData,
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `dossier_client_${sanitizeFilename(clientName)}_${new Date().toISOString().slice(0, 10)}.json`);
}
