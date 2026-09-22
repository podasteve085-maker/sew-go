import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useSyncStatus } from "@/lib/sync-engine";

export function SyncStatusBadge({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { isOnline, isSyncing, pendingCount, syncNow } = useSyncStatus();

  // 1. État : Synchronisation en cours
  if (isSyncing) {
    return (
      <button
        type="button"
        disabled
        className={`inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 px-2.5 py-1 text-xs font-semibold shadow-2xs ${className ?? ""}`}
        title="Synchronisation des modifications avec le serveur..."
      >
        <RefreshCw className="size-3.5 animate-spin" />
        {!compact && (
          <span>
            {pendingCount > 0 ? `Sync (${pendingCount})...` : "Sync..."}
          </span>
        )}
      </button>
    );
  }

  // 2. État : Hors ligne
  if (!isOnline) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold shadow-2xs ${className ?? ""}`}
        title="Mode hors-ligne : vous pouvez continuer à travailler, vos données sont sauvegardées en toute sécurité sur cet appareil et seront synchronisées au retour de la connexion."
      >
        <WifiOff className="size-3.5" />
        {!compact && (
          <span>
            {pendingCount > 0
              ? `Hors-ligne (${pendingCount})`
              : "Hors-ligne"}
          </span>
        )}
      </div>
    );
  }

  // 3. État : En ligne mais des actions restent en attente
  if (pendingCount > 0) {
    return (
      <button
        type="button"
        onClick={() => syncNow()}
        className={`inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 px-2.5 py-1 text-xs font-semibold hover:bg-primary/25 active:scale-95 cursor-pointer shadow-2xs transition-all ${className ?? ""}`}
        title="Cliquez pour synchroniser immédiatement vos modifications en attente."
      >
        <RefreshCw className="size-3.5" />
        {!compact && <span>Sync ({pendingCount})</span>}
      </button>
    );
  }

  // 4. État : En ligne et tout est synchronisé à 100%
  if (compact) {
    return (
      <span
        className={`inline-flex size-2 rounded-full bg-emerald-500 ${className ?? ""}`}
        title="Connecté et synchronisé à 100%"
      />
    );
  }

  return (
    <div
      className={`hidden md:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 px-2 py-0.5 text-[11px] font-medium shadow-2xs ${className ?? ""}`}
      title="Connecté et synchronisé à 100%"
    >
      <Wifi className="size-3 text-emerald-600 dark:text-emerald-400" />
      <span>En ligne</span>
    </div>
  );
}
