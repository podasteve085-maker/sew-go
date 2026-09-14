import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { PwaInstallButton } from "@/components/pwa-install-banner";
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
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fullName } from "@/lib/format";
import { ORDER_STATUS, type OrderStatus } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { StoredImage } from "@/components/bits";
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
  { to: "/atelier", label: "Mon atelier", icon: Settings },
] as const;

const MOBILE_NAV = [
  { to: "/dashboard", label: "Accueil", icon: Home },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/catalogue", label: "Lookbook", icon: BookOpen },
  { to: "/commandes", label: "Commandes", icon: Scissors },
  { to: "/mesures", label: "Mesures", icon: Ruler },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { data: business } = useBusiness();
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
        <div className="flex items-center gap-2 px-5 py-5">
          <StoredImage
            path={business?.logo_url}
            alt="Logo atelier"
            className="size-9 rounded-xl object-cover shrink-0"
            fallback={
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
                <Scissors className="size-5" />
              </span>
            }
          />
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
        </nav>
        <div className="space-y-2 p-3">
          <PwaInstallButton />
          <SignOutButton />
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* En-tête épuré et ultra-rapide */}
        <header className="no-print sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur-md">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 lg:px-8">
            <Link to="/dashboard" className="flex items-center gap-2 lg:hidden shrink-0">
              <StoredImage
                path={business?.logo_url}
                alt="Logo atelier"
                className="size-7.5 rounded-lg object-cover shrink-0"
                fallback={
                  <span className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                    <Scissors className="size-3.5" />
                  </span>
                }
              />
              <span className="max-w-[7rem] xs:max-w-[8.5rem] truncate font-display text-xs font-bold sm:text-sm">
                {business?.name ?? "Mon atelier"}
              </span>
            </Link>
            <button
              onClick={() => setSearchOpen(true)}
              className="ml-auto flex flex-1 items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/40 hover:bg-card sm:px-4 sm:py-2 sm:text-sm lg:max-w-sm cursor-pointer shadow-2xs"
              aria-label="Rechercher"
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">Rechercher…</span>
              <kbd className="ml-auto hidden rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-mono font-medium text-muted-foreground sm:inline-block">
                Ctrl K
              </kbd>
            </button>
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

      {/* Bouton d'action rapide flottant (FAB) — Téléphone uniquement */}
      <Link
        to="/commandes/nouvelle"
        className="no-print fixed bottom-18 right-3.5 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:scale-105 active:scale-95 lg:hidden"
        aria-label="Nouvelle commande"
        title="Nouvelle commande"
      >
        <Plus className="size-5.5 stroke-[2.5]" />
      </Link>

      {/* Navigation basse — téléphone avec repères tactiles nets et ergonomie à une main */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-card/98 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-around">
          {MOBILE_NAV.map((item) => {
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
          <Link
            to="/atelier"
            className={`flex flex-1 flex-col items-center justify-center py-1 text-[0.65rem] transition-all active:scale-90 ${
              pathname.startsWith("/atelier") || pathname.startsWith("/statistiques")
                ? "font-bold text-primary"
                : "font-medium text-muted-foreground hover:text-foreground"
            }`}
          >
            <span
              className={`flex items-center justify-center rounded-xl px-2.5 py-1 transition-all ${
                pathname.startsWith("/atelier") || pathname.startsWith("/statistiques")
                  ? "bg-primary/15 text-primary scale-105"
                  : ""
              }`}
            >
              <Settings className="size-4.5" />
            </span>
            <span className="mt-0.5 tracking-tight">Atelier</span>
          </Link>
        </div>
      </nav>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function SignOutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <button
      onClick={handleSignOut}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
    >
      <LogOut className="size-4.5" /> Se déconnecter
    </button>
  );
}

function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [term, setTerm] = useState("");
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["search", term],
    enabled: open && term.trim().length >= 2,
    queryFn: async () => {
      const like = `%${term.trim()}%`;
      const [clients, orders] = await Promise.all([
        supabase
          .from("clients")
          .select("id, first_name, last_name, phone, city")
          .or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`)
          .order("first_name")
          .limit(8),
        supabase
          .from("orders")
          .select("id, reference, garment_type, status, clients(first_name, last_name)")
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
