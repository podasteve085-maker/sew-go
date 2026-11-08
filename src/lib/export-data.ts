/**
 * CouturPro — Moteur d'Exportation Multi-Formats, Portabilité & Sauvegarde Intégrale
 * Formats universels adaptés à TOUT type d'appareil (Smartphones Android, iPhone, Tablettes, PC) :
 * 1. Document Universel (PDF / Impression native) — S'ouvre sur 100% des smartphones sans aucune application
 * 2. Fiche Web Autonome (.html) — Consultable dans n'importe quel navigateur hors-ligne, interactif
 * 3. Tableur (.csv) — Compatible Microsoft Excel, Google Sheets, LibreOffice avec UTF-8 BOM
 * 4. Fiche Texte Lisible (.txt) — Compatible bloc-notes, SMS, WhatsApp
 * 5. Dossier ZIP Complet Multi-Formats — Contient l'application web hors-ligne, les CSV, TXT, JSON et notices
 * 6. Sauvegarde Brute JSON conforme RGPD Art. 20
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

export type ExportFormat = "pdf" | "html" | "csv" | "txt";

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

      if (!bizRes.error && !clientsRes.error && !ordersRes.error) {
        return {
          business: (bizRes.data as Record<string, unknown>) || null,
          clients: (clientsRes.data as ClientRow[]) || [],
          orders: (ordersRes.data as OrderRow[]) || [],
          payments: (paymentsRes.data as Array<Record<string, unknown>>) || [],
          measurementSets: (setsRes.data as FullMeasurementSetRow[]) || [],
          appointments: (apptsRes.data as AppointmentRow[]) || [],
          expenses: (expensesRes.data as ExpenseRow[]) || [],
          garmentTypes: (garmentsRes.data as Array<Record<string, unknown>>) || [],
          catalogModels: (modelsRes.data as Array<Record<string, unknown>>) || [],
        };
      }
    } catch {
      // Bascule silencieuse vers stockage local
    }
  }

  // Fallback 100% local (IndexedDB)
  const [biz, clients, orders, sets, appts, expenses] = await Promise.all([
    getLocalItem<Record<string, unknown>>("business", businessId),
    getAllLocalItems<ClientRow>("clients"),
    getAllLocalItems<OrderRow>("orders"),
    getAllLocalItems<FullMeasurementSetRow>("measurement_sets"),
    getAllLocalItems<AppointmentRow>("appointments"),
    getAllLocalItems<ExpenseRow>("expenses"),
  ]);

  const workshopClients = clients.filter((c) => c.business_id === businessId);
  const clientMap = new Map(workshopClients.map((c) => [c.id, c]));

  const workshopOrders = orders
    .filter((o) => o.business_id === businessId)
    .map((o) => ({
      ...o,
      clients: o.client_id ? clientMap.get(o.client_id) || null : null,
    }));

  const workshopSets = sets
    .filter((s) => s.business_id === businessId)
    .map((s) => ({
      ...s,
      clients: s.client_id ? clientMap.get(s.client_id) || null : null,
    }));

  const workshopAppts = appts
    .filter((a) => a.business_id === businessId)
    .map((a) => ({
      ...a,
      clients: a.client_id ? clientMap.get(a.client_id) || null : null,
    }));

  const workshopExpenses = expenses.filter((e) => !e.business_id || e.business_id === businessId);

  return {
    business: biz || null,
    clients: workshopClients,
    orders: workshopOrders,
    payments: [],
    measurementSets: workshopSets,
    appointments: workshopAppts,
    expenses: workshopExpenses,
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
    .btn-action {
      background: #ffffff;
      color: #8B4513;
      font-weight: 700;
      padding: 9px 16px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }
    .btn-action:hover { background: #fdfaf6; }
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
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        // Ignorer si bloqué
      }
    }, 400);
  } else {
    // Si popup bloqué sur mobile, télécharger directement le document HTML autonome
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    downloadBlob(blob, fallbackFilename);
  }
}

// -----------------------------------------------------------------------------
// 1. GÉNÉRATEURS DE DOCUMENTS CLIENTS (PDF, WEB .HTML, TEXTE, CSV)
// -----------------------------------------------------------------------------

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
  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Répertoire Complet des Clients (${clients.length} contact${clients.length > 1 ? "s" : ""}) — Édité le ${dateStr}</p>
      </div>
      <div class="no-print">
        <button class="btn-action" onclick="window.print()">🖨️ Enregistrer en PDF / Imprimer</button>
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

// -----------------------------------------------------------------------------
// 2. GÉNÉRATEURS DE DOCUMENTS COMMANDES (PDF, WEB .HTML, TEXTE, CSV)
// -----------------------------------------------------------------------------

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
  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Registre des Commandes (${orders.length} commande${orders.length > 1 ? "s" : ""}) — Édité le ${dateStr}</p>
      </div>
      <div class="no-print">
        <button class="btn-action" onclick="window.print()">🖨️ Enregistrer en PDF / Imprimer</button>
      </div>
    </div>

    <!-- RECAPITULATIF FINANCIER -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="lbl">Commandes</div>
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
        const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client non spécifié";
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
                <h3 style="margin:2px 0 4px 0; font-size:15px; font-weight:700; color:#0f172a;">${clientName}</h3>
                <div style="color:#64748b; font-size:12px;">Modèle : <strong>${o.garment_type || "Sur-mesure"}</strong></div>
              </div>
              <div style="text-align:right;">
                <span class="badge ${isFullyPaid ? 'badge-paid' : 'badge-unpaid'}">
                  ${isFullyPaid ? 'Soldé' : `Reste : ${fcfa(rest, currency)}`}
                </span>
                <div style="font-size:11px; color:#64748b; margin-top:4px;">Statut : <strong>${o.status || 'En cours'}</strong></div>
              </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:8px; border-top:1px dashed #e2e8f0; font-size:12px;">
              <div>
                Prix : <strong>${fcfa(price, currency)}</strong> • Encaissé : <strong style="color:#166534;">${fcfa(paid, currency)}</strong>
              </div>
              <div style="color:#64748b; font-size:11px;">
                Livraison : ${o.due_date ? o.due_date.slice(0, 10) : "Non définie"}
              </div>
            </div>
            ${o.notes ? `<div style="margin-top:6px; font-size:11px; color:#475569; font-style:italic;">Notes : ${o.notes}</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>

    <div class="footer">
      Document généré par CouturPro — Registre des Commandes d'Atelier.<br />
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
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client non spécifié";
    const price = Number(o.price) || 0;
    const paid = paidTotal(o);
    const rest = Math.max(0, balance(o));
    const ref = o.order_number || o.id.slice(0, 8);

    lines.push(`COMMANDE Réf: ${ref} | Client: ${clientName}`);
    lines.push(`    Modèle     : ${o.garment_type || "Sur-mesure"}`);
    lines.push(`    Prix total : ${fcfa(price, currency)} | Encaissé: ${fcfa(paid, currency)} | Reste: ${fcfa(rest, currency)}`);
    lines.push(`    Statut     : ${o.status || "En cours"} | Échéance: ${o.due_date ? o.due_date.slice(0, 10) : "Non définie"}`);
    if (o.notes) lines.push(`    Notes      : ${o.notes}`);
    lines.push("------------------------------------------------------------------------------");
  });

  return lines.join("\r\n");
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

// -----------------------------------------------------------------------------
// 3. GÉNÉRATEURS DE DOCUMENTS MESURES (PDF, WEB .HTML, TEXTE, CSV)
// -----------------------------------------------------------------------------

export function generateMeasurementsHtmlContent(sets: FullMeasurementSetRow[], businessName: string): string {
  const dateStr = new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Carnet de Mesures — ${businessName}</title>
  <style>${getCommonCss()}</style>
</head>
<body>
  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Carnet de Mesures & Gabarits (${sets.length} relevé${sets.length > 1 ? "s" : ""}) — Édité le ${dateStr}</p>
      </div>
      <div class="no-print">
        <button class="btn-action" onclick="window.print()">🖨️ Enregistrer en PDF / Imprimer</button>
      </div>
    </div>

    <div class="no-print">
      <input type="text" id="searchInput" class="search-box" placeholder="🔍 Rechercher un relevé (client, modèle, libellé)..." oninput="filterSets()" />
    </div>

    <div id="setsContainer">
      ${sets.length === 0 ? '<div class="item-card" style="text-align:center; color:#64748b;">Aucun relevé de mesure enregistré.</div>' : sets.map((s) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = (s as any).clients;
        const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client non spécifié";
        const phone = c?.phone || "";
        const label = s.label || s.template_name || "Mesures standards";
        const dateRecorded = s.recorded_at ? s.recorded_at.slice(0, 10) : "";
        const values = s.values || [];

        return `
          <div class="item-card set-item" data-search="${clientName.toLowerCase()} ${label.toLowerCase()} ${phone}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
              <div>
                <span style="font-size:10px; font-weight:700; color:#8B4513; text-transform:uppercase;">Gabarit / Modèle</span>
                <h3 style="margin:2px 0 2px 0; font-size:15px; font-weight:700; color:#0f172a;">${clientName}</h3>
                <div style="color:#64748b; font-size:12px;">${label} ${dateRecorded ? `• Relevé le ${dateRecorded}` : ""}</div>
              </div>
              ${phone ? `<div class="no-print"><a href="tel:${phone}" class="btn-contact btn-call">📞 ${phone}</a></div>` : ""}
            </div>

            <!-- VALEURS DES MESURES -->
            <div style="margin-top:10px; padding:10px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
              ${values.length === 0 ? '<span style="color:#94a3b8; font-size:11px;">Aucune mesure renseignée.</span>' : `
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:6px;">
                  ${values.map((v) => `
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:4px 8px; font-size:11px;">
                      <span style="color:#64748b; font-size:10px; display:block;">${v.name}</span>
                      <strong style="color:#8B4513; font-size:12px;">${v.value ?? "-"}</strong>
                    </div>
                  `).join("")}
                </div>
              `}
            </div>
            ${s.notes ? `<div style="margin-top:8px; font-size:11px; color:#475569;"><strong>Notes :</strong> ${s.notes}</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>

    <div class="footer">
      Document officiel généré par CouturPro — Carnet de Mesures de l'Atelier.<br />
      Tous droits réservés à l'atelier ${businessName}.
    </div>
  </div>

  <script>
    function filterSets() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const items = document.querySelectorAll('.set-item');
      items.forEach(el => {
        const text = el.getAttribute('data-search') || '';
        el.style.display = text.includes(q) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

export function generateMeasurementsTxtContent(sets: FullMeasurementSetRow[], businessName: string): string {
  const lines = [
    "==============================================================================",
    `COUTURPRO — CARNET DE MESURES : ${businessName}`,
    `Date d'édition : ${new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })}`,
    `Total gabarits : ${sets.length}`,
    "==============================================================================",
    "",
  ];

  sets.forEach((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (s as any).clients;
    const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client non spécifié";
    const label = s.label || s.template_name || "Mesures";

    lines.push(`CLIENT : ${clientName} | Modèle: ${label} | Date: ${s.recorded_at ? s.recorded_at.slice(0, 10) : "—"}`);
    if (s.values && s.values.length > 0) {
      lines.push("    Valeurs :");
      s.values.forEach((v) => {
        lines.push(`      - ${v.name.padEnd(25, " ")}: ${v.value ?? "-"}`);
      });
    }
    if (s.notes) lines.push(`    Notes : ${s.notes}`);
    lines.push("------------------------------------------------------------------------------");
  });

  return lines.join("\r\n");
}

export function generateMeasurementsCsvContent(sets: FullMeasurementSetRow[]): string {
  const headers = [
    "Client_Nom",
    "Client_Prenom",
    "Client_Telephone",
    "Libelle_Modele",
    "Gabarit_Type",
    "Date_Enregistrement",
    "Toutes_Les_Mesures",
    "Notes",
  ];

  const rows = sets.map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (s as any).clients;
    const measuresStr = (s.values || []).map((v) => `${v.name}: ${v.value ?? "-"}`).join(" | ");

    return [
      escapeCsvField(c?.last_name || ""),
      escapeCsvField(c?.first_name || ""),
      escapeCsvField(c?.phone || ""),
      escapeCsvField(s.label || ""),
      escapeCsvField(s.template_name || ""),
      escapeCsvField(s.recorded_at ? s.recorded_at.slice(0, 10) : ""),
      escapeCsvField(measuresStr),
      escapeCsvField(s.notes || ""),
    ];
  });

  return "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
}

// -----------------------------------------------------------------------------
// 4. GÉNÉRATEURS DE DOCUMENTS CHARGES & DÉPENSES (PDF, WEB .HTML, TEXTE, CSV)
// -----------------------------------------------------------------------------

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
  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Registre des Charges & Dépenses (${expenses.length} dépense${expenses.length > 1 ? "s" : ""}) — Édité le ${dateStr}</p>
      </div>
      <div class="no-print">
        <button class="btn-action" onclick="window.print()">🖨️ Enregistrer en PDF / Imprimer</button>
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
// 5. APPLICATION WEB HORS-LIGNE AUTONOME (PORTAIL MULTI-FORMATS D'ATELIER)
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
  <div class="container">
    <div class="header-box">
      <div>
        <h1 class="atelier-title">${businessName}</h1>
        <p class="atelier-subtitle">Grand Livre & Dossier Complet d'Atelier — CouturPro</p>
        <p style="font-size:11px; opacity:0.85; margin:3px 0 0 0;">
          ${data.business?.address ? data.business.address + " • " : ""}${data.business?.city || ""} • Tél: ${data.business?.phone || "—"}
        </p>
      </div>
      <div class="no-print">
        <button class="btn-action" onclick="window.print()">🖨️ Enregistrer en PDF / Imprimer</button>
      </div>
    </div>

    <!-- BILAN FINANCIER GLOBAL -->
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
      <button class="tab-btn active" onclick="switchTab('clients', this)">👥 Clients (${data.clients.length})</button>
      <button class="tab-btn" onclick="switchTab('orders', this)">🧵 Commandes (${data.orders.length})</button>
      <button class="tab-btn" onclick="switchTab('measures', this)">📐 Carnet de Mesures (${data.measurementSets.length})</button>
      <button class="tab-btn" onclick="switchTab('expenses', this)">💰 Charges (${data.expenses.length})</button>
    </div>

    <!-- SECTION CLIENTS -->
    <div id="tab-clients" class="tab-content">
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

    <!-- SECTION COMMANDES -->
    <div id="tab-orders" class="tab-content" style="display:none;">
      <div class="no-print">
        <input type="text" class="search-box" placeholder="🔍 Rechercher une commande..." oninput="filterList(this, '#list-orders .item-card')" />
      </div>
      <div id="list-orders">
        ${data.orders.map((o) => {
          const c = o.clients;
          const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client non spécifié";
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

    <!-- SECTION MESURES -->
    <div id="tab-measures" class="tab-content" style="display:none;">
      <div class="no-print">
        <input type="text" class="search-box" placeholder="🔍 Rechercher une fiche de mesure..." oninput="filterList(this, '#list-measures .item-card')" />
      </div>
      <div id="list-measures">
        ${data.measurementSets.map((s) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = (s as any).clients;
          const clientName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Client non spécifié";
          return `
            <div class="item-card" data-search="${clientName.toLowerCase()} ${(s.label||'').toLowerCase()}">
              <strong style="font-size:14px; color:#0f172a;">${clientName}</strong> — <span style="color:#64748b; font-size:12px;">${s.label || s.template_name || "Mesures"}</span>
              <div style="margin-top:8px; display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:6px;">
                ${(s.values || []).map(v => `
                  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:4px 8px; font-size:11px;">
                    <span style="color:#64748b; font-size:10px; display:block;">${v.name}</span>
                    <strong style="color:#8B4513;">${v.value ?? "-"}</strong>
                  </div>
                `).join("")}
              </div>
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
      if (format === "pdf") {
        const html = generateClientsHtmlContent(data.clients, businessName);
        openPrintDocument(html, `${filename}.html`);
        await logAudit(businessId, "DATA_EXPORT_CLIENTS_PDF", { count: data.clients.length });
        return;
      }
      if (format === "html") {
        content = generateClientsHtmlContent(data.clients, businessName);
        mimeType = "text/html;charset=utf-8";
        filename += ".html";
      } else if (format === "csv") {
        content = generateClientsCsvContent(data.clients);
        mimeType = "text/csv;charset=utf-8";
        filename += ".csv";
      } else if (format === "txt") {
        content = generateClientsTxtContent(data.clients, businessName);
        mimeType = "text/plain;charset=utf-8";
        filename += ".txt";
      }
      break;
    }

    case "orders": {
      filename = `couturpro_commandes_${cleanName}_${dateStr}`;
      if (format === "pdf") {
        const html = generateOrdersHtmlContent(data.orders, businessName, currency);
        openPrintDocument(html, `${filename}.html`);
        await logAudit(businessId, "DATA_EXPORT_ORDERS_PDF", { count: data.orders.length });
        return;
      }
      if (format === "html") {
        content = generateOrdersHtmlContent(data.orders, businessName, currency);
        mimeType = "text/html;charset=utf-8";
        filename += ".html";
      } else if (format === "csv") {
        content = generateOrdersCsvContent(data.orders);
        mimeType = "text/csv;charset=utf-8";
        filename += ".csv";
      } else if (format === "txt") {
        content = generateOrdersTxtContent(data.orders, businessName, currency);
        mimeType = "text/plain;charset=utf-8";
        filename += ".txt";
      }
      break;
    }

    case "measurements": {
      filename = `couturpro_mesures_${cleanName}_${dateStr}`;
      if (format === "pdf") {
        const html = generateMeasurementsHtmlContent(data.measurementSets, businessName);
        openPrintDocument(html, `${filename}.html`);
        await logAudit(businessId, "DATA_EXPORT_MEASURES_PDF", { count: data.measurementSets.length });
        return;
      }
      if (format === "html") {
        content = generateMeasurementsHtmlContent(data.measurementSets, businessName);
        mimeType = "text/html;charset=utf-8";
        filename += ".html";
      } else if (format === "csv") {
        content = generateMeasurementsCsvContent(data.measurementSets);
        mimeType = "text/csv;charset=utf-8";
        filename += ".csv";
      } else if (format === "txt") {
        content = generateMeasurementsTxtContent(data.measurementSets, businessName);
        mimeType = "text/plain;charset=utf-8";
        filename += ".txt";
      }
      break;
    }

    case "expenses": {
      filename = `couturpro_charges_depenses_${cleanName}_${dateStr}`;
      if (format === "pdf") {
        const html = generateExpensesHtmlContent(data.expenses, businessName, currency);
        openPrintDocument(html, `${filename}.html`);
        await logAudit(businessId, "DATA_EXPORT_EXPENSES_PDF", { count: data.expenses.length });
        return;
      }
      if (format === "html") {
        content = generateExpensesHtmlContent(data.expenses, businessName, currency);
        mimeType = "text/html;charset=utf-8";
        filename += ".html";
      } else if (format === "csv") {
        content = generateExpensesCsvContent(data.expenses);
        mimeType = "text/csv;charset=utf-8";
        filename += ".csv";
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

  // 1. APPLICATION WEB HORS-LIGNE AUTONOME (CONSULTABLE SANS EXCEL SUR TOUT TÉLÉPHONE)
  const fullHtml = generateFullWorkshopHtmlContent(data, businessName);
  zip.addFile("00_CONSULTER_MON_ATELIER.html", fullHtml);

  // 2. FICHIERS TABLEURS CSV (POUR EXCEL, SHEETS, LIBREOFFICE)
  zip.addFile("01_Clients_Excel.csv", generateClientsCsvContent(data.clients));
  zip.addFile("02_Mesures_Excel.csv", generateMeasurementsCsvContent(data.measurementSets));
  zip.addFile("03_Commandes_Excel.csv", generateOrdersCsvContent(data.orders));
  zip.addFile("04_Charges_Depenses_Excel.csv", generateExpensesCsvContent(data.expenses));
  zip.addFile("05_Rendez_Vous_Excel.csv", generateAppointmentsCsvContent(data.appointments));

  // 3. FICHES TEXTES CLAIRES (LISIBLES SUR TOUT BLOC-NOTES)
  zip.addFile("01_Clients_Texte.txt", generateClientsTxtContent(data.clients, businessName));
  zip.addFile("02_Mesures_Texte.txt", generateMeasurementsTxtContent(data.measurementSets, businessName));
  zip.addFile("03_Commandes_Texte.txt", generateOrdersTxtContent(data.orders, businessName, (data.business?.currency as string) || "FCFA"));
  zip.addFile("04_Charges_Depenses_Texte.txt", generateExpensesTxtContent(data.expenses, businessName, (data.business?.currency as string) || "FCFA"));

  // 4. SAUVEGARDE INFORMATIQUE BRUTE JSON (RGPD ART. 20)
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

  // 5. NOTICE EXPLICATIVE
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
    "   -> Double-cliquez sur '00_CONSULTER_MON_ATELIER.html'.",
    "   -> Ce fichier s'ouvre directement dans votre navigateur (Chrome, Safari, etc.)",
    "      100% hors-ligne avec recherche, filtres et bouton d'impression PDF !",
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
  const html = generateFullWorkshopHtmlContent(data, businessName);
  const filename = `grand_livre_atelier_${sanitizeFilename(businessName)}_${new Date().toISOString().slice(0, 10)}.html`;
  openPrintDocument(html, filename);

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
