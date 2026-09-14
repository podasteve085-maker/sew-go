import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Scissors,
  PackageCheck,
  CalendarDays,
  Wallet,
  Plus,
  UserPlus,
  CalendarPlus,
  Ruler,
  MessageCircle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fetchOrders, fetchAppointments, balance } from "@/lib/queries";
import { isActive, isLate, appointmentLabel } from "@/lib/domain";
import { fcfa, dateFr, dateLongFr, today, addDays, fullName, cleanPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, EmptyState, SectionTitle, OrderCard, LateBadge } from "@/components/bits";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — CouturPro" },
      {
        name: "description",
        content:
          "Vue du jour : commandes en cours, vêtements à livrer, rendez-vous et montants restant à encaisser.",
      },
      { property: "og:title", content: "Tableau de bord — CouturPro" },
      { property: "og:description", content: "Votre activité de couture du jour en un écran." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: business } = useBusiness();

  const clientsCount = useQuery({
    queryKey: ["clients-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("clients")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const orders = useQuery({ queryKey: ["orders"], queryFn: () => fetchOrders() });
  const appointments = useQuery({
    queryKey: ["appointments"],
    queryFn: () => fetchAppointments(),
  });

  const all = orders.data ?? [];
  const active = all.filter((o) => isActive(o.status));
  const inMaking = active.filter(
    (o) => o.status === "preparation" || o.status === "confection" || o.status === "finition",
  );
  const toDeliver = active.filter(
    (o) => o.status === "prete" || (o.due_date && o.due_date <= addDays(7)),
  );
  const late = active.filter(isLate);
  const outstanding = active.reduce((sum, o) => sum + Math.max(0, balance(o)), 0);

  const appts = (appointments.data ?? []).filter((a) => a.status === "prevu");
  const todayAppts = appts.filter((a) => a.scheduled_date === today());
  const tomorrowAppts = appts.filter((a) => a.scheduled_date === addDays(1));
  const weekDeliveries = active.filter(
    (o) => o.due_date && o.due_date >= today() && o.due_date <= addDays(7),
  );

  const urgent = [...active]
    .filter((o) => o.due_date)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 5);

  const rawName = (business?.owner_name ?? "").split(" ")[0];
  const firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : "";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <h1 className="page-title">Bonjour{firstName ? `, ${firstName}` : ""} 👋</h1>
        <p className="mt-1 text-sm capitalize text-muted-foreground">
          {dateLongFr(new Date().toISOString())}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Link to="/clients">
          <StatCard
            label="Clients"
            icon={Users}
            value={clientsCount.isLoading ? "…" : clientsCount.data}
          />
        </Link>
        <Link to="/commandes">
          <StatCard
            label="En cours"
            icon={Scissors}
            value={orders.isLoading ? "…" : active.length}
            hint={late.length ? `${late.length} en retard` : undefined}
          />
        </Link>
        <Link to="/commandes">
          <StatCard
            label="À confectionner"
            icon={Ruler}
            value={orders.isLoading ? "…" : inMaking.length}
            hint="en atelier"
          />
        </Link>
        <Link to="/commandes">
          <StatCard label="À livrer" icon={PackageCheck} value={toDeliver.length} hint="7 jours" />
        </Link>
        <Link to="/rendez-vous">
          <StatCard
            label="Rendez-vous"
            icon={CalendarDays}
            value={todayAppts.length}
            hint="aujourd'hui"
          />
        </Link>
        <div className="col-span-2 sm:col-span-1">
          <StatCard
            label="Reste à encaisser"
            icon={Wallet}
            value={<span className="text-xl">{fcfa(outstanding, business?.currency)}</span>}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Button asChild size="lg" className="justify-start">
          <Link to="/commandes/nouvelle">
            <Plus className="size-4" /> Nouvelle commande
          </Link>
        </Button>
        <Button asChild size="lg" variant="secondary" className="justify-start">
          <Link to="/clients" search={{ nouveau: true }}>
            <UserPlus className="size-4" /> Nouveau client
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="justify-start">
          <Link to="/rendez-vous" search={{ nouveau: true }}>
            <CalendarPlus className="size-4" /> Nouveau rendez-vous
          </Link>
        </Button>
      </div>

      <section>
        <SectionTitle
          action={
            <Link to="/commandes" className="text-sm font-medium text-primary">
              Tout voir
            </Link>
          }
        >
          Commandes urgentes
        </SectionTitle>
        {orders.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : urgent.length === 0 ? (
          <EmptyState
            title="Aucune commande en cours"
            text="Créez votre première commande pour suivre la confection et les paiements."
            action={
              <Button asChild>
                <Link to="/commandes/nouvelle">Nouvelle commande</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {urgent.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle
            action={
              <Link to="/rendez-vous" className="text-sm font-medium text-primary">
                Agenda
              </Link>
            }
          >
            Rappels
          </SectionTitle>
          <div className="card-soft divide-y divide-border">
            <ReminderRow
              color="bg-destructive"
              label="Aujourd'hui"
              value={`${todayAppts.length} rendez-vous`}
            />
            <ReminderRow
              color="bg-warning"
              label="Demain"
              value={`${tomorrowAppts.length} rendez-vous`}
            />
            <ReminderRow
              color="bg-success"
              label="Cette semaine"
              value={`${weekDeliveries.length} livraisons prévues`}
            />
            {late.length > 0 && (
              <ReminderRow
                color="bg-destructive"
                label="Retards"
                value={`${late.length} commande(s) en retard`}
              />
            )}
          </div>
        </div>

        <div>
          <SectionTitle>Rendez-vous du jour</SectionTitle>
          {todayAppts.length === 0 ? (
            <EmptyState title="Aucun rendez-vous aujourd'hui" />
          ) : (
            <div className="space-y-3">
              {todayAppts.map((a) => (
                <div key={a.id} className="card-soft flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="rounded-lg bg-primary/10 px-2.5 py-1.5 font-display text-sm font-bold text-primary">
                      {a.scheduled_time?.slice(0, 5) ?? "--:--"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{fullName(a.clients)}</p>
                      <p className="text-xs text-muted-foreground">{appointmentLabel(a.type)}</p>
                    </div>
                  </div>

                  {a.clients?.phone && (
                    <a
                      href={`https://wa.me/${cleanPhone(a.clients.whatsapp || a.clients.phone)}?text=${encodeURIComponent(
                        `Bonjour ${a.clients.first_name}, nous vous rappelons votre rendez-vous de ${appointmentLabel(a.type)} prévu aujourd'hui à ${a.scheduled_time?.slice(0, 5) ?? ""} chez ${business?.name ?? "votre atelier"}.`,
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-success hover:bg-success/10 shrink-0"
                      title="Rappeler par WhatsApp"
                    >
                      <MessageCircle className="size-3.5" /> WhatsApp
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {late.length > 0 && (
        <section>
          <SectionTitle>Commandes en retard</SectionTitle>
          <div className="space-y-3">
            {late.map((o) => (
              <div key={o.id} className="card-soft flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {o.garment_type} — {fullName(o.clients)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Prévue le {dateFr(o.due_date)} · {o.reference}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <LateBadge />
                  {o.clients?.phone && (
                    <a
                      href={`https://wa.me/${cleanPhone(o.clients.whatsapp || o.clients.phone)}?text=${encodeURIComponent(
                        `Bonjour ${o.clients.first_name}, votre commande ${o.reference} (${o.garment_type}) est en cours de finition chez ${business?.name ?? "votre atelier"}. Nous vous contacterons dès qu'elle sera prête.`,
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-success hover:bg-success/10"
                      title="Contacter par WhatsApp"
                    >
                      <MessageCircle className="size-3.5" />
                    </a>
                  )}
                  <Link
                    to="/commandes/$orderId"
                    params={{ orderId: o.id }}
                    className="text-sm font-medium text-primary"
                  >
                    Ouvrir
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ReminderRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className={`size-2.5 rounded-full ${color}`} />
      <span className="text-sm font-semibold">{label}</span>
      <span className="ml-auto text-sm text-muted-foreground">{value}</span>
    </div>
  );
}
