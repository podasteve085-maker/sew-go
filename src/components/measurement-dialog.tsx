import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  fetchTemplates,
  fetchClients,
  type MeasurementSetRow,
  saveMeasurementSetOffline,
  DEFAULT_MEASUREMENT_TEMPLATES,
} from "@/lib/queries";
import { today, fullName } from "@/lib/format";
import { getAllLocalItems } from "@/lib/offline-storage";
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
import { useBusiness } from "@/hooks/use-business";
import { checkMeasurementQuota, isSubscriptionExpired, isProOrAdmin } from "@/lib/quotas";
import { UpgradeDialog } from "@/components/upgrade-dialog";

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
  const { data: business } = useBusiness();
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId ?? "");
  const [templateName, setTemplateName] = useState("");
  const [fields, setFields] = useState<{ name: string; value: string }[]>([]);
  const [extraName, setExtraName] = useState("");
  const [notes, setNotes] = useState("");
  const [recordedAt, setRecordedAt] = useState(today());
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [quotaReason, setQuotaReason] = useState("");

  const [copyAsNew, setCopyAsNew] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopyAsNew(false);
    setSelectedClientId(initialClientId ?? (initialSet?.client_id ?? ""));

    if (initialSet && (mode === "edit" || mode === "copy")) {
      setTemplateName(initialSet.template_name ?? "");
      setRecordedAt(initialSet.recorded_at || today());
      setNotes(initialSet.notes ?? "");
      const existing = (initialSet.measurement_values ?? [])
        .sort((a, b) => a.position - b.position)
        .map((v) => ({
          name: v.name,
          value: v.value !== null ? String(v.value) : "",
        }));
      setFields(existing);
    } else {
      // Mode create : pré-charger automatiquement un template pour que les champs
      // soient immédiatement visibles (essentiel en offline)
      setNotes("");
      setRecordedAt(today());

      // Déterminer le template selon le genre du client sélectionné
      const clientId = initialClientId;
      const client = clientId ? clients.data?.find((c) => c.id === clientId) : null;
      const genderMap: Record<string, string> = { homme: "Homme", masculin: "Homme", m: "Homme", femme: "Femme", féminin: "Femme", f: "Femme", enfant: "Enfant" };
      const gender = client?.gender?.toLowerCase()?.trim() ?? "";
      const autoTemplateName = genderMap[gender] || "Homme";

      const source = templates.data && templates.data.length > 0
        ? templates.data
        : DEFAULT_MEASUREMENT_TEMPLATES;
      const tpl = source.find((t) => t.name === autoTemplateName);
      setTemplateName(autoTemplateName);
      setFields((tpl?.fields ?? []).map((f) => ({ name: f, value: "" })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialClientId, initialSet, mode]);

  function pickTemplate(name: string) {
    setTemplateName(name);
    // Priorité : templates serveur → DEFAULT_MEASUREMENT_TEMPLATES (offline fallback)
    const source = templates.data && templates.data.length > 0
      ? templates.data
      : DEFAULT_MEASUREMENT_TEMPLATES;
    const tpl = source.find((t) => t.name === name);
    setFields((tpl?.fields ?? []).map((f) => ({ name: f, value: "" })));
  }

  const save = useMutation({
    mutationFn: async () => {
      const activeClientId = selectedClientId || initialClientId;
      if (!activeClientId) {
        throw new Error("Veuillez sélectionner un client.");
      }

      const isActuallyNew = mode === "create" || (mode === "copy" && copyAsNew);
      const targetId = isActuallyNew ? undefined : initialSet?.id;

      if (!isActuallyNew) {
        if (isSubscriptionExpired(business)) {
          const msg = "Votre atelier est en mode Consultation. Vos mesures restent consultables et sauvegardées en sécurité. Réactivez votre Pass Atelier pour modifier vos fiches existantes.";
          setQuotaReason(msg);
          setUpgradeOpen(true);
          throw new Error(msg);
        }
      } else {
        // Contrôle de quota résilient : 0ms pour Pro/Admin, timeout 1.5s max si en ligne, repli IndexedDB
        if (!isProOrAdmin(business)) {
          let count: number | null = null;
          if (typeof navigator !== "undefined" && navigator.onLine) {
            try {
              const timeoutPromise = new Promise<{ count: number | null; error: any }>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 1500)
              );
              const queryPromise = supabase
                .from("measurement_sets")
                .select("id", { count: "exact", head: true })
                .eq("business_id", businessId);
        
              const res = await Promise.race([queryPromise, timeoutPromise]);
              if (!res.error && typeof res.count === "number") {
                count = res.count;
              }
            } catch {
              // Réseau lent ou défaillant -> repli local
            }
          }
        
          if (count === null) {
            try {
              const localSets = await getAllLocalItems<{ business_id?: string }>("measurement_sets");
              count = localSets.filter((s) => !s.business_id || s.business_id === businessId).length;
            } catch {
              count = 0;
            }
          }
        
          const quota = checkMeasurementQuota(business, count);
          if (!quota.allowed) {
            setQuotaReason(quota.message || "Quota de fiches de mesures atteint.");
            setUpgradeOpen(true);
            throw new Error(quota.message || "Quota de fiches de mesures atteint.");
          }
        }
      }

      const formattedValues = fields
        .filter((f) => f.name.trim())
        .map((f, i) => {
          const raw = f.value.trim().replace(",", ".");
          const num = raw === "" ? null : Number(raw);
          return {
            name: f.name.trim(),
            value: num !== null && !isNaN(num) ? num : null,
            unit: "cm",
            position: i,
          };
        });

      const setRes = await saveMeasurementSetOffline(
        {
          id: targetId,
          business_id: businessId,
          client_id: activeClientId,
          template_name: templateName || null,
          label: templateName || "Relevé",
          notes: notes || null,
          recorded_at: recordedAt,
        },
        formattedValues,
        isActuallyNew,
        targetId,
      );

      return setRes.id;
    },
    onSuccess: (savedSetId) => {
      queryClient.invalidateQueries({ queryKey: ["measurements"] });
      if (selectedClientId) {
        queryClient.invalidateQueries({ queryKey: ["measurements", selectedClientId] });
      }
      toast.success(
        mode === "edit" || (mode === "copy" && !copyAsNew)
          ? "Fiche de mesures mise à jour"
          : "Nouvelle fiche enregistrée"
      );
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
              ? "Corrigez les valeurs de ce relevé de mesures."
              : mode === "copy"
              ? "Actualisez directement cette fiche ou archivez-la pour en créer une nouvelle."
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
          {/* Option mise à jour vs nouvelle fiche en mode reprise */}
          {mode === "copy" && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5 space-y-2">
              <Label className="text-xs font-bold text-foreground">Action souhaitée :</Label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setCopyAsNew(false)}
                  className={`rounded-lg p-2 text-left border transition-all cursor-pointer ${
                    !copyAsNew
                      ? "border-primary bg-primary text-primary-foreground font-bold shadow-xs"
                      : "border-border/80 bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <p className="font-semibold text-xs">Mettre à jour la fiche</p>
                  <p className="text-[10px] opacity-80">Actualise la fiche existante</p>
                </button>
                <button
                  type="button"
                  onClick={() => setCopyAsNew(true)}
                  className={`rounded-lg p-2 text-left border transition-all cursor-pointer ${
                    copyAsNew
                      ? "border-primary bg-primary text-primary-foreground font-bold shadow-xs"
                      : "border-border/80 bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <p className="font-semibold text-xs">Nouvelle fiche datée</p>
                  <p className="text-[10px] opacity-80">Garde l'ancienne en historique</p>
                </button>
              </div>
            </div>
          )}

          {/* Sélection du client si non pré-défini */}
          {!initialClientId && (
            <div className="space-y-1.5">
              <Label htmlFor="measure-client">Client *</Label>
              <select
                id="measure-client"
                required
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base sm:text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
                className="h-11 text-base sm:text-sm rounded-xl"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 w-11 shrink-0 rounded-xl"
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

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        triggerReason={quotaReason}
      />
    </Dialog>
  );
}
