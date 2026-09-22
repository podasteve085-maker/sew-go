import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { PwaInstallButton } from "@/components/pwa-install-banner";
import { ThemeToggle, ThemeSegmentedControl } from "@/components/theme-toggle";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Home,
  Users,
  Ruler,
  Scissors,
  CalendarDays,
  BarChart3,
  Settings,
  Search,
  LogOut,
  Plus,
  BookOpen,
  Crown,
  ShieldAlert,
  Menu,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fetchOrders, fetchClients, fetchAllMeasurementSets } from "@/lib/queries";
import { fullName } from "@/lib/format";
import { ORDER_STATUS, type OrderStatus } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { StoredImage } from "@/components/bits";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { isProOrAdmin } from "@/lib/quotas";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const NAV = [
  { to: "/dashboard", label: "Accueil", icon: Home },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/mesures", label: "Mesures", icon: Ruler },
  { to: "/commandes", label: "Commandes", icon: Scissors },
  { to: "/catalogue", label: "Lookbook", icon: BookOpen },
  { to: "/rendez-vous", label: "Rendez-vous", icon: CalendarDays },
  { to: "/statistiques", label: "Statistiques", icon: BarChart3 },
  { to: "/abonnement", label: "Abonnement", icon: Crown },
  { to: "/atelier", label: "Mon atelier", icon: Settings },
] as const;

