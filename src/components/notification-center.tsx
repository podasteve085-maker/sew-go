import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  Calendar,
  Clock,
  MessageCircle,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Shirt,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";

import {
  type AppNotification,
  getNotificationPermission,
  requestNotificationPermission,
} from "@/lib/notifications";
import { waLink, cleanPhone } from "@/lib/format";
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

export function NotificationCenter({ notifications }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(getNotificationPermission());

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
        className="w-[94vw] sm:w-[420px] p-0 rounded-2xl shadow-2xl border-border bg-card overflow-hidden"
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

          {permission !== "granted" && permission !== "unsupported" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRequestPermission}
              className="h-7 text-[11px] font-bold border-primary/40 text-primary hover:bg-primary/10 gap-1 rounded-lg"
            >
              <Volume2 className="size-3" />
              <span>Activer sonnerie</span>
            </Button>
          )}
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

/* ── Carte individuelle de rappel ────────────────────────────────── */

function NotificationCard({
  item,
  onWhatsApp,
  onClose,
}: {
  item: AppNotification;
  onWhatsApp: () => void;
  onClose: () => void;
}) {
  const isRDV = item.category === "appointment";
  const hasPhone = Boolean(item.clientWhatsapp || item.clientPhone);

  return (
    <div className="rounded-xl border border-border/70 bg-card p-3 shadow-xs space-y-2.5 transition-all hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
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
