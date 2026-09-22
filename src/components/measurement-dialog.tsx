import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { fetchTemplates, fetchClients, type MeasurementSetRow } from "@/lib/queries";
import { today, fullName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function MeasurementDialog({
  open,
  onOpenChange,
  businessId,
  clientId: initialClientId,
  initialSet,
  mode = "create",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: string;
  clientId?: string;
  initialSet?: MeasurementSetRow | null;
  mode?: "create" | "edit" | "copy";
  onSaved?: (setId: string) => void;
}) {
  const clients = useQuery({
    queryKey: ["clients", ""],
    queryFn: () => fetchClients(),
    enabled: Boolean(open),
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => fetchTemplates(),
    enabled: Boolean(open),
  });

  const queryClient = useQueryClient();
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId ?? "");
  const [templateName, setTemplateName] = useState("");
  const [fields, setFields] = useState<{ name: string; value: string }[]>([]);
  const [extraName, setExtraName] = useState("");
  const [notes, setNotes] = useState("");
  const [recordedAt, setRecordedAt] = useState(today());

  useEffect(() => {
    if (!open) return;
    setSelectedClientId(initialClientId ?? (initialSet?.client_id ?? ""));

    if (initialSet && (mode === "edit" || mode === "copy")) {
      setTemplateName(initialSet.template_name ?? "");
      setRecordedAt(mode === "edit" ? initialSet.recorded_at : today());
      setNotes(initialSet.notes ?? "");
      const existing = (initialSet.measurement_values ?? [])
        .sort((a, b) => a.position - b.position)
        .map((v) => ({
          name: v.name,
          value: v.value !== null ? String(v.value) : "",
        }));
      setFields(existing);
    } else {
      setTemplateName("");
      setFields([]);
      setNotes("");
      setRecordedAt(today());
    }
  }, [open, initialClientId, initialSet, mode]);

  function pickTemplate(name: string) {
    setTemplateName(name);
    const tpl = templates.data?.find((t) => t.name === name);
    setFields((tpl?.fields ?? []).map((f) => ({ name: f, value: "" })));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!businessId) throw new Error("Atelier non identifié");
      const activeClientId = selectedClientId || initialClientId;
      if (!activeClientId) {
        throw new Error("Veuillez sélectionner un client.");
      }

      let targetSetId = initialSet?.id;

      if (mode === "edit" && targetSetId) {
        const { error: setErr } = await supabase
          .from("measurement_sets")
          .update({
            template_name: templateName || null,
            label: templateName || "Relevé",
            notes: notes || null,
            recorded_at: recordedAt,
          })
          .eq("id", targetSetId)
          .eq("business_id", businessId);
        if (setErr) throw setErr;

        const { error: delErr } = await supabase
          .from("measurement_values")
          .delete()
          .eq("set_id", targetSetId)
          .eq("business_id", businessId);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await supabase
          .from("measurement_sets")
          .insert({
            business_id: businessId,
            client_id: activeClientId,
            template_name: templateName || null,
            label: templateName || "Relevé",
            notes: notes || null,
            recorded_at: recordedAt,
          })
          .select("id")
          .single();
        if (error) throw error;
        targetSetId = (data as { id: string }).id;
      }

      const values = fields
        .filter((f) => f.name.trim())
        .map((f, i) => ({
          business_id: businessId,
          set_id: targetSetId!,
          name: f.name.trim(),
          value: f.value === "" ? null : Number(f.value.replace(",", ".")),
          unit: "cm",
          position: i,
        }));
      if (values.length) {
        const { error: valueError } = await supabase
          .from("measurement_values")
          .insert(values);
        if (valueError) throw valueError;
      }

      return targetSetId!;
    },
    onSuccess: (savedSetId) => {
      queryClient.invalidateQueries({ queryKey: ["measurements"] });
      if (selectedClientId) {
        queryClient.invalidateQueries({ queryKey: ["measurements", selectedClientId] });
      }
      toast.success(mode === "edit" ? "Mesures modifiées" : "Mesures enregistrées");
      onOpenChange(false);
      setFields([]);
      setTemplateName("");
      onSaved?.(savedSetId);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Enregistrement impossible";
      toast.error(msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit"
              ? "Modifier le relevé de mesures"
              : mode === "copy"
              ? "Reprendre et actualiser les mesures"
              : "Nouveau relevé de mesures"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Corrigez les valeurs de ce relevé."
              : mode === "copy"
              ? "Crée un nouveau relevé daté avec les valeurs pré-remplies de l'ancien relevé."
              : "Les anciennes mesures sont conservées : ce relevé s'ajoute au carnet numérique du client."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          {/* Sélection du client si non pré-défini */}
          {!initialClientId && (
            <div className="space-y-1.5">
              <Label htmlFor="measure-client">Client *</Label>
              <select
                id="measure-client"
                required
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="">Sélectionner un client…</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {fullName(c)} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sélecteur visuel de gabarits avec icônes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Modèle de coupe :
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { name: "Homme", icon: "👔" },
                { name: "Femme", icon: "👗" },
                { name: "Enfant", icon: "🧒" },
                { name: "", label: "Sur mesure", icon: "📐" },
              ].map((tpl) => {
                const isSelected = templateName === tpl.name;
                return (
                  <button
                    key={tpl.name || "custom"}
                    type="button"
                    onClick={() => pickTemplate(tpl.name)}
                    className={`flex flex-col items-center justify-center rounded-xl border p-2.5 text-center transition-all active:scale-95 ${
                      isSelected
                        ? "border-primary bg-primary/10 font-bold text-primary ring-2 ring-primary/40 shadow-xs"
                        : "border-border bg-card text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="text-xl">{tpl.icon}</span>
                    <span className="mt-1 text-xs font-semibold">{tpl.label || tpl.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recorded_at">Date du relevé</Label>
            <Input
              id="recorded_at"
              name="recorded_at"
              type="date"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
              className="h-10 text-base sm:text-sm"
            />
          </div>

          <div className="space-y-2.5">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Mensurations (en centimètres)
            </Label>
            <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
              {fields.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface/50 p-2"
                >
                  <span className="flex-1 text-sm font-semibold truncate" title={f.name}>
                    {f.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <Input
                      inputMode="decimal"
                      value={f.value}
                      onChange={(e) =>
                        setFields((prev) =>
                          prev.map((item, idx) =>
                            idx === i ? { ...item, value: e.target.value } : item,
                          ),
                        )
                      }
                      className="h-10 w-24 text-center text-base font-bold sm:text-sm"
                      placeholder="0"
                    />
                    <span className="text-xs font-bold text-muted-foreground">cm</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFields((prev) => prev.filter((_, idx) => idx !== i))}
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:scale-90"
                    aria-label={`Retirer ${f.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Input
                value={extraName}
                onChange={(e) => setExtraName(e.target.value)}
                placeholder="Ajouter une mesure libre (ex: Tour de bras, Carrure...)"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!extraName.trim()) return;
                  setFields((prev) => [...prev, { name: extraName.trim(), value: "" }]);
                  setExtraName("");
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="measure-notes">Notes / Observations</Label>
            <Textarea
              id="measure-notes"
              name="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Préfère les manches légèrement amples, épaule gauche plus basse..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending || fields.length === 0}>
              {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
