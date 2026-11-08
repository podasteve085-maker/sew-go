import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  type ExpenseCategoryKey,
  type ExpenseRow,
  type CreateExpenseInput,
} from "@/lib/expenses-types";
import { createExpense, updateExpense } from "@/lib/expenses-queries";

interface ExpenseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenseToEdit?: ExpenseRow | null;
  defaultMonth?: string; // YYYY-MM
  currency?: string;
  onSuccess: () => void;
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expenseToEdit,
  defaultMonth,
  currency = "FCFA",
  onSuccess,
}: ExpenseFormDialogProps) {
  const [category, setCategory] = useState<ExpenseCategoryKey>("salaire");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (expenseToEdit) {
      setCategory(expenseToEdit.category);
      setTitle(expenseToEdit.title);
      setAmount(String(expenseToEdit.amount));
      setExpenseDate(expenseToEdit.expense_date);
      setBeneficiaryName(expenseToEdit.beneficiary_name || "");
      setPaymentMethod(expenseToEdit.payment_method || "cash");
      setNotes(expenseToEdit.notes || "");
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const initialDate = defaultMonth && !today.startsWith(defaultMonth)
        ? `${defaultMonth}-01`
        : today;
      setCategory("salaire");
      setTitle("");
      setAmount("");
      setExpenseDate(initialDate);
      setBeneficiaryName("");
      setPaymentMethod("cash");
      setNotes("");
    }
  }, [expenseToEdit, defaultMonth, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!title.trim()) {
      toast.error("Veuillez renseigner le motif de la dépense.");
      return;
    }
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Le montant doit être supérieur à zéro.");
      return;
    }

    setSaving(true);
    try {
      if (expenseToEdit) {
        await updateExpense(expenseToEdit.id, {
          category,
          title: title.trim(),
          amount: numAmount,
          expense_date: expenseDate,
          beneficiary_name: beneficiaryName.trim() || null,
          payment_method: paymentMethod,
          notes: notes.trim() || null,
        });
        toast.success("Dépense modifiée avec succès.");
      } else {
        const input: CreateExpenseInput = {
          category,
          title: title.trim(),
          amount: numAmount,
          expense_date: expenseDate,
          beneficiary_name: beneficiaryName.trim() || null,
          payment_method: paymentMethod,
          notes: notes.trim() || null,
        };
        await createExpense(input);
        toast.success("Dépense enregistrée avec succès.");
      }
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur lors de l'enregistrement";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">
            {expenseToEdit ? "Modifier la dépense" : "Enregistrer une charge / dépense"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Montant */}
          <div>
            <Label htmlFor="expense-amount" className="text-sm font-semibold">
              Montant ({currency}) *
            </Label>
            <Input
              id="expense-amount"
              type="number"
              step="any"
              min="0"
              placeholder="ex: 15000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 h-12 text-lg font-bold"
              required
              autoFocus
            />
          </div>

          {/* Catégorie */}
          <div>
            <Label htmlFor="expense-category" className="text-sm font-semibold">
              Catégorie de charge *
            </Label>
            <Select
              value={category}
              onValueChange={(val) => setCategory(val as ExpenseCategoryKey)}
            >
              <SelectTrigger id="expense-category" className="mt-1 h-11">
                <SelectValue placeholder="Choisir une catégorie" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EXPENSE_CATEGORIES) as ExpenseCategoryKey[]).map((catKey) => (
                  <SelectItem key={catKey} value={catKey}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2.5 rounded-full ${EXPENSE_CATEGORIES[catKey].dotClass}`}
                      />
                      <span>{EXPENSE_CATEGORIES[catKey].label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Motif / Titre */}
          <div>
            <Label htmlFor="expense-title" className="text-sm font-semibold">
              Motif de la dépense *
            </Label>
            <Input
              id="expense-title"
              type="text"
              placeholder="ex: Avance sur salaire, Loyer atelier, 5 zips + fil"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 h-11"
              required
            />
          </div>

          {/* Bénéficiaire (Employé, apprenti ou fournisseur) */}
          <div>
            <Label htmlFor="expense-beneficiary" className="text-sm font-medium">
              Bénéficiaire (optionnel)
            </Label>
            <Input
              id="expense-beneficiary"
              type="text"
              placeholder="ex: Moussa apprenti, Propriétaire, Mercerie Centrale"
              value={beneficiaryName}
              onChange={(e) => setBeneficiaryName(e.target.value)}
              className="mt-1"
            />
          </div>

          {/* Date & Mode de paiement */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="expense-date" className="text-sm font-medium">
                Date *
              </Label>
              <Input
                id="expense-date"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label htmlFor="expense-payment" className="text-sm font-medium">
                Moyen de règlement
              </Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="expense-payment" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(EXPENSE_PAYMENT_METHODS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes complémentaires */}
          <div>
            <Label htmlFor="expense-notes" className="text-sm font-medium">
              Notes complémentaires (optionnel)
            </Label>
            <Textarea
              id="expense-notes"
              rows={2}
              placeholder="Précisions sur la charge ou justificatif..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1"
            />
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? "Enregistrement..."
                : expenseToEdit
                ? "Sauvegarder"
                : "Valider la dépense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
