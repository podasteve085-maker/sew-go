import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Calendar,
  Clock,
  MessageCircle,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Shirt,
  Volume2,
  X,
  CheckCheck,
  FastForward,
} from "lucide-react";
import { toast } from "sonner";

import {
  type AppNotification,
  getNotificationPermission,
  requestNotificationPermission,
  dismissNotificationId,
  dismissAllNotificationIds,
} from "@/lib/notifications";
import { waLink, cleanPhone, addDays, dateFr, today } from "@/lib/format";
import { saveOrderOffline, saveAppointmentOffline } from "@/lib/queries";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface NotificationCenterProps {
  notifications: AppNotification[];
  onRefresh?: () => void;
}

export function NotificationCenter({ notifications, onRefresh }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(getNotificationPermission());
  const queryClient = useQueryClient();

  const todayItems = notifications.filter((n) => n.timing === "today");
  const tomorrowItems = notifications.filter((n) => n.timing === "tomorrow");
  const overdueItems = notifications.filter((n) => n.timing === "overdue");
  const totalCount = notifications.length;

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    setPermission(granted ? "granted" : "denied");
    if (granted) {
      toast.success("Notifications du téléphone activées ! Vous recevrez les rappels le Jour J et la veille.");
    } else {
      toast.error("Autorisation refusée par le navigateur. Activez les notifications dans les paramètres de votre téléphone.");
    }
  };

  const handleSendWhatsApp = (item: AppNotification) => {
    const phone = item.clientWhatsapp || item.clientPhone;
    if (!phone) {
      toast.error("Aucun numéro de téléphone enregistré pour ce client.");
      return;
    }
    const link = waLink(cleanPhone(phone), item.whatsappMessage);
    if (link) {
      window.open(link, "_blank");
    } else {
      toast.error("Impossible d'ouvrir WhatsApp avec ce numéro.");
    }
  };

  const handleDismissOne = (item: AppNotification) => {
    dismissNotificationId(item.id);
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["appointments"] });
    if (onRefresh) onRefresh();
    toast.success("Rappel masqué");
  };

  const handleDismissAll = () => {
    dismissAllNotificationIds(notifications.map((n) => n.id));
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["appointments"] });
    if (onRefresh) onRefresh();
    toast.success("Toutes les notifications ont été effacées");
  };

  const handlePostpone = async (item: AppNotification, daysToAdd: number) => {
    try {
      // Si la date est déjà passée, on prolonge à partir d'aujourd'hui
      const baseDate = item.targetDate < today() ? today() : item.targetDate;
      const nextDate = addDays(daysToAdd, new Date(baseDate));

      if (item.category === "order_delivery") {
        await saveOrderOffline({ due_date: nextDate }, false, item.referenceId);
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        queryClient.invalidateQueries({ queryKey: ["order", item.referenceId] });
        toast.success(`Échéance repoussée au ${dateFr(nextDate)} ✅`);
      } else {
        await saveAppointmentOffline({ scheduled_date: nextDate }, false, item.referenceId);
        queryClient.invalidateQueries({ queryKey: ["appointments"] });
        toast.success(`Rendez-vous reporté au ${dateFr(nextDate)} ✅`);
      }
      if (onRefresh) onRefresh();
    } catch {
      toast.error("Impossible de repousser la date");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Centre de notifications et rappels"
          className="relative flex size-9 items-center justify-center rounded-xl border border-border/80 bg-card text-foreground hover:bg-muted active:scale-95 transition-all shadow-xs"
        >
          <Bell className="size-4.5" />
          {totalCount > 0 && (
            <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-black text-destructive-foreground ring-2 ring-background animate-in zoom-in-50">
              {totalCount > 9 ? "9+" : totalCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[94vw] sm:w-[440px] p-0 rounded-2xl shadow-2xl border-border bg-card overflow-hidden"
      >
        {/* En-tête du volet de notifications */}
        <div className="flex items-center justify-between border-b border-border/80 bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Bell className="size-4" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-foreground">
                Rappels & Notifications
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {totalCount} rappel{totalCount > 1 ? "s" : ""} (Jour J & Veille)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {totalCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismissAll}
                className="h-7 text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted gap-1 rounded-lg px-2"
                title="Tout masquer / marquer comme lu"
              >
                <CheckCheck className="size-3.5" />
                <span>Tout effacer</span>
              </Button>
            )}

            {permission !== "granted" && permission !== "unsupported" && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRequestPermission}
                className="h-7 text-[11px] font-bold border-primary/40 text-primary hover:bg-primary/10 gap-1 rounded-lg px-2"
              >
                <Volume2 className="size-3" />
                <span>Activer sonnerie</span>
              </Button>
            )}
          </div>
        </div>

        {/* Corps des alertes */}
        <div className="max-h-[68vh] overflow-y-auto p-3 space-y-4 divide-y divide-border/60">
          {totalCount === 0 ? (
            <div className="py-8 text-center space-y-2">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckCircle2 className="size-6" />
              </div>
              <p className="font-display text-sm font-bold">Tout est à jour !</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                Aucun rendez-vous ni livraison urgente pour aujourd'hui ou demain.
              </p>
            </div>
          ) : (
            <>
              {/* ── 1. AUJOURD'HUI (JOUR J) ── */}
              {todayItems.length > 0 && (
                <div className="space-y-2 pt-2 first:pt-0">
                  <div className="flex items-center gap-2 px-1">
                    <span className="flex size-2 rounded-full bg-red-500 animate-ping" />
                    <span className="text-xs font-black uppercase tracking-wider text-red-500">
                      Aujourd'hui · Jour J ({todayItems.length})
                    </span>
                  </div>

                  <div className="space-y-2">
                    {todayItems.map((item) => (
                      <NotificationCard
                        key={item.id}
                        item={item}
                        onWhatsApp={() => handleSendWhatsApp(item)}
                        onDismiss={() => handleDismissOne(item)}
                        onPostpone={(days) => handlePostpone(item, days)}
                        onClose={() => setOpen(false)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── 2. DEMAIN (LA VEILLE / J-1) ── */}
              {tomorrowItems.length > 0 && (
                <div className="space-y-2 pt-3">
                  <div className="flex items-center gap-2 px-1">
                    <span className="flex size-2 rounded-full bg-amber-500" />
                    <span className="text-xs font-black uppercase tracking-wider text-amber-500">
                      Demain · La Veille ({tomorrowItems.length})
                    </span>
                  </div>

                  <div className="space-y-2">
                    {tomorrowItems.map((item) => (
                      <NotificationCard
                        key={item.id}
                        item={item}
                        onWhatsApp={() => handleSendWhatsApp(item)}
                        onDismiss={() => handleDismissOne(item)}
                        onPostpone={(days) => handlePostpone(item, days)}
                        onClose={() => setOpen(false)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── 3. EN RETARD ── */}
              {overdueItems.length > 0 && (
                <div className="space-y-2 pt-3">
                  <div className="flex items-center gap-2 px-1">
                    <AlertTriangle className="size-3.5 text-destructive" />
                    <span className="text-xs font-black uppercase tracking-wider text-destructive">
                      Livraisons en retard ({overdueItems.length})
                    </span>
                  </div>

                  <div className="space-y-2">
                    {overdueItems.map((item) => (
                      <NotificationCard
                        key={item.id}
                        item={item}
                        onWhatsApp={() => handleSendWhatsApp(item)}
                        onDismiss={() => handleDismissOne(item)}
                        onPostpone={(days) => handlePostpone(item, days)}
                        onClose={() => setOpen(false)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pied de boîte : raccourcis */}
        <div className="border-t border-border/80 bg-muted/20 px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
          <Link
            to="/rendez-vous"
            onClick={() => setOpen(false)}
            className="hover:text-primary font-medium transition-colors"
          >
            📅 Voir l'agenda RDV
          </Link>
          <Link
            to="/commandes"
            onClick={() => setOpen(false)}
            className="hover:text-primary font-medium transition-colors"
          >
            👗 Voir les commandes
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── Carte individuelle de rappel avec actions 1-clic ─────────────── */

function NotificationCard({
  item,
  onWhatsApp,
  onDismiss,
  onPostpone,
  onClose,
}: {
  item: AppNotification;
  onWhatsApp: () => void;
  onDismiss: () => void;
  onPostpone: (days: number) => void;
  onClose: () => void;
}) {
  const isRDV = item.category === "appointment";
  const hasPhone = Boolean(item.clientWhatsapp || item.clientPhone);

  return (
    <div className="relative group rounded-xl border border-border/70 bg-card p-3 shadow-xs space-y-2.5 transition-all hover:border-primary/40">
      {/* Bouton rapide de masquage / suppression (✕) */}
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all"
        title="Masquer ce rappel"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start justify-between gap-2 pr-6">
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
              isRDV ? "bg-primary/10 text-primary" : "bg-blue-500/10 text-blue-500"
            }`}
          >
            {isRDV ? <Calendar className="size-4" /> : <Shirt className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-xs sm:text-sm font-bold text-foreground leading-tight">
              {item.title}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
              {item.body}
            </p>
          </div>
        </div>
      </div>

      {/* Ligne 1-clic : Prolonger ou Repousser en 1 geste */}
      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground bg-muted/30 -mx-3 px-3 py-1.5 rounded-lg">
        <FastForward className="size-3 text-primary shrink-0" />
        <span className="font-medium text-[10px] uppercase tracking-wide">Repousser :</span>
        <button
          type="button"
          onClick={() => onPostpone(2)}
          className="rounded-md bg-card border border-border/70 hover:border-primary/50 px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-primary/10 hover:text-primary transition-all active:scale-95"
          title="Reporter de 2 jours"
        >
          +2 jours
        </button>
        <button
          type="button"
          onClick={() => onPostpone(7)}
          className="rounded-md bg-card border border-border/70 hover:border-primary/50 px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-primary/10 hover:text-primary transition-all active:scale-95"
          title="Reporter d'une semaine"
        >
          +1 semaine
        </button>
      </div>

      {/* Actions rapides : WhatsApp Client & Consulter */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/50">
        {hasPhone && (
          <button
            type="button"
            onClick={onWhatsApp}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-700 active:scale-95 text-white py-1.5 text-[11px] font-bold shadow-xs transition-all"
            title="Envoyer un message de rappel pré-rempli sur WhatsApp"
          >
            <MessageCircle className="size-3.5" />
            <span>Rappeler client (WhatsApp)</span>
          </button>
        )}

        <Link
          to={item.linkUrl}
          onClick={onClose}
          className="flex items-center justify-center gap-1 rounded-lg bg-muted hover:bg-muted/80 text-foreground px-2.5 py-1.5 text-[11px] font-semibold transition-all shrink-0"
        >
          <span>Voir</span>
          <ExternalLink className="size-3" />
        </Link>
      </div>
    </div>
  );
}
