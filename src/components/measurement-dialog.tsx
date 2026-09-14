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
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => fetchClients(), enabled: open });
  const templates = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates, enabled: open });

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
          .eq("id", targetSetId);
        if (setErr) throw setErr;

        const { error: delErr } = await supabase
          .from("measurement_values")
          .delete()
          .eq("set_id", targetSetId);
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
        const { error: valueError } = await supabase.from("measurement_values").insert(values);
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="template">Modèle de mesures</Label>
              <select
                id="template"
                value={templateName}
                onChange={(e) => pickTemplate(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="">Mesures personnalisées…</option>
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recorded_at">Date du relevé</Label>
              <Input
                id="recorded_at"
                name="recorded_at"
                type="date"
                value={recordedAt}
                onChange={(e) => setRecordedAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Mesures (en cm)</Label>
            {fields.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2">
                <span className="flex-1 text-sm font-medium">{f.name}</span>
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
                  className="w-24 font-semibold"
                  placeholder="ex: 96"
                />
                <button
                  type="button"
                  onClick={() => setFields((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Retirer ${f.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}

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
