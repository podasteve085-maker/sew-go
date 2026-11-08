/**
 * CouturPro — Types & Constantes du Module Comptabilité & Charges d'Atelier
 */

export type ExpenseCategoryKey =
  | "salaire"
  | "loyer"
  | "fournitures"
  | "electricite"
  | "maintenance"
  | "transport"
  | "autre";

export type ExpensePaymentMethod =
  | "cash"
  | "wave"
  | "orange_money"
  | "mtn_momo"
  | "moov"
  | "bank";

export interface ExpenseRow {
  id: string;
  business_id: string;
  category: ExpenseCategoryKey;
  title: string;
  amount: number;
  expense_date: string; // Format YYYY-MM-DD
  beneficiary_name: string | null;
  payment_method: ExpensePaymentMethod | string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateExpenseInput {
  category: ExpenseCategoryKey;
  title: string;
  amount: number;
  expense_date?: string;
  beneficiary_name?: string | null;
  payment_method?: ExpensePaymentMethod | string;
  notes?: string | null;
}

export interface UpdateExpenseInput {
  category?: ExpenseCategoryKey;
  title?: string;
  amount?: number;
  expense_date?: string;
  beneficiary_name?: string | null;
  payment_method?: ExpensePaymentMethod | string;
  notes?: string | null;
}

export const EXPENSE_CATEGORIES: Record<
  ExpenseCategoryKey,
  { label: string; description: string; badgeClass: string; dotClass: string }
> = {
  salaire: {
    label: "Salaires & Avances",
    description: "Salaires des tailleurs, ouvriers et avances aux apprentis",
    badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    dotClass: "bg-blue-500",
  },
  loyer: {
    label: "Loyer & Atelier",
    description: "Loyer du local commercial, charges locatives, bail",
    badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    dotClass: "bg-purple-500",
  },
  fournitures: {
    label: "Mercerie & Fournitures",
    description: "Fils, fermetures (zips), boutons, doublures, thermocollant, craies",
    badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    dotClass: "bg-amber-500",
  },
  electricite: {
    label: "Énergie & Factures",
    description: "Électricité (fers à repasser, machines), eau, carburant groupe, wifi",
    badgeClass: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
    dotClass: "bg-yellow-500",
  },
  maintenance: {
    label: "Entretien Machines",
    description: "Révision des machines industrielles, aiguilles, huile, affûtage ciseaux",
    badgeClass: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    dotClass: "bg-orange-500",
  },
  transport: {
    label: "Transport & Courses",
    description: "Déplacements au marché de tissus, livraison de commandes",
    badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    dotClass: "bg-emerald-500",
  },
  autre: {
    label: "Divers & Imprévus",
    description: "Pause thé, nourriture atelier, pharmacie, petites réparations diverses",
    badgeClass: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
    dotClass: "bg-slate-500",
  },
};

export const EXPENSE_PAYMENT_METHODS: Record<string, string> = {
  cash: "Espèces (Caisse)",
  wave: "Wave",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  moov: "Moov Money",
  bank: "Virement bancaire",
};
