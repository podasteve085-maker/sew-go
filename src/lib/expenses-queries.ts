/**
 * CouturPro — Module de Requêtes pour la Comptabilité & Gestion des Charges
 * Fonctionnement 100% Offline-First avec synchronisation transparente vers Supabase.
 */

import { supabase } from "@/integrations/supabase/client";
import { currentBusinessId } from "@/lib/queries";
import {
  setLocalItem,
  getAllLocalItems,
  deleteLocalItem,
  addToSyncQueue,
  getPendingSyncQueue,
} from "./offline-storage";
import { syncPendingMutations } from "./sync-engine";
import type {
  ExpenseRow,
  CreateExpenseInput,
  UpdateExpenseInput,
} from "./expenses-types";

const SUPABASE_TIMEOUT_MS = 2500;

async function withTimeout<T>(promise: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("supabase_expenses_timeout")), SUPABASE_TIMEOUT_MS),
    ),
  ]);
}

/**
 * Récupère les dépenses de l'atelier, optionnellement filtrées par mois (YYYY-MM).
 * En ligne : synchronise avec Supabase et met en cache.
 * Hors-ligne : lecture instantanée 0ms depuis IndexedDB.
 */
export async function fetchExpenses(month?: string): Promise<ExpenseRow[]> {
  const businessId = await currentBusinessId();
  if (!businessId) return [];

  // 1. Si en ligne, tenter de rafraîchir depuis Supabase
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      let query = supabase
        .from("expenses")
        .select("*")
        .eq("business_id", businessId)
        .order("expense_date", { ascending: false });

      if (month) {
        // Filtre mois : du 1er au dernier jour du mois
        const [y, m] = month.split("-");
        const startDate = `${y}-${m}-01`;
        // Calcul du dernier jour
        const nextMonth = Number(m) === 12 ? 1 : Number(m) + 1;
        const nextYear = Number(m) === 12 ? Number(y) + 1 : Number(y);
        const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

        query = query.gte("expense_date", startDate).lt("expense_date", endDate);
      }

      const { data, error } = await withTimeout(query);

      if (!error && Array.isArray(data)) {
        const serverRows: ExpenseRow[] = data.map((r) => ({
          ...r,
          amount: Number(r.amount) || 0,
        }));

        // Mettre en cache localement
        const localExpenses = await getAllLocalItems<ExpenseRow>("expenses");
        const queue = await getPendingSyncQueue();
        const pendingQueueMap = new Map<string, Record<string, unknown>>();

        for (const q of queue) {
          if (q.entity === "expense" && q.action !== "delete") {
            const rowId = (q.payload["id"] as string) || q.tempId;
            if (rowId) pendingQueueMap.set(rowId, q.payload);
          }
        }

        // Fusion intelligente des données locales et serveur
        const mergedMap = new Map<string, ExpenseRow>();
        for (const s of serverRows) mergedMap.set(s.id, s);
        for (const l of localExpenses) {
          if (l.business_id === businessId && !mergedMap.has(l.id)) {
            mergedMap.set(l.id, l);
          }
        }
        for (const [rowId, payload] of pendingQueueMap.entries()) {
          const current = mergedMap.get(rowId) || ({} as ExpenseRow);
          mergedMap.set(rowId, { ...current, ...payload } as ExpenseRow);
        }

        const finalRows = Array.from(mergedMap.values());
        for (const item of serverRows) {
          await setLocalItem("expenses", item);
        }

        return sortAndFilterExpenses(finalRows, businessId, month);
      }
    } catch {
      // En cas de coupure ou timeout, basculer sans bruit sur IndexedDB
    }
  }

  // 2. Mode hors-ligne strict ou fallback immédiat (0ms)
  try {
    const localItems = await getAllLocalItems<ExpenseRow>("expenses");
    return sortAndFilterExpenses(localItems, businessId, month);
  } catch {
    return [];
  }
}

function sortAndFilterExpenses(
  items: ExpenseRow[],
  businessId: string,
  month?: string,
): ExpenseRow[] {
  let filtered = items.filter((item) => item.business_id === businessId);

  if (month) {
    filtered = filtered.filter((item) => item.expense_date.startsWith(month));
  }

  return filtered.sort((a, b) => {
    const d = b.expense_date.localeCompare(a.expense_date);
    if (d !== 0) return d;
    return b.created_at.localeCompare(a.created_at);
  });
}

/**
 * Enregistre une nouvelle dépense (0ms UI, stockage local immédiat + mise en file sync).
 */
export async function createExpense(input: CreateExpenseInput): Promise<ExpenseRow> {
  const businessId = await currentBusinessId();
  if (!businessId) {
    throw new Error("Impossible de créer une dépense : aucun atelier actif.");
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `exp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const newExpense: ExpenseRow = {
    id,
    business_id: businessId,
    category: input.category,
    title: input.title.trim(),
    amount: Math.max(0, Number(input.amount) || 0),
    expense_date: input.expense_date || today,
    beneficiary_name: input.beneficiary_name ? input.beneficiary_name.trim() : null,
    payment_method: input.payment_method || "cash",
    notes: input.notes ? input.notes.trim() : null,
    created_at: now,
    updated_at: now,
  };

  // 1. Sauvegarde locale immédiate (0ms)
  await setLocalItem("expenses", newExpense);

  // 2. Mise en file d'attente de synchronisation
  await addToSyncQueue({
    entity: "expense",
    action: "create",
    payload: newExpense as unknown as Record<string, unknown>,
  });

  // 3. Déclenchement de sync en arrière-plan si en ligne
  if (typeof navigator !== "undefined" && navigator.onLine) {
    syncPendingMutations().catch(() => {});
  }

  return newExpense;
}

/**
 * Modifie une dépense existante.
 */
export async function updateExpense(
  id: string,
  input: UpdateExpenseInput,
): Promise<ExpenseRow> {
  const localItems = await getAllLocalItems<ExpenseRow>("expenses");
  const existing = localItems.find((e) => e.id === id);

  if (!existing) {
    throw new Error("Dépense introuvable.");
  }

  const updated: ExpenseRow = {
    ...existing,
    ...(input.category ? { category: input.category } : {}),
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.amount !== undefined ? { amount: Math.max(0, Number(input.amount) || 0) } : {}),
    ...(input.expense_date ? { expense_date: input.expense_date } : {}),
    ...(input.beneficiary_name !== undefined ? { beneficiary_name: input.beneficiary_name } : {}),
    ...(input.payment_method ? { payment_method: input.payment_method } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    updated_at: new Date().toISOString(),
  };

  await setLocalItem("expenses", updated);

  await addToSyncQueue({
    entity: "expense",
    action: "update",
    payload: updated as unknown as Record<string, unknown>,
  });

  if (typeof navigator !== "undefined" && navigator.onLine) {
    syncPendingMutations().catch(() => {});
  }

  return updated;
}

/**
 * Supprime une dépense.
 */
export async function deleteExpense(id: string): Promise<void> {
  await deleteLocalItem("expenses", id);

  await addToSyncQueue({
    entity: "expense",
    action: "delete",
    payload: { id },
  });

  if (typeof navigator !== "undefined" && navigator.onLine) {
    syncPendingMutations().catch(() => {});
  }
}
