import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Receipt,
  Percent,
  Search,
  Trash2,
  Edit2,
  Share2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/bits";
import { fcfa } from "@/lib/format";
import { paidTotal, type OrderRow } from "@/lib/queries";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  type ExpenseCategoryKey,
  type ExpenseRow,
} from "@/lib/expenses-types";
import { fetchExpenses, deleteExpense } from "@/lib/expenses-queries";
import { ExpenseFormDialog } from "@/components/expense-form-dialog";

interface ExpensesManagementProps {
  orders: OrderRow[];
  month: string; // YYYY-MM
  currency?: string;
  monthLabel: string;
}

export function ExpensesManagement({
  orders,
  month,
  currency = "FCFA",
  monthLabel,
}: ExpensesManagementProps) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<ExpenseRow | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [copied, setCopied] = useState(false);

  // Requête des dépenses pour le mois sélectionné
  const { data: expenses = [], isLoading, refetch } = useQuery({
    queryKey: ["expenses", month],
    queryFn: () => fetchExpenses(month),
    staleTime: 30000,
  });

  // Calculs financiers du mois
  const financialStats = useMemo(() => {
    const inMonth = orders.filter((o) => o.ordered_at.slice(0, 7) === month);
    const caFacture = inMonth.reduce(
      (s, o) => s + (isNaN(Number(o.price)) ? 0 : Number(o.price)),
      0,
    );
    const caEncaisse = inMonth.reduce((s, o) => s + paidTotal(o), 0);
    const totalCharges = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const beneficeNet = caEncaisse - totalCharges;
    const margeNette = caEncaisse > 0 ? (beneficeNet / caEncaisse) * 100 : 0;

    // Répartition par catégorie
    const byCategory: Record<ExpenseCategoryKey, number> = {
      salaire: 0,
      loyer: 0,
      fournitures: 0,
      electricite: 0,
      maintenance: 0,
      transport: 0,
      autre: 0,
    };
    for (const exp of expenses) {
      if (byCategory[exp.category] !== undefined) {
        byCategory[exp.category] += Number(exp.amount) || 0;
      }
    }

    const categoriesList = (
      Object.keys(EXPENSE_CATEGORIES) as ExpenseCategoryKey[]
    )
      .map((catKey) => ({
        key: catKey,
        label: EXPENSE_CATEGORIES[catKey].label,
        total: byCategory[catKey],
        percent: totalCharges > 0 ? (byCategory[catKey] / totalCharges) * 100 : 0,
        badgeClass: EXPENSE_CATEGORIES[catKey].badgeClass,
        dotClass: EXPENSE_CATEGORIES[catKey].dotClass,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      caFacture,
      caEncaisse,
      totalCharges,
      beneficeNet,
      margeNette,
      categoriesList,
    };
  }, [orders, expenses, month]);

  // Données pour le graphique comparatif du mois
  const chartData = useMemo(() => {
    return [
      {
        name: monthLabel,
        "CA Facturé": financialStats.caFacture,
        "CA Encaissé (Revenus)": financialStats.caEncaisse,
        "Total des Charges": financialStats.totalCharges,
        "Bénéfice Net": Math.max(0, financialStats.beneficeNet),
      },
    ];
  }, [financialStats, monthLabel]);

  // Filtrage du journal des dépenses
  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const matchCat =
        selectedCategory === "all" || e.category === selectedCategory;
      const term = searchTerm.trim().toLowerCase();
      const matchSearch =
        !term ||
        e.title.toLowerCase().includes(term) ||
        (e.beneficiary_name && e.beneficiary_name.toLowerCase().includes(term)) ||
        (e.notes && e.notes.toLowerCase().includes(term));
      return matchCat && matchSearch;
    });
  }, [expenses, selectedCategory, searchTerm]);

  // Suppression d'une dépense
  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Confirmer la suppression de la dépense "${title}" ?`)) {
      return;
    }
    try {
      await deleteExpense(id);
      toast.success("Dépense supprimée.");
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      refetch();
    } catch {
      toast.error("Erreur lors de la suppression de la dépense.");
    }
  };

  // Partager le bilan mensuel sur WhatsApp ou presse-papiers
  const handleShareBilan = () => {
    const isBeneficiaire = financialStats.beneficeNet >= 0;
    const text = [
      `📊 *BILAN FINANCIER D'ATELIER — ${monthLabel.toUpperCase()}*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `💰 *Chiffre d'Affaires Encaissé :* ${fcfa(financialStats.caEncaisse, currency)}`,
      `💸 *Total des Charges :* ${fcfa(financialStats.totalCharges, currency)}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `${isBeneficiaire ? "✅" : "⚠️"} *BÉNÉFICE NET :* ${fcfa(financialStats.beneficeNet, currency)}`,
      `📈 *Marge Nette :* ${financialStats.margeNette.toFixed(1)}%`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `*Détail des principales charges :*`,
      ...financialStats.categoriesList
        .filter((c) => c.total > 0)
        .map(
          (c) =>
            `• ${c.label} : ${fcfa(c.total, currency)} (${c.percent.toFixed(0)}%)`,
        ),
      `━━━━━━━━━━━━━━━━━━━━`,
      `_Généré via CouturPro_`,
    ].join("\n");

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Bilan copié dans le presse-papiers ! Prêt à coller sur WhatsApp.");
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Barre d'action supérieure */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-card rounded-2xl border border-border shadow-xs">
        <div>
          <h2 className="text-base font-bold text-foreground">
            Comptabilité & Charges — {monthLabel}
          </h2>
          <p className="text-xs text-muted-foreground">
            Suivi des salaires, loyer, mercerie et calcul du bénéfice net réel de l'atelier.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleShareBilan}
            className="flex-1 sm:flex-initial gap-1.5"
            title="Copier le bilan financier pour WhatsApp"
          >
            {copied ? <Check className="size-4 text-emerald-500" /> : <Share2 className="size-4" />}
            <span>{copied ? "Copié !" : "Partager Bilan"}</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setExpenseToEdit(null);
              setDialogOpen(true);
            }}
            className="flex-1 sm:flex-initial gap-1.5 bg-primary text-primary-foreground font-semibold"
          >
            <Plus className="size-4" />
            <span>Ajouter une charge</span>
          </Button>
        </div>
      </div>

      {/* Cartes KPI Financières */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Chiffre d'Affaires Encaissé"
          value={fcfa(financialStats.caEncaisse, currency)}
        />
        <StatCard
          label="Total des Charges / Dépenses"
          value={fcfa(financialStats.totalCharges, currency)}
        />
        <div className="card-soft p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Bénéfice Net Réel
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                financialStats.beneficeNet >= 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              }`}
            >
              {financialStats.beneficeNet >= 0 ? (
                <>
                  <TrendingUp className="size-3" /> Rentable
                </>
              ) : (
                <>
                  <TrendingDown className="size-3" /> Déficit
                </>
              )}
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {fcfa(financialStats.beneficeNet, currency)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Revenus encaissés moins toutes les charges
          </p>
        </div>
        <StatCard
          label="Taux de Marge Nette"
          value={`${financialStats.margeNette.toFixed(1)} %`}
        />
      </div>

      {/* Graphique Financier Comparatif */}
      <section className="card-soft p-5">
        <h3 className="font-display text-sm font-bold">
          Comparatif Financier du Mois ({monthLabel})
        </h3>
        <p className="text-xs text-muted-foreground">
          Visualisation directe de ce qui est entré (CA Encaissé) face à ce qui est sorti (Charges).
        </p>

        <div className="mt-4 h-64 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis
                fontSize={11}
                tickFormatter={(val) => `${Math.round(val / 1000)}k`}
              />
              <Tooltip
                formatter={(val) => [fcfa(Number(val ?? 0), currency), ""]}
                contentStyle={{
                  backgroundColor: "var(--card)",
                  borderColor: "var(--border)",
                  borderRadius: "0.75rem",
                  fontSize: "0.75rem",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "0.5rem" }} />
              <Bar dataKey="CA Encaissé (Revenus)" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Total des Charges" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Bénéfice Net" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Répartition des Dépenses par Catégorie */}
      <section className="card-soft p-5">
        <h3 className="font-display text-sm font-bold">
          Ventilation des Charges de l'Atelier
        </h3>
        <p className="text-xs text-muted-foreground">
          Où est allé l'argent ce mois-ci ? Détail par poste de dépense.
        </p>

        {financialStats.totalCharges === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Aucune dépense enregistrée sur ce mois. Cliquez sur "Ajouter une charge" pour commencer.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {financialStats.categoriesList
              .filter((cat) => cat.total > 0)
              .map((cat) => (
                <div key={cat.key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${cat.dotClass}`} />
                      <span className="font-medium">{cat.label}</span>
                    </span>
                    <div className="text-right">
                      <span className="font-bold">{fcfa(cat.total, currency)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({cat.percent.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${cat.dotClass}`}
                      style={{ width: `${Math.min(100, Math.round(cat.percent))}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* Journal des Dépenses du Mois */}
      <section className="card-soft p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold">
              Journal des Dépenses ({filteredExpenses.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Historique complet des sorties de caisse et règlements du mois.
            </p>
          </div>

          {/* Recherche rapide */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher une charge..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
        </div>

        {/* Filtres par catégorie */}
        <div className="flex flex-wrap gap-1.5 pb-2 border-b border-border">
          <Button
            size="sm"
            variant={selectedCategory === "all" ? "default" : "outline"}
            onClick={() => setSelectedCategory("all")}
            className="h-8 text-xs rounded-lg"
          >
            Toutes ({expenses.length})
          </Button>
          {(Object.keys(EXPENSE_CATEGORIES) as ExpenseCategoryKey[]).map((catKey) => {
            const count = expenses.filter((e) => e.category === catKey).length;
            if (count === 0 && selectedCategory !== catKey) return null;
            return (
              <Button
                key={catKey}
                size="sm"
                variant={selectedCategory === catKey ? "default" : "outline"}
                onClick={() => setSelectedCategory(catKey)}
                className="h-8 text-xs rounded-lg gap-1.5"
              >
                <span className={`size-2 rounded-full ${EXPENSE_CATEGORIES[catKey].dotClass}`} />
                <span>
                  {EXPENSE_CATEGORIES[catKey].label} ({count})
                </span>
              </Button>
            );
          })}
        </div>

        {/* Liste des Dépenses */}
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chargement des charges...
          </p>
        ) : filteredExpenses.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <Receipt className="mx-auto size-8 text-muted-foreground opacity-50" />
            <p className="text-sm font-medium text-foreground">
              Aucune dépense trouvée
            </p>
            <p className="text-xs text-muted-foreground">
              {searchTerm || selectedCategory !== "all"
                ? "Aucun résultat ne correspond à vos filtres."
                : "Enregistrez les salaires de vos ouvriers, votre loyer ou vos achats de mercerie."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredExpenses.map((exp) => {
              const catInfo = EXPENSE_CATEGORIES[exp.category] || EXPENSE_CATEGORIES.autre;
              const paymentLabel =
                EXPENSE_PAYMENT_METHODS[exp.payment_method] || exp.payment_method;

              return (
                <div
                  key={exp.id}
                  className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-muted/30 px-2 rounded-xl transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`mt-1 size-3 rounded-full shrink-0 ${catInfo.dotClass}`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {exp.title}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium border ${catInfo.badgeClass}`}
                        >
                          {catInfo.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        <span>
                          📅 {new Date(exp.expense_date).toLocaleDateString("fr-FR")}
                        </span>
                        {exp.beneficiary_name && (
                          <span>👤 {exp.beneficiary_name}</span>
                        )}
                        <span>💳 {paymentLabel}</span>
                        {exp.notes && (
                          <span className="italic truncate max-w-xs">
                            — "{exp.notes}"
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/50">
                    <span className="text-base font-bold text-rose-600 dark:text-rose-400">
                      - {fcfa(exp.amount, currency)}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          setExpenseToEdit(exp);
                          setDialogOpen(true);
                        }}
                        title="Modifier"
                      >
                        <Edit2 className="size-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(exp.id, exp.title)}
                        title="Supprimer"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Formulaire Modal d'Ajout / Modification */}
      <ExpenseFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expenseToEdit={expenseToEdit}
        defaultMonth={month}
        currency={currency}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["expenses"] });
          refetch();
        }}
      />
    </div>
  );
}