const MOBILE_BOTTOM_NAV = [
  { to: "/dashboard", label: "Accueil", icon: Home },
  { to: "/commandes", label: "Commandes", icon: Scissors },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/mesures", label: "Mesures", icon: Ruler },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { data: business } = useBusiness();
  const queryClient = useQueryClient();
  const isPro = isProOrAdmin(business);
  const [searchOpen, setSearchOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Préchargement intelligent en arrière-plan pour navigation instantanée (0ms) sur mobile
  useEffect(() => {
    if (!business?.id) return;
    const bid = business.id;
    const prefetchData = () => {
      queryClient.prefetchQuery({
        queryKey: ["orders"],
        queryFn: () => fetchOrders(),
        staleTime: 5 * 60 * 1000,
      });
      queryClient.prefetchQuery({
        queryKey: ["clients", ""],
        queryFn: () => fetchClients(""),
        staleTime: 5 * 60 * 1000,
      });
      queryClient.prefetchQuery({
        queryKey: ["measurements"],
        queryFn: () => fetchAllMeasurementSets(),
        staleTime: 5 * 60 * 1000,
      });
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => void })
        .requestIdleCallback(prefetchData, { timeout: 1200 });
    } else {
      setTimeout(prefetchData, 300);
    }
  }, [business?.id, queryClient]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Barre latérale — ordinateur / tablette */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="size-9 rounded-xl overflow-hidden shrink-0 border border-sidebar-border/60 bg-sidebar-primary/20 flex items-center justify-center shadow-xs">
            <StoredImage
              path={business?.logo_url}
              alt="Logo atelier"
              className="size-full object-cover"
              fallback={
                <span className="flex size-full items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">
                  <Scissors className="size-4.5" />
                </span>
              }
            />
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold">
              {business?.name ?? "Mon atelier"}
            </p>
            <p className="truncate text-xs text-sidebar-foreground/60">CouturPro</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="size-4.5" />
                {item.label}
              </Link>
            );
          })}

          {/* Lien Administration Centrale réservé aux administrateurs */}
          {business?.is_admin && (
            <Link
              to="/admin"
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${
                pathname.startsWith("/admin")
                  ? "bg-purple-600/20 text-purple-700 dark:text-purple-300"
                  : "text-purple-700/85 hover:bg-purple-600/10 hover:text-purple-700"
              }`}
            >
              <ShieldAlert className="size-4.5 text-purple-600" />
              <span>Administration</span>
              <span className="ml-auto rounded bg-purple-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                ADMIN
              </span>
            </Link>
          )}
        </nav>
        <div className="space-y-2 p-3">
          {!isPro && (
            <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
                <Crown className="size-3.5" /> Plan Gratuit
              </div>
              <p className="text-[11px] text-muted-foreground leading-tight">
                Clients et commandes illimités dès 2 500 F/mois.
              </p>
              <Button
                asChild
                size="sm"
                className="w-full text-xs h-7 font-bold shadow-xs mt-1"
              >
                <Link to="/abonnement">
                  Voir l'abonnement ⭐
                </Link>
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between px-1 pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
              Réseau & Sync
            </span>
            <SyncStatusBadge />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 mb-1.5 px-1">
              Thème d'affichage
            </p>
            <ThemeSegmentedControl />
          </div>
          <PwaInstallButton />
          <SignOutButton />
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* En-tête épuré et ultra-rapide */}
        <header className="no-print sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur-md">
          <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 py-2 sm:px-4 sm:py-2.5 lg:px-8">
            {/* Bouton Menu hamburger sur mobile */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden flex size-8.5 items-center justify-center rounded-xl border border-border/80 bg-card text-foreground hover:bg-muted active:scale-95 shrink-0 cursor-pointer shadow-2xs"
              aria-label="Ouvrir le menu"
            >
              <Menu className="size-4.5" />
            </button>

            {/* Logo atelier mobile */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex items-center gap-1.5 lg:hidden shrink-0 text-left cursor-pointer active:opacity-80"
              title="Voir tous les modules"
            >
              <div className="size-7.5 rounded-lg overflow-hidden shrink-0 border border-border/70 bg-primary/10 flex items-center justify-center shadow-2xs">
                <StoredImage
                  path={business?.logo_url}
                  alt="Logo atelier"
                  className="size-full object-cover"
                  fallback={
                    <span className="flex size-full items-center justify-center bg-primary text-primary-foreground">
                      <Scissors className="size-3.5" />
                    </span>
                  }
                />
              </div>
              <span className="hidden md:inline-block max-w-[7rem] truncate font-display text-xs font-bold">
                {business?.name ?? "Mon atelier"}
              </span>
            </button>

            {/* Barre de recherche responsive */}
            <button
              onClick={() => setSearchOpen(true)}
              className="flex flex-1 items-center gap-2 rounded-full border border-border/80 bg-card/90 px-2.5 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/40 hover:bg-card sm:px-4 sm:py-2 sm:text-sm lg:max-w-sm cursor-pointer shadow-2xs min-w-0"
              aria-label="Rechercher"
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate hidden xs:inline">Rechercher…</span>
              <kbd className="ml-auto hidden rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-mono font-medium text-muted-foreground sm:inline-block">
                Ctrl K
              </kbd>
            </button>

            {/* Badge Pro ou Admin dans l'en-tête */}
            {business?.is_admin ? (
              <Link
                to="/admin"
                className="rounded-md bg-purple-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white shrink-0"
              >
                ADMIN
              </Link>
            ) : isPro ? (
              <Link
                to="/abonnement"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-extrabold shrink-0 active:scale-95"
              >
                <Crown className="size-3" /> PRO
              </Link>
            ) : (
              <Link
                to="/abonnement"
                className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 text-[10px] font-extrabold shrink-0 active:scale-95"
              >
                <Crown className="size-3" /> PRO
              </Link>
            )}

            {/* Indicateur de connectivité & Synchronisation compact sur mobile */}
            <div className="shrink-0">
              <SyncStatusBadge compact={true} className="sm:hidden" />
              <SyncStatusBadge compact={false} className="hidden sm:inline-flex" />
            </div>

            {/* Bascule Thème Clair / Sombre / Auto TOUJOURS VISIBLE */}
            <div className="shrink-0 flex items-center">
              <ThemeToggle align="end" />
            </div>

            <Button asChild size="sm" className="hidden sm:inline-flex shrink-0 shadow-xs">
              <Link to="/commandes/nouvelle">
                <Plus className="size-4" /> Commande
              </Link>
            </Button>
          </div>
        </header>

        <main className="px-3 pb-24 pt-3 sm:px-6 sm:pb-28 sm:pt-5 lg:px-8 lg:pb-12 max-w-full overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* Bouton d'action rapide flottant (FAB déplaçable au doigt) — Téléphone uniquement */}
      <DraggableFab />

      {/* Navigation basse — téléphone avec repères tactiles nets et accès au menu complet */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-card/98 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-around">
          {MOBILE_BOTTOM_NAV.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-1 flex-col items-center justify-center py-1 text-[0.65rem] transition-all active:scale-90 ${
                  active
                    ? "font-bold text-primary"
                    : "font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`flex items-center justify-center rounded-xl px-2.5 py-1 transition-all ${
                    active ? "bg-primary/15 text-primary scale-105" : ""
                  }`}
                >
                  <item.icon className="size-4.5" />
                </span>
                <span className="mt-0.5 tracking-tight">{item.label}</span>
              </Link>
            );
          })}
          {/* Bouton Plus / Menu ouvrant le tiroir complet (Statistiques, RDV, Lookbook, Déconnexion...) */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className={`flex flex-1 flex-col items-center justify-center py-1 text-[0.65rem] transition-all active:scale-90 cursor-pointer ${
              mobileMenuOpen ||
              pathname.startsWith("/catalogue") ||
              pathname.startsWith("/rendez-vous") ||
              pathname.startsWith("/statistiques") ||
              pathname.startsWith("/abonnement") ||
              pathname.startsWith("/atelier") ||
              pathname.startsWith("/admin")
                ? "font-bold text-primary"
                : "font-medium text-muted-foreground hover:text-foreground"
            }`}
          >
            <span
              className={`flex items-center justify-center rounded-xl px-2.5 py-1 transition-all ${
                mobileMenuOpen ||
                pathname.startsWith("/catalogue") ||
                pathname.startsWith("/rendez-vous") ||
                pathname.startsWith("/statistiques") ||
                pathname.startsWith("/abonnement") ||
                pathname.startsWith("/atelier") ||
                pathname.startsWith("/admin")
                  ? "bg-primary/15 text-primary scale-105"
                  : ""
              }`}
            >
              <Menu className="size-4.5" />
            </span>
            <span className="mt-0.5 tracking-tight">Plus</span>
          </button>
        </div>
      </nav>

      {/* Tiroir de navigation mobile complet (Tous les modules + Déconnexion) */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-xs p-0 flex flex-col justify-between bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
          {/* En-tête Atelier */}
          <div className="p-4 border-b border-sidebar-border bg-sidebar/50">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-xl overflow-hidden shrink-0 border border-sidebar-border/60 bg-sidebar-primary/20 flex items-center justify-center ring-2 ring-primary/20 shadow-xs">
                <StoredImage
                  path={business?.logo_url}
                  alt="Logo atelier"
                  className="size-full object-cover"
                  fallback={
                    <span className="flex size-full items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">
                      <Scissors className="size-5" />
                    </span>
                  }
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold text-sidebar-foreground">
                  {business?.name ?? "Mon atelier"}
                </p>
                <p className="truncate text-xs text-sidebar-foreground/60">
                  {business?.owner_name || "Couturier & Styliste"}
                </p>
                <div className="mt-1">
                  {business?.is_admin ? (
                    <span className="inline-flex rounded-full bg-purple-600 px-2 py-0.5 text-[9px] font-extrabold text-white">
                      ADMIN PLATEFORME
                    </span>
                  ) : isPro ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-bold">
                      <Crown className="size-2.5" /> PRO ACTIF
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 text-[9px] font-bold">
                      <Crown className="size-2.5" /> PLAN GRATUIT
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sélecteur de thème immédiat au sommet du menu mobile */}
          <div className="px-3.5 py-2.5 border-b border-sidebar-border bg-sidebar-accent/30 shrink-0">
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/70">
                Thème d'affichage
              </span>
              <span className="text-[10px] font-medium text-sidebar-foreground/50">
                Jour / Nuit
              </span>
            </div>
            <ThemeSegmentedControl />
          </div>

          {/* Liste complète de tous les modules */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
            <div className="space-y-1">
              <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/50">
                Atelier au quotidien
              </p>
              {[
                { to: "/dashboard", label: "Accueil", icon: Home },
                { to: "/commandes", label: "Commandes", icon: Scissors },
                { to: "/clients", label: "Clients", icon: Users },
                { to: "/mesures", label: "Carnet de Mesures", icon: Ruler },
                { to: "/catalogue", label: "Lookbook / Modèles", icon: BookOpen },
                { to: "/rendez-vous", label: "Agenda Rendez-vous", icon: CalendarDays },
              ].map((item) => {
                const active = pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold shadow-xs"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <item.icon className="size-4.5 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="space-y-1 pt-2 border-t border-sidebar-border">
              <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/50">
                Gestion & Performances
              </p>
              {[
                { to: "/statistiques", label: "Statistiques & Finances", icon: BarChart3 },
                { to: "/abonnement", label: "Mon Abonnement & Quotas", icon: Crown },
                { to: "/atelier", label: "Mon atelier (Paramètres)", icon: Settings },
              ].map((item) => {
                const active = pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold shadow-xs"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <item.icon className="size-4.5 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              {business?.is_admin && (
                <Link
                  to="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors ${
                    pathname.startsWith("/admin")
                      ? "bg-purple-600 text-white shadow-xs"
                      : "text-purple-400 hover:bg-purple-600/20 hover:text-purple-300"
                  }`}
                >
                  <ShieldAlert className="size-4.5 shrink-0" />
                  <span>Administration Centrale</span>
                  <span className="ml-auto rounded bg-purple-700 px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                    ADMIN
                  </span>
                </Link>
              )}
            </div>
          </div>

          {/* Pied du tiroir : Réseau + Thème + Installation PWA + Bouton Se Déconnecter */}
          <div className="p-3 border-t border-sidebar-border space-y-2.5 bg-sidebar/70">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
                État connexion
              </span>
              <SyncStatusBadge />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 mb-1.5 px-1">
                Thème d'affichage
              </p>
              <ThemeSegmentedControl />
            </div>
            <PwaInstallButton />
            <SignOutButton
              onDone={() => setMobileMenuOpen(false)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-destructive/15 text-destructive border border-destructive/25 py-2.5 text-sm font-bold transition-colors active:scale-95 hover:bg-destructive hover:text-destructive-foreground cursor-pointer"
            />
          </div>
        </SheetContent>
      </Sheet>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} businessId={business?.id} />
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
}

