import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
  Shirt,
  MessageCircle,
  BookOpen,
  Crown,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { fetchOrders, fetchAppointments, balance } from "@/lib/queries";
import { isActive, isLate, appointmentLabel } from "@/lib/domain";
import { fcfa, dateFr, dateLongFr, today, addDays, fullName, cleanPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, EmptyState, SectionTitle, OrderCard, LateBadge } from "@/components/bits";
import { UpgradeDialog } from "@/components/upgrade-dialog";

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

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const ordersThisMonth = all.filter((o) => (o.ordered_at ?? "").startsWith(currentMonthStr)).length;

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

      {/* Jauge des quotas pour le Plan Gratuit */}
      {(!business?.plan || business?.plan === "free") && (
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-extrabold text-primary-foreground">
                PLAN GRATUIT
              </span>
              <span className="text-xs text-muted-foreground font-medium">Formule d'essai atelier</span>
            </div>
            <p className="font-display text-sm font-bold text-foreground">
              {clientsCount.data ?? 0} / 10 clients enregistrés · {ordersThisMonth} / 10 commandes ce mois
            </p>
            <p className="text-xs text-muted-foreground">
              Passez à CouturPro pour débloquer l'illimité, les statistiques financières et les reçus WhatsApp.
            </p>
          </div>
          <Button
            onClick={() => setUpgradeOpen(true)}
            className="font-bold shrink-0 shadow-xs h-9 text-xs sm:text-sm"
          >
            <Crown className="mr-1.5 size-4" /> Passer à Pro (dès 2 500 F)
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Link to="/commandes" className="block transition-transform active:scale-95">
          <StatCard
            label="En cours"
            icon={Scissors}
            iconColor="text-orange-600"
            iconBg="bg-orange-500/15"
            value={orders.isLoading ? "…" : active.length}
            hint={late.length ? `${late.length} en retard` : undefined}
          />
        </Link>
        <Link to="/commandes" className="block transition-transform active:scale-95">
          <StatCard
            label="À livrer"
            icon={PackageCheck}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-500/15"
            value={toDeliver.length}
            hint="7 jours"
          />
        </Link>
        <Link to="/commandes" className="block transition-transform active:scale-95">
          <StatCard
            label="Atelier"
            icon={Shirt}
            iconColor="text-purple-600"
            iconBg="bg-purple-500/15"
            value={orders.isLoading ? "…" : inMaking.length}
            hint="en coupe"
          />
        </Link>
        <Link to="/clients" className="block transition-transform active:scale-95">
          <StatCard
            label="Clients"
            icon={Users}
            iconColor="text-blue-600"
            iconBg="bg-blue-500/15"
            value={clientsCount.isLoading ? "…" : clientsCount.data}
          />
        </Link>
        <Link to="/rendez-vous" className="block transition-transform active:scale-95">
          <StatCard
            label="RDV du jour"
            icon={CalendarDays}
            iconColor="text-indigo-600"
            iconBg="bg-indigo-500/15"
            value={todayAppts.length}
          />
        </Link>
        <div className="col-span-2 sm:col-span-1">
          <StatCard
            label="Reste à encaisser"
            icon={Wallet}
            iconColor="text-amber-600"
            iconBg="bg-amber-500/15"
            value={<span className="text-base font-extrabold sm:text-lg lg:text-xl">{fcfa(outstanding, business?.currency)}</span>}
          />
        </div>
      </div>

      {/* Raccourcis 1-clic iconographiques */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
        <Button asChild size="default" className="h-11 justify-start text-xs sm:text-sm font-bold shadow-xs">
          <Link to="/commandes/nouvelle">
            <Plus className="mr-1.5 size-4.5 shrink-0" /> Commande
          </Link>
        </Button>
        <Button asChild size="default" variant="secondary" className="h-11 justify-start text-xs sm:text-sm font-bold">
          <Link to="/catalogue">
            <BookOpen className="mr-1.5 size-4.5 shrink-0 text-primary" /> Lookbook
          </Link>
        </Button>
        <Button asChild size="default" variant="outline" className="h-11 justify-start text-xs sm:text-sm font-bold">
          <Link to="/clients" search={{ nouveau: true }}>
            <UserPlus className="mr-1.5 size-4.5 shrink-0 text-blue-600" /> Client
          </Link>
        </Button>
        <Button asChild size="default" variant="outline" className="h-11 justify-start text-xs sm:text-sm font-bold">
          <Link to="/rendez-vous" search={{ nouveau: true }}>
            <CalendarPlus className="mr-1.5 size-4.5 shrink-0 text-indigo-600" /> RDV
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

      <section className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle
            action={
              <Link to="/rendez-vous" className="text-xs font-semibold text-primary hover:underline">
                Agenda →
              </Link>
            }
          >
            Rappels
          </SectionTitle>
          <div className="card-soft divide-y divide-border/70">
            <ReminderRow
              color="bg-destructive"
              label="Aujourd'hui"
              value={`${todayAppts.length} RDV`}
            />
            <ReminderRow
              color="bg-warning"
              label="Demain"
              value={`${tomorrowAppts.length} RDV`}
            />
            <ReminderRow
              color="bg-success"
              label="Cette semaine"
              value={`${weekDeliveries.length} livraisons`}
            />
            {late.length > 0 && (
              <ReminderRow
                color="bg-destructive"
                label="Retards"
                value={`${late.length} commande(s)`}
              />
            )}
          </div>
        </div>

        <div>
          <SectionTitle>RDV du jour</SectionTitle>
          {todayAppts.length === 0 ? (
            <div className="card-soft p-5 text-center text-xs text-muted-foreground">
              Aucun rendez-vous planifié aujourd'hui
            </div>
          ) : (
            <div className="space-y-2">
              {todayAppts.map((a) => (
                <div key={a.id} className="card-soft flex items-center justify-between gap-2.5 p-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="rounded-lg bg-primary/10 px-2 py-1 font-display text-xs font-bold text-primary shrink-0">
                      {a.scheduled_time?.slice(0, 5) ?? "--:--"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs sm:text-sm font-semibold">{fullName(a.clients)}</p>
                      <p className="text-[0.7rem] text-muted-foreground">{appointmentLabel(a.type)}</p>
                    </div>
                  </div>

                  {a.clients?.phone && (
                    <a
                      href={`https://wa.me/${cleanPhone(a.clients.whatsapp || a.clients.phone)}?text=${encodeURIComponent(
                        `Bonjour ${a.clients.first_name}, rappel de votre rendez-vous de ${appointmentLabel(a.type)} aujourd'hui à ${a.scheduled_time?.slice(0, 5) ?? ""} chez ${business?.name ?? "votre atelier"}.`,
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7.5 items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 text-[0.7rem] font-semibold text-success hover:bg-success/20 shrink-0 active:scale-95 transition-all"
                      title="Rappeler par WhatsApp"
                    >
                      <MessageCircle className="size-3" /> WhatsApp
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
          <div className="space-y-2">
            {late.map((o) => (
              <div key={o.id} className="card-soft flex items-center justify-between gap-2.5 p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs sm:text-sm font-semibold">
                    {o.garment_type} — {fullName(o.clients)}
                  </p>
                  <p className="text-[0.7rem] text-muted-foreground">
                    Prévue le {dateFr(o.due_date)} · <span className="font-mono">{o.reference}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <LateBadge />
                  {o.clients?.phone && (
                    <a
                      href={`https://wa.me/${cleanPhone(o.clients.whatsapp || o.clients.phone)}?text=${encodeURIComponent(
                        `Bonjour ${o.clients.first_name}, votre commande ${o.reference} (${o.garment_type}) est en cours de confection chez ${business?.name ?? "votre atelier"}.`,
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7.5 items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 text-[0.7rem] font-semibold text-success hover:bg-success/20 active:scale-95"
                      title="Contacter par WhatsApp"
                    >
                      <MessageCircle className="size-3" />
                    </a>
                  )}
                  <Link
                    to="/commandes/$orderId"
                    params={{ orderId: o.id }}
                    className="inline-flex h-7.5 items-center px-2 text-xs font-semibold text-primary hover:underline"
                  >
                    Voir →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Modale d'abonnement / passage à Pro */}
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
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
