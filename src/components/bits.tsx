import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, MessageCircle, Phone } from "lucide-react";

import { ORDER_STATUS, isLate, type OrderStatus } from "@/lib/domain";
import { fcfa, dateFr, fullName, waLink } from "@/lib/format";
import { balance, type OrderRow } from "@/lib/queries";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { Skeleton } from "@/components/ui/skeleton";

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status] ?? ORDER_STATUS.annulee;
  return <span className={s.chip}>{s.label}</span>;
}

export function LateBadge() {
  return (
    <span className="chip-late">
      <AlertTriangle className="size-3" /> En retard
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
  icon?: React.ComponentType<{ className?: string }> | undefined;
}) {
  return (
    <div className="card-soft h-full p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-primary" />}
      </div>
      <p className="mt-2 font-display text-2xl font-bold leading-none">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
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
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          <Phone className="size-3.5" /> Appeler
        </a>
      )}
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-success-foreground hover:opacity-90"
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
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const { data, isLoading } = useSignedUrl(path);
  const cls = className ?? "size-16 rounded-lg object-cover";
  if (!path) return null;
  if (isLoading || !data) return <Skeleton className={cls} />;
  return <img src={data} alt={alt} loading="lazy" className={cls} />;
}

export function OrderCard({ order }: { order: OrderRow }) {
  const late = isLate(order);
  const due = balance(order);
  return (
    <Link
      to="/commandes/$orderId"
      params={{ orderId: order.id }}
      className="card-soft block p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold">
            {order.garment_type}
            {order.quantity > 1 ? ` ×${order.quantity}` : ""}
          </p>
          <p className="truncate text-sm text-muted-foreground">{fullName(order.clients)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={order.status} />
          {late && <LateBadge />}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{order.reference}</span>
        <span>Livraison : {dateFr(order.due_date)}</span>
        <span className="font-semibold text-foreground">{fcfa(order.price)}</span>
        {due > 0 && <span className="font-semibold text-primary">Reste {fcfa(due)}</span>}
      </div>
    </Link>
  );
}