function SignOutButton({
  className,
  onDone,
}: {
  className?: string;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();

  async function handleSignOut() {
    onDone?.();
    try {
      // 1. Annuler toutes les requêtes réseau en vol
      await queryClient.cancelQueries();
      // 2. Vider l'intégralité du cache TanStack Query
      queryClient.clear();
      // 3. Révoquer la session Supabase côté serveur (toutes les sessions de l'utilisateur)
      try {
        await supabase.auth.signOut({ scope: "global" });
      } catch {
        await supabase.auth.signOut();
      }
    } finally {
      // 4. Détruire tous les jetons et données persistés dans le navigateur
      if (typeof window !== "undefined") {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          // ignore — certains navigateurs restreignent l'accès en mode privé
        }
      }
      // 5. Rechargement dur pour détruire tout état mémoire React/TanStack
      window.location.href = "/auth";
    }
  }

  return (
    <button
      onClick={handleSignOut}
      className={
        className ??
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground cursor-pointer"
      }
    >
      <LogOut className="size-4.5" /> Se déconnecter
    </button>
  );
}

function DraggableFab() {
  const navigate = useNavigate();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragInfo = useRef<{
    startX: number;
    startY: number;
    btnStartX: number;
    btnStartY: number;
    hasMoved: boolean;
  } | null>(null);

  const BUTTON_SIZE = 52;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const calcDefault = () => {
      const saved = localStorage.getItem("couturpro_fab_pos");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (typeof parsed.x === "number" && typeof parsed.y === "number") {
            const maxX = window.innerWidth - BUTTON_SIZE - 12;
            const maxY = window.innerHeight - 72 - BUTTON_SIZE;
            return {
              x: Math.min(Math.max(12, parsed.x), maxX),
              y: Math.min(Math.max(64, parsed.y), maxY),
            };
          }
        } catch {
          // ignore
        }
      }
      return {
        x: window.innerWidth - BUTTON_SIZE - 16,
        y: window.innerHeight - 76 - BUTTON_SIZE - 10,
      };
    };

    setPos(calcDefault());

    const onResize = () => {
      setPos((prev) => {
        if (!prev) return calcDefault();
        const maxX = window.innerWidth - BUTTON_SIZE - 12;
        const maxY = window.innerHeight - 72 - BUTTON_SIZE;
        return {
          x: prev.x > window.innerWidth / 2 ? maxX : 12,
          y: Math.min(Math.max(64, prev.y), maxY),
        };
      });
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pos) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragInfo.current = {
      startX: e.clientX,
      startY: e.clientY,
      btnStartX: pos.x,
      btnStartY: pos.y,
      hasMoved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragInfo.current) return;
    const deltaX = e.clientX - dragInfo.current.startX;
    const deltaY = e.clientY - dragInfo.current.startY;

    if (!dragInfo.current.hasMoved && Math.hypot(deltaX, deltaY) > 5) {
      dragInfo.current.hasMoved = true;
      setIsDragging(true);
    }

    if (dragInfo.current.hasMoved) {
      const maxX = window.innerWidth - BUTTON_SIZE - 10;
      const maxY = window.innerHeight - 68 - BUTTON_SIZE;
      const newX = Math.min(Math.max(10, dragInfo.current.btnStartX + deltaX), maxX);
      const newY = Math.min(Math.max(60, dragInfo.current.btnStartY + deltaY), maxY);
      setPos({ x: newX, y: newY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragInfo.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const hadMoved = dragInfo.current.hasMoved;
    const currentPos = pos;
    dragInfo.current = null;
    setIsDragging(false);

    if (hadMoved && currentPos) {
      const isLeft = currentPos.x + BUTTON_SIZE / 2 < window.innerWidth / 2;
      const snappedX = isLeft ? 14 : window.innerWidth - BUTTON_SIZE - 14;
      const snappedPos = { x: snappedX, y: currentPos.y };
      setPos(snappedPos);
      try {
        localStorage.setItem("couturpro_fab_pos", JSON.stringify(snappedPos));
      } catch {
        // ignore
      }
    } else if (!hadMoved) {
      navigate({ to: "/commandes/nouvelle" });
    }
  };

  if (!pos) return null;

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
      }}
      className={`no-print fixed left-0 top-0 z-40 flex size-[52px] items-center justify-center rounded-full bg-primary text-primary-foreground select-none touch-none lg:hidden shadow-xl border-2 border-white/25 cursor-grab active:cursor-grabbing ${
        isDragging
          ? "scale-110 shadow-2xl opacity-95 transition-none"
          : "scale-100 opacity-90 hover:opacity-100 transition-all duration-300 ease-out active:scale-95"
      }`}
      aria-label="Nouvelle commande (déplaçable)"
      title="Glissez pour déplacer, touchez pour nouvelle commande"
    >
      <Plus className="size-6 stroke-[2.5] pointer-events-none" />
    </button>
  );
}

