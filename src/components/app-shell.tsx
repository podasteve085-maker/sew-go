import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Home,
  Users,
  Scissors,
  CalendarDays,
  BarChart3,
  Settings,
  Search,
  LogOut,
  Plus,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fullName } from "@/lib/format";
import { ORDER_STATUS, type OrderStatus } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const NAV = [
  { to: "/dashboard", label: "Accueil", icon: Home },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/commandes", label: "Commandes", icon: Scissors },
  { to: "/rendez-vous", label: "Rendez-vous", icon: CalendarDays },
  { to: "/statistiques", label: "Statistiques", icon: BarChart3 },
  { to: "/atelier", label: "Mon atelier", icon: Settings },
] as const;

const MOBILE_NAV = NAV.slice(0, 4);

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
          <span className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Scissors className="size-5" />
          </span>
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
        <div className="p-3">
          <SignOutButton />
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* En-tête */}
        <header className="no-print sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 lg:px-8">
            <span className="flex items-center gap-2 lg:hidden">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Scissors className="size-4" />
              </span>
              <span className="max-w-[9rem] truncate font-display text-sm font-semibold">
                {business?.name ?? "Mon atelier"}
              </span>
            </span>
            <button
              onClick={() => setSearchOpen(true)}
              className="ml-auto flex flex-1 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 lg:max-w-sm"
            >
              <Search className="size-4" />
              Rechercher un client, une commande…
            </button>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link to="/commandes/nouvelle">
                <Plus className="size-4" /> Commande
              </Link>
            </Button>
          </div>
        </header>

        <main className="px-4 pb-28 pt-5 lg:px-8 lg:pb-12">{children}</main>
      </div>

      {/* Navigation basse — téléphone */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="flex">
          {MOBILE_NAV.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.7rem] font-medium ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <item.icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
          <Link
            to="/atelier"
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.7rem] font-medium ${
              pathname.startsWith("/atelier") || pathname.startsWith("/statistiques")
                ? "text-primary"
                : "text-muted-foreground"
            }`}
          >
            <Settings className="size-5" />
            Atelier
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
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
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
    </CommandDialog>
  );
}
