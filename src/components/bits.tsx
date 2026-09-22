import { useState, useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Coins,
  MessageCircle,
  PackageCheck,
  Phone,
  Scissors,
  Shirt,
  Sparkles,
  XCircle,
} from "lucide-react";

import { ORDER_STATUS, isLate, type OrderStatus } from "@/lib/domain";
import { fcfa, dateFr, fullName, waLink, cleanPhone } from "@/lib/format";
import { balance, type OrderRow } from "@/lib/queries";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

function StatusIcon({ status }: { status: OrderStatus }) {
  switch (status) {
    case "nouvelle":
      return <Sparkles className="size-3 shrink-0 text-amber-500" />;
    case "preparation":
      return <Scissors className="size-3 shrink-0 text-blue-500" />;
    case "confection":
      return <Shirt className="size-3 shrink-0 text-purple-500" />;
    case "finition":
      return <Sparkles className="size-3 shrink-0 text-orange-500" />;
    case "prete":
      return <CheckCircle2 className="size-3 shrink-0 text-emerald-600 font-bold" />;
    case "livree":
      return <PackageCheck className="size-3 shrink-0 text-emerald-700" />;
    case "annulee":
      return <XCircle className="size-3 shrink-0 text-rose-500" />;
    default:
      return null;
  }
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status] ?? ORDER_STATUS.annulee;
  return (
    <span className={`${s.chip} inline-flex items-center gap-1 font-semibold`}>
      <StatusIcon status={status} />
      <span>{s.label}</span>
    </span>
  );
}

export function LateBadge() {
  return (
    <span className="chip-late inline-flex items-center gap-1 font-semibold">
      <AlertTriangle className="size-3 shrink-0 animate-pulse text-destructive" />
      <span>En retard</span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  iconColor = "text-primary",
  iconBg = "bg-primary/10",
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
  icon?: React.ComponentType<{ className?: string }> | undefined;
  iconColor?: string | undefined;
  iconBg?: string | undefined;
}) {
  return (
    <div className="card-soft flex flex-col justify-between p-3 sm:p-4 transition-all hover:border-primary/40 hover:shadow-xs">
      <div className="flex items-center justify-between gap-1.5">
        <p className="truncate text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <span className={`flex size-7.5 shrink-0 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className="mt-2">
        <div className="font-display text-xl font-extrabold leading-none tracking-tight sm:text-2xl lg:text-3xl">
          {value}
        </div>
        {hint && (
          <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[0.65rem] font-semibold text-muted-foreground truncate">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="card-soft flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="font-display text-base font-semibold">{title}</p>
      {text && <p className="max-w-sm text-sm text-muted-foreground">{text}</p>}
      {action}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function ContactButtons({
  phone,
  whatsapp,
  message,
}: {
  phone?: string | null | undefined;
  whatsapp?: string | null | undefined;
  message?: string | undefined;
}) {
  const wa = waLink(whatsapp || phone, message);
  return (
    <div className="flex flex-wrap gap-2">
      {phone && (
        <a
          href={`tel:${phone.replace(/\s/g, "")}`}
          className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold hover:bg-muted active:scale-95 transition-all"
        >
          <Phone className="size-3.5 text-primary" /> Appeler
        </a>
      )}
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full bg-success px-3.5 py-1.5 text-xs font-semibold text-success-foreground hover:opacity-90 active:scale-95 transition-all shadow-xs"
        >
          <MessageCircle className="size-3.5" /> WhatsApp
        </a>
      )}
    </div>
  );
}

export function StoredImage({
  path,
  alt,
  className,
  fallback,
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    setLoadError(false);
  }, [path]);
  const isDirect = Boolean(
    path &&
      (path.startsWith("http://") ||
        path.startsWith("https://") ||
        path.startsWith("data:") ||
        path.startsWith("/")),
  );
  const { data, isLoading, isError } = useSignedUrl(isDirect ? null : path);
  const cls = className ?? "size-16 rounded-lg object-cover";

  if (!path) return fallback ? <>{fallback}</> : null;

  if (isDirect) {
    if (loadError) return fallback ? <>{fallback}</> : null;
    return (
      <img
        src={path}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setLoadError(true)}
        className={cls}
      />
    );
  }

  if (isLoading) return <Skeleton className={cls} />;
  if (isError || !data || loadError) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <img
      src={data}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setLoadError(true)}
      className={cls}
    />
  );
}

export function OrderCard({ order }: { order: OrderRow }) {
  const late = isLate(order);
  const due = balance(order);
  const client = order.clients;
  const clientPhone = cleanPhone(client?.whatsapp || client?.phone);

  return (
    <div className="card-soft list-card-fast flex flex-col justify-between p-3 sm:p-4 transition-all hover:border-primary/40 hover:shadow-xs">
      <Link
        to="/commandes/$orderId"
        params={{ orderId: order.id }}
        className="block min-w-0 flex-1 space-y-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Shirt className="size-4 shrink-0 text-primary" />
              <p className="truncate font-display text-sm font-bold text-foreground">
                {order.garment_type}
                {order.quantity > 1 ? ` ×${order.quantity}` : ""}
              </p>
            </div>
            <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
              {fullName(client)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge status={order.status} />
            {late && <LateBadge />}
          </div>
        </div>

        {/* Repères visuels clés avec icônes nettes */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground/80">
            {order.reference}
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3 text-muted-foreground" />
            {dateFr(order.due_date)}
          </span>
          <span className="inline-flex items-center gap-1 font-bold text-foreground">
            <Coins className="size-3 text-primary" />
            {fcfa(order.price)}
          </span>
          {due > 0 && (
            <span className="rounded-md bg-destructive/10 px-1.5 py-0.2 font-bold text-destructive text-[0.7rem]">
              Reste {fcfa(due)}
            </span>
          )}
        </div>
      </Link>

      {/* Actions rapides tactiles (Appel & WhatsApp) */}
      <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-border/70 pt-2">
        {clientPhone && (
          <>
            <a
              href={`tel:${clientPhone}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-7.5 items-center justify-center gap-1 rounded-lg border border-border px-2 text-[0.75rem] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
              title={`Appeler ${fullName(client)}`}
            >
              <Phone className="size-3 text-primary" />
              <span className="hidden xs:inline sm:hidden md:inline">Appel</span>
            </a>
            <a
              href={`https://wa.me/${clientPhone}?text=${encodeURIComponent(
                `Bonjour ${client?.first_name ?? ""}, concernant votre commande ${order.reference} (${order.garment_type})…`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-7.5 items-center gap-1 rounded-lg border border-success/30 bg-success/10 px-2 text-[0.75rem] font-semibold text-success transition-colors hover:bg-success/20 active:scale-95"
              title={`WhatsApp ${fullName(client)}`}
            >
              <MessageCircle className="size-3" />
              <span>WhatsApp</span>
            </a>
          </>
        )}
        <Button size="sm" variant="ghost" className="h-7.5 text-xs font-semibold px-2" asChild>
          <Link to="/commandes/$orderId" params={{ orderId: order.id }}>
            Détails →
          </Link>
        </Button>
      </div>
    </div>
  );
}