function GlobalSearch({
  open,
  onOpenChange,
  businessId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId?: string | undefined;
}) {
  const [term, setTerm] = useState("");
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["search", businessId, term],
    enabled: open && term.trim().length >= 2 && Boolean(businessId),
    queryFn: async () => {
      if (!businessId) return { clients: [], orders: [] };
      const like = `%${term.trim()}%`;
      const [clients, orders] = await Promise.all([
        supabase
          .from("clients")
          .select("id, first_name, last_name, phone, city")
          .eq("business_id", businessId)
          .or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`)
          .order("first_name")
          .limit(8),
        supabase
          .from("orders")
          .select("id, reference, garment_type, status, clients(first_name, last_name)")
          .eq("business_id", businessId)
          .or(`reference.ilike.${like},garment_type.ilike.${like},fabric.ilike.${like}`)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      return { clients: clients.data ?? [], orders: (orders.data ?? []) as never[] };
    },
  });

  function go(to: string) {
    onOpenChange(false);
    setTerm("");
    navigate({ to });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Recherche</DialogTitle>
        <Command shouldFilter={false}>
      <CommandInput
        placeholder="Nom du client, téléphone, n° de commande…"
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        {term.trim().length < 2 ? (
          <CommandEmpty>Tapez au moins 2 lettres.</CommandEmpty>
        ) : !data?.clients.length && !data?.orders.length ? (
          <CommandEmpty>Aucun résultat.</CommandEmpty>
        ) : null}

        {!!data?.clients.length && (
          <CommandGroup heading="Clients">
            {data.clients.map((c) => (
              <CommandItem key={c.id} value={c.id} onSelect={() => go(`/clients/${c.id}`)}>
                <Users className="size-4" />
                <span className="font-medium">{fullName(c)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{c.phone ?? ""}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!!data?.orders.length && (
          <CommandGroup heading="Commandes">
            {data.orders.map((o: Record<string, never>) => {
              const order = o as unknown as {
                id: string;
                reference: string;
                garment_type: string;
                status: OrderStatus;
                clients: { first_name: string; last_name: string } | null;
              };
              return (
                <CommandItem
                  key={order.id}
                  value={order.id}
                  onSelect={() => go(`/commandes/${order.id}`)}
                >
                  <Scissors className="size-4" />
                  <span className="font-medium">{order.garment_type}</span>
                  <span className="text-xs text-muted-foreground">
                    {fullName(order.clients)} · {order.reference}
                  </span>
                  <span className={`ml-auto ${ORDER_STATUS[order.status]?.chip ?? "chip-cancel"}`}>
                    {ORDER_STATUS[order.status]?.label ?? order.status}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
      </DialogContent>
    </Dialog>
  );
}
