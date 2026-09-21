import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Edit,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Printer,
  Ruler,
  Trash2,
  Truck,
  User,
  XCircle,
  ChevronRight,
  Upload,
  MessageCircle,
  Scissors,
  Shirt,
  Sparkles,
  PackageCheck,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/hooks/use-business";
import { uploadImage, deleteStorageFile } from "@/hooks/use-signed-url";
import {
  fetchOrder,
  fetchPayments,
  fetchOrderImages,
  fetchClient,
  fetchMeasurementSets,
  fetchGarmentTypes,
  deleteOrderCascade,
} from "@/lib/queries";
import {
  ORDER_STATUS,
  ORDER_FLOW,
  PAYMENT_METHODS,
  IMAGE_KINDS,
  paymentLabel,
  isLate,
  type OrderStatus,
} from "@/lib/domain";
import {
  fcfa,
  dateFr,
  dateLongFr,
  fullName,
  today,
  initials,
  cleanPhone,
} from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MeasurementDialog } from "@/components/measurement-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  EmptyState,
  StatusBadge,
  LateBadge,
  StoredImage,
  ContactButtons,
  SectionTitle,
} from "@/components/bits";

export const Route = createFileRoute("/_authenticated/commandes/$orderId")({
  head: () => ({
    meta: [
      { title: "Détail de la commande — CouturPro" },
      {
        name: "description",
        content:
          "Suivi de commande, avancement de confection, paiements, livraisons et bon de commande.",
      },
      { property: "og:title", content: "Détail de la commande — CouturPro" },
      { property: "og:description", content: "Gestion complète d'une commande d'atelier." },
    ],
  }),
  component: OrderDetailPage,
});

function OrderDetailPage() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: business } = useBusiness();

  // Modals state
  const [openPaymentModal, setOpenPaymentModal] = useState(false);
  const [openDeliveryModal, setOpenDeliveryModal] = useState(false);
  const [openEditModal, setOpenEditModal] = useState(false);
  const [openDeleteModal, setOpenDeleteModal] = useState(false);
  const [openReceiptModal, setOpenReceiptModal] = useState(false);
  const [openMeasureModal, setOpenMeasureModal] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageKind, setImageKind] = useState("modele");

  // Queries
  const orderQuery = useQuery({
    queryKey: ["order", orderId, business?.id],
    queryFn: () => fetchOrder(orderId, business?.id),
    enabled: Boolean(orderId && business?.id),
  });

  const paymentsQuery = useQuery({
    queryKey: ["payments", orderId, business?.id],
    queryFn: () => fetchPayments(orderId, business?.id),
    enabled: Boolean(orderId && business?.id),
  });

  const imagesQuery = useQuery({
    queryKey: ["order-images", orderId, business?.id],
    queryFn: () => fetchOrderImages(orderId, business?.id),
    enabled: Boolean(orderId && business?.id),
  });

  const order = orderQuery.data;
  const clientId = order?.client_id;

  const clientQuery = useQuery({
    queryKey: ["client", clientId, business?.id],
    queryFn: () => fetchClient(clientId!, business?.id),
    enabled: Boolean(clientId && business?.id),
  });

  const measuresQuery = useQuery({
    queryKey: ["measurements", clientId, business?.id],
    queryFn: () => fetchMeasurementSets(clientId!, business?.id),
    enabled: Boolean(clientId && business?.id),
  });

  // Calculate finances
  const payments = paymentsQuery.data ?? [];
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalPrice = Number(order?.price ?? 0);
  const balanceDue = totalPrice - totalPaid;
  const client = clientQuery.data;

  // WhatsApp Helpers
  function shareReceiptViaWhatsApp() {
    if (!order || !client) return;
    const phone = cleanPhone(client.whatsapp || client.phone || "");
    const atelier = business?.name ?? "votre atelier";
    const msg =
      `🧾 *REÇU DE COMMANDE — ${atelier.toUpperCase()}*\n\n` +
      `Commande : *${order.reference}*\n` +
      `Client : *${fullName(client)}*\n` +
      `Vêtement : *${order.garment_type}*${order.quantity > 1 ? ` (×${order.quantity})` : ""}\n` +
      (order.fabric ? `Tissu : ${order.fabric}\n` : "") +
      `Prix total : *${fcfa(totalPrice, business?.currency)}*\n` +
      `Total versé : ${fcfa(totalPaid, business?.currency)}\n` +
      `Solde restant : *${fcfa(balanceDue, business?.currency)}*\n` +
      `Livraison prévue : *${dateFr(order.due_date)}*\n\n` +
      (business?.receipt_note ? `_${business.receipt_note}_\n\n` : "") +
      `Merci pour votre confiance ! ✂️`;

    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  function notifyReadyViaWhatsApp() {
    if (!order || !client) return;
    const phone = cleanPhone(client.whatsapp || client.phone || "");
    const atelier = business?.name ?? "votre atelier";
    const msg =
      `Bonjour *${client.first_name}*,\n\n` +
      `Votre vêtement (*${order.garment_type}* - ${order.reference}) est *prêt* chez *${atelier}* ! 🎉\n\n` +
      (balanceDue > 0
        ? `Solde restant à régler : *${fcfa(balanceDue, business?.currency)}*\n\n`
        : "Commande entièrement réglée ✅\n\n") +
      `Vous pouvez passer à l'atelier pour l'essayage ou la récupération.\nÀ très bientôt ! ✂️`;

    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  // Delete Payment Mutation
  const deletePaymentMutation = useMutation({
    mutationFn: async (pId: string) => {
      const { error } = await supabase.from("payments").delete().eq("id", pId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Paiement supprimé");
      setDeletingPaymentId(null);
    },
    onError: () => toast.error("Impossible de supprimer le paiement"),
  });

  // Cancel Order Mutation
  const cancelOrderMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("orders")
        .update({ status: "annulee" })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Commande marquée comme annulée");
      setCancelOrderOpen(false);
    },
    onError: () => toast.error("Impossible d'annuler la commande"),
  });

  // Status updates
  const updateStatusMutation = useMutation({
    mutationFn: async ({
      status,
      delivered_at,
      delivered_to,
      delivery_note,
    }: {
      status: OrderStatus;
      delivered_at?: string | null;
      delivered_to?: string | null;
      delivery_note?: string | null;
    }) => {
      const payload: {
        status: OrderStatus;
        delivered_at?: string | null;
        delivered_to?: string | null;
        delivery_note?: string | null;
      } = { status };
      if (status === "livree") {
        payload.delivered_at = delivered_at || today();
        payload.delivered_to = delivered_to || null;
        payload.delivery_note = delivery_note || null;
      }
      const { error } = await supabase.from("orders").update(payload).eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Statut de la commande mis à jour");
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error("Impossible de modifier le statut", { description: msg });
    },
  });

  // Delete Order
  const deleteOrderMutation = useMutation({
    mutationFn: async () => {
      await deleteOrderCascade(orderId, business?.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Commande supprimée avec succès");
      navigate({ to: "/commandes" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Suppression impossible";
      toast.error(`Erreur : ${msg}`);
    },
  });

  // Upload Photo
  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !business) return;
    setUploadingImage(true);
    try {
      const path = await uploadImage(business.id, file, "orders");
      const { error } = await supabase.from("order_images").insert({
        business_id: business.id,
        order_id: orderId,
        path,
        kind: imageKind,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["order-images", orderId] });
      toast.success("Photo ajoutée");
    } catch {
      toast.error("Échec de l'envoi de la photo");
    } finally {
      setUploadingImage(false);
      e.target.value = "";
    }
  }

  // Delete Photo
  const deleteImageMutation = useMutation({
    mutationFn: async (imgId: string) => {
      // Récupère le path Storage avant suppression pour nettoyage physique
      const image = imagesQuery.data?.find((img) => img.id === imgId);
      // Supprime d'abord le fichier physique dans le bucket
      if (image?.path) {
        await deleteStorageFile(image.path);
      }
      // Puis supprime la ligne en base
      const { error } = await supabase.from("order_images").delete().eq("id", imgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-images", orderId] });
      toast.success("Photo retirée");
    },
    onError: () => toast.error("Impossible de supprimer la photo"),
  });

  if (orderQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-md py-12">
        <EmptyState
          title="Commande introuvable"
          text="Cette commande n'existe pas ou a été supprimée."
          action={
            <Button asChild>
              <Link to="/commandes">Retour aux commandes</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const isOrderLate = isLate(order);
  const currentIndex = ORDER_FLOW.indexOf(order.status as OrderStatus);
  const nextStatus = currentIndex >= 0 && currentIndex < ORDER_FLOW.length - 1 ? ORDER_FLOW[currentIndex + 1] : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Navigation top */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2.5">
        <Link
          to="/commandes"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Commandes
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpenReceiptModal(true)}
            className="h-8 text-xs font-medium px-2.5 sm:px-3"
          >
            <Printer className="mr-1.5 size-3.5" />
            <span className="hidden sm:inline">Bon de commande / </span>Reçu
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpenEditModal(true)}
            className="h-8 text-xs font-medium px-2.5 sm:px-3"
          >
            <Edit className="mr-1.5 size-3.5" /> Modifier
          </Button>
          {order.status !== "annulee" && order.status !== "livree" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2 sm:px-2.5"
              onClick={() => setCancelOrderOpen(true)}
              title="Annuler la commande"
            >
              <XCircle className="size-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Annuler</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0 text-destructive hover:bg-destructive/10"
            onClick={() => setOpenDeleteModal(true)}
            title="Supprimer"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Bannière alerte quand le vêtement est prêt */}
      {order.status === "prete" && (
        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/40 bg-success/10 p-3.5 sm:p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-success text-success-foreground font-bold shrink-0">
              <CheckCircle2 className="size-5" />
            </span>
            <div>
              <p className="font-display text-xs sm:text-sm font-bold text-foreground">
                Ce vêtement est prêt pour l'essayage ou le retrait !
              </p>
              <p className="text-[0.7rem] sm:text-xs text-muted-foreground">
                Avertissez votre client par message WhatsApp pour convenir d'un rendez-vous.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="h-8.5 font-bold text-xs bg-success text-success-foreground hover:bg-success/90"
            onClick={notifyReadyViaWhatsApp}
          >
            <MessageCircle className="mr-1.5 size-3.5" /> Alerter WhatsApp
          </Button>
        </div>
      )}

      {/* Hero Header Card */}
      <header className="no-print card-soft p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {order.reference}
              </span>
              <StatusBadge status={order.status} />
              {isOrderLate && <LateBadge />}
            </div>
            <h1 className="mt-1.5 font-display text-xl font-bold sm:text-3xl text-foreground">
              {order.garment_type}
              {order.quantity > 1 ? ` (×${order.quantity})` : ""}
            </h1>
            {order.fabric && (
              <p className="mt-0.5 text-xs sm:text-sm font-medium text-muted-foreground">
                Tissu : <span className="font-semibold text-foreground">{order.fabric}</span>
              </p>
            )}
          </div>

          {/* Quick Balance Status */}
          <div className="rounded-2xl border border-border/60 bg-muted/40 p-3 sm:p-4 text-left sm:text-right sm:min-w-[12rem] flex sm:flex-col justify-between items-center sm:items-end">
            <div>
              <p className="text-[0.65rem] sm:text-xs uppercase tracking-wide text-muted-foreground">Solde commande</p>
              <p className="font-display text-lg sm:text-2xl font-bold text-foreground">
                {fcfa(totalPrice, business?.currency)}
              </p>
            </div>
            <div className="text-right">
              {balanceDue <= 0 ? (
                <span className="inline-block rounded-full bg-success/15 px-2 py-0.5 text-xs font-bold text-success">Payée ✅</span>
              ) : (
                <span className="inline-block rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">
                  Reste : {fcfa(balanceDue, business?.currency)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Workflow Pipeline Progression Stepper */}
        <div className="mt-6 border-t border-border pt-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Progression de la confection
            </span>
            {order.status !== "livree" && order.status !== "annulee" && nextStatus && (
              <Button
                size="sm"
                onClick={() => {
                  if (nextStatus === "livree") {
                    setOpenDeliveryModal(true);
                  } else {
                    updateStatusMutation.mutate({ status: nextStatus });
                  }
                }}
                disabled={updateStatusMutation.isPending}
              >
                Passer à : {ORDER_STATUS[nextStatus].label}
                <ChevronRight className="ml-1 size-4" />
              </Button>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-1.5 overflow-x-auto pb-2">
            {ORDER_FLOW.map((flowStatus, idx) => {
              const isPast = currentIndex > idx;
              const isCurrent = currentIndex === idx;
              const StepIcon =
                flowStatus === "nouvelle"
                  ? Sparkles
                  : flowStatus === "preparation"
                  ? Scissors
                  : flowStatus === "confection"
                  ? Shirt
                  : flowStatus === "finition"
                  ? Sparkles
                  : flowStatus === "prete"
                  ? CheckCircle2
                  : PackageCheck;

              return (
                <button
                  key={flowStatus}
                  type="button"
                  onClick={() => {
                    if (flowStatus === "livree") {
                      setOpenDeliveryModal(true);
                    } else {
                      updateStatusMutation.mutate({ status: flowStatus });
                    }
                  }}
                  className={`flex flex-1 min-w-[5.25rem] flex-col items-center rounded-xl p-2.5 text-center transition-all active:scale-95 ${
                    isCurrent
                      ? "bg-primary/15 font-bold text-primary ring-2 ring-primary/40 shadow-xs"
                      : isPast
                      ? "text-foreground hover:bg-muted"
                      : "text-muted-foreground opacity-50 hover:opacity-80"
                  }`}
                >
                  <div
                    className={`flex size-8 items-center justify-center rounded-full transition-transform ${
                      isPast
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                        ? "bg-primary text-primary-foreground font-bold shadow-xs scale-105"
                        : "border border-border bg-card text-muted-foreground"
                    }`}
                  >
                    <StepIcon className="size-4" />
                  </div>
                  <span className="mt-1.5 text-[0.72rem] leading-tight font-semibold">
                    {ORDER_STATUS[flowStatus].label}
                  </span>
                </button>
              );
            })}
          </div>

          {order.status === "annulee" && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="size-4 shrink-0" /> Commande annulée.
              <Button
                variant="outline"
                size="sm"
                className="ml-auto text-xs"
                onClick={() => updateStatusMutation.mutate({ status: "nouvelle" })}
              >
                Réactiver
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Grid: Client & Dates */}
      <div className="no-print grid gap-6 md:grid-cols-2">
        {/* Client Card */}
        <section className="card-soft flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-display text-sm font-bold text-muted-foreground uppercase tracking-wider">
                <User className="size-4 text-primary" /> Client
              </span>
              {client && (
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: client.id }}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Voir la fiche
                </Link>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3">
              {client?.photo_url ? (
                <StoredImage
                  path={client.photo_url}
                  alt={fullName(client)}
                  className="size-14 shrink-0 rounded-2xl object-cover"
                />
              ) : (
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-secondary font-display text-base font-bold text-secondary-foreground">
                  {initials(client?.first_name, client?.last_name)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-display text-base font-bold">
                  {client ? fullName(client) : fullName(order.clients)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {client?.phone || order.clients?.phone || "Sans téléphone"}
                  {client?.city ? ` · ${client.city}` : ""}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3 border-t border-border pt-4">
            <ContactButtons
              phone={client?.phone || order.clients?.phone}
              whatsapp={client?.whatsapp || order.clients?.whatsapp}
              message={`Bonjour ${client?.first_name || "client"}, c'est ${
                business?.name || "votre atelier"
              } concernant votre commande ${order.reference} (${order.garment_type}).`}
            />

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-xs font-semibold"
              onClick={() => setOpenMeasureModal(true)}
            >
              <Ruler className="mr-2 size-3.5 text-primary" />
              Consulter les mesures du client
              {measuresQuery.data && measuresQuery.data.length > 0 && (
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[0.65rem]">
                  {measuresQuery.data.length} relevé(s)
                </span>
              )}
            </Button>
          </div>
        </section>

        {/* Order Details & Dates Card */}
        <section className="card-soft space-y-4 p-5">
          <span className="flex items-center gap-2 font-display text-sm font-bold text-muted-foreground uppercase tracking-wider">
            <Calendar className="size-4 text-primary" /> Délais & Informations
          </span>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-surface p-3">
              <dt className="text-xs text-muted-foreground">Date de commande</dt>
              <dd className="mt-1 font-semibold">{dateFr(order.ordered_at)}</dd>
            </div>
            <div
              className={`rounded-xl p-3 ${
                isOrderLate ? "bg-destructive/10 text-destructive" : "bg-surface"
              }`}
            >
              <dt className="text-xs text-muted-foreground">Livraison prévue</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-bold">
                {dateFr(order.due_date)}
                {isOrderLate && <span className="text-[0.65rem] font-extrabold uppercase">⚠️ Retard</span>}
              </dd>
            </div>
          </dl>

          {order.description && (
            <div className="rounded-xl bg-surface p-3.5 text-xs">
              <span className="font-semibold text-muted-foreground uppercase tracking-wide">
                Instructions / Style du modèle :
              </span>
              <p className="mt-1 text-foreground whitespace-pre-wrap">{order.description}</p>
            </div>
          )}

          {order.notes && (
            <div className="rounded-xl bg-surface p-3.5 text-xs">
              <span className="font-semibold text-muted-foreground uppercase tracking-wide">
                Notes d'atelier :
              </span>
              <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}

          {order.status === "livree" && (
            <div className="rounded-xl border border-success/30 bg-success/10 p-3.5 text-xs">
              <p className="flex items-center gap-1.5 font-bold text-success">
                <Truck className="size-4" /> Vêtement livré le {dateFr(order.delivered_at)}
              </p>
              {order.delivered_to && (
                <p className="mt-1 text-muted-foreground">
                  Récupéré par : <strong className="text-foreground">{order.delivered_to}</strong>
                </p>
              )}
              {order.delivery_note && (
                <p className="mt-1 text-muted-foreground">Note : {order.delivery_note}</p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Payments Section */}
      <section className="no-print card-soft p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionTitle>Paiements & Règlements</SectionTitle>
            <p className="text-xs text-muted-foreground">
              Suivi des acomptes, versements échelonnés et solde final.
            </p>
          </div>
          <Button size="sm" onClick={() => setOpenPaymentModal(true)}>
            <Plus className="size-4" /> Enregistrer un paiement
          </Button>
        </div>

        {/* Financial Recap Bar */}
        <div className="mt-4 grid grid-cols-3 gap-2.5 rounded-2xl bg-surface p-3.5 text-center sm:gap-4 sm:p-4">
          <div>
            <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">Prix Total</p>
            <p className="mt-1 font-display text-base font-bold sm:text-xl">
              {fcfa(totalPrice, business?.currency)}
            </p>
          </div>
          <div>
            <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">Total Versé</p>
            <p className="mt-1 font-display text-base font-bold text-success sm:text-xl">
              {fcfa(totalPaid, business?.currency)}
            </p>
          </div>
          <div>
            <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">Reste à payer</p>
            <p
              className={`mt-1 font-display text-base font-bold sm:text-xl ${
                balanceDue > 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {fcfa(balanceDue, business?.currency)}
            </p>
          </div>
        </div>

        {/* Payments List */}
        <div className="mt-5 space-y-2.5">
          {payments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
              Aucun paiement enregistré pour le moment.
            </div>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/30"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-success/15 font-bold text-success">
                    <DollarSign className="size-4" />
                  </div>
                  <div>
                    <p className="font-display text-sm font-bold text-foreground">
                      {fcfa(p.amount, business?.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {paymentLabel(p.method)} · {dateFr(p.paid_at)}
                      {p.note ? ` (${p.note})` : ""}
                    </p>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeletingPaymentId(p.id)}
                  aria-label="Supprimer le versement"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Photos & Model Attachments */}
      <section className="no-print card-soft p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionTitle>Photos du modèle, tissu & croquis</SectionTitle>
            <p className="text-xs text-muted-foreground">
              Gardez une référence visuelle pour éviter toute confusion lors de la coupe.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={imageKind}
              onChange={(e) => setImageKind(e.target.value)}
              className="h-9 rounded-md border border-input bg-card px-2.5 text-xs font-medium"
              aria-label="Catégorie de photo"
            >
              {IMAGE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90">
              {uploadingImage ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Ajouter photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingImage}
                onChange={handlePhotoUpload}
              />
            </label>
          </div>
        </div>

        <div className="mt-5">
          {(imagesQuery.data ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
              <ImageIcon className="mx-auto mb-2 size-8 text-muted-foreground/60" />
              Aucune photo enregistrée pour ce modèle.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {(imagesQuery.data ?? []).map((img) => (
                <div
                  key={img.id}
                  className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                >
                  <StoredImage
                    path={img.path}
                    alt={img.caption || img.kind}
                    className="h-36 w-full object-cover"
                  />
                  <div className="flex items-center justify-between p-2 text-xs">
                    <span className="truncate rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
                      {IMAGE_KINDS.find((k) => k.value === img.kind)?.label ?? img.kind}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteImageMutation.mutate(img.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Supprimer la photo"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ========================================================================= */}
      {/* MODAL 1: Enregistrer un paiement                                          */}
      {/* ========================================================================= */}
      <Dialog open={openPaymentModal} onOpenChange={setOpenPaymentModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enregistrer un versement</DialogTitle>
            <DialogDescription>
              Enregistrez un acompte ou le paiement final de cette commande.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const amount = Number(fd.get("amount"));
              if (!amount || amount <= 0) {
                toast.error("Veuillez saisir un montant valide");
                return;
              }
              if (!business?.id) {
                toast.error("Atelier non initialisé");
                return;
              }
              const { error } = await supabase.from("payments").insert({
                business_id: business.id,
                order_id: orderId,
                amount,
                method: String(fd.get("method") || "especes"),
                paid_at: String(fd.get("paid_at") || today()),
                note: String(fd.get("note") || ""),
              });
              if (error) {
                toast.error("Erreur lors de l'enregistrement du paiement");
                return;
              }
              queryClient.invalidateQueries({ queryKey: ["payments", orderId] });
              queryClient.invalidateQueries({ queryKey: ["order", orderId] });
              queryClient.invalidateQueries({ queryKey: ["orders"] });
              toast.success("Paiement enregistré avec succès");
              setOpenPaymentModal(false);
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Montant (FCFA) *</Label>
              <Input
                id="pay-amount"
                name="amount"
                type="number"
                min={1}
                defaultValue={balanceDue > 0 ? balanceDue : ""}
                required
                inputMode="numeric"
              />
              {balanceDue > 0 && (
                <p className="text-[0.7rem] text-muted-foreground">
                  Reste à payer : <strong>{fcfa(balanceDue, business?.currency)}</strong>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pay-method">Moyen de paiement</Label>
                <select
                  id="pay-method"
                  name="method"
                  defaultValue="especes"
                  className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-date">Date</Label>
                <Input id="pay-date" name="paid_at" type="date" defaultValue={today()} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-note">Note / Référence (optionnel)</Label>
              <Input
                id="pay-note"
                name="note"
                placeholder="Ex. Acompte essayage, Orange Money #TX123..."
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpenPaymentModal(false)}>
                Annuler
              </Button>
              <Button type="submit">Valider le paiement</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL 2: Valider la livraison                                             */}
      {/* ========================================================================= */}
      <Dialog open={openDeliveryModal} onOpenChange={setOpenDeliveryModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Marquer la commande comme livrée</DialogTitle>
            <DialogDescription>
              Indiquez la date de remise du vêtement et le nom de la personne ayant récupéré.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              updateStatusMutation.mutate({
                status: "livree",
                delivered_at: String(fd.get("delivered_at") || today()),
                delivered_to: String(fd.get("delivered_to") || ""),
                delivery_note: String(fd.get("delivery_note") || ""),
              });
              setOpenDeliveryModal(false);
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="del-date">Date de livraison</Label>
              <Input id="del-date" name="delivered_at" type="date" defaultValue={today()} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="del-to">Récupéré par</Label>
              <Input
                id="del-to"
                name="delivered_to"
                defaultValue={client ? fullName(client) : ""}
                placeholder="Le client en personne, un proche..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="del-note">Remarques éventuelles</Label>
              <Textarea
                id="del-note"
                name="delivery_note"
                rows={2}
                placeholder="Essayé avant retrait, satisfait..."
              />
            </div>

            {balanceDue > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="mb-1 size-4" />
                Attention : il reste encore{" "}
                <strong>{fcfa(balanceDue, business?.currency)}</strong> à encaisser sur cette
                commande.
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpenDeliveryModal(false)}>
                Annuler
              </Button>
              <Button type="submit">Confirmer la livraison</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL 3: Modifier la commande                                             */}
      {/* ========================================================================= */}
      <EditOrderDialog
        open={openEditModal}
        onOpenChange={setOpenEditModal}
        order={order}
        onUpdated={() => {
          queryClient.invalidateQueries({ queryKey: ["order", orderId] });
          queryClient.invalidateQueries({ queryKey: ["orders"] });
        }}
      />

      {/* ========================================================================= */}
      {/* MODAL 4: Confirmer la suppression                                        */}
      {/* ========================================================================= */}
      <AlertDialog open={openDeleteModal} onOpenChange={setOpenDeleteModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer définitivement cette commande ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La commande {order.reference}, ses photos et ses
              paiements associés seront supprimés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteOrderMutation.mutate()}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation suppression paiement */}
      <AlertDialog
        open={Boolean(deletingPaymentId)}
        onOpenChange={(v) => !v && setDeletingPaymentId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce versement ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ce paiement sera supprimé des enregistrements de la commande et le reste à payer sera
              recalculé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletingPaymentId) deletePaymentMutation.mutate(deletingPaymentId);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation annulation commande */}
      <AlertDialog open={cancelOrderOpen} onOpenChange={setCancelOrderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette commande ?</AlertDialogTitle>
            <AlertDialogDescription>
              La commande {order.reference} passera au statut « Annulée ». Vous pourrez toujours
              consulter ses informations et son historique.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Retour</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelOrderMutation.mutate()}
            >
              Annuler la commande
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ========================================================================= */}
      {/* MODAL 5: Mesures du client (Quick View)                                  */}
      {/* ========================================================================= */}
      <Dialog open={openMeasureModal} onOpenChange={setOpenMeasureModal}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Carnet de mesures de {client ? fullName(client) : "Client"}</DialogTitle>
            <DialogDescription>
              Mesures corporelles enregistrées pour la confection.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {(measuresQuery.data ?? []).length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Aucun relevé de mesures trouvé pour ce client.
                {client && (
                  <div className="mt-3">
                    <Button asChild size="sm">
                      <Link to="/clients/$clientId" params={{ clientId: client.id }}>
                        Prendre les mesures
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              (measuresQuery.data ?? []).map((set) => (
                <div key={set.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-display text-sm font-semibold">
                        Relevé du {dateFr(set.recorded_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">{set.label || "Mesures"}</p>
                    </div>
                    <Ruler className="size-4 text-primary" />
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-2 text-xs">
                    {(set.measurement_values ?? [])
                      .sort((a, b) => a.position - b.position)
                      .map((val) => (
                        <div key={val.id} className="flex justify-between border-b border-dashed border-border py-1">
                          <dt className="text-muted-foreground">{val.name}</dt>
                          <dd className="font-bold">
                            {val.value ?? "—"} {val.value !== null ? val.unit : ""}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenMeasureModal(false)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL 6: Reçu / Bon de commande imprimable                                */}
      {/* ========================================================================= */}
      <Dialog open={openReceiptModal} onOpenChange={setOpenReceiptModal}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bon de commande & Reçu d'atelier</DialogTitle>
            <DialogDescription>
              Document officiel prêt à être imprimé ou partagé avec le client.
            </DialogDescription>
          </DialogHeader>

          {/* Receipt Preview Component */}
          <div className="rounded-xl border border-border bg-white p-6 text-black shadow-sm" id="printable-receipt">
            {/* Atelier Header */}
            <div className="flex items-start justify-between border-b pb-4">
              <div className="flex items-start gap-3">
                {business?.logo_url && (
                  <StoredImage
                    path={business.logo_url}
                    alt="Logo atelier"
                    className="size-14 rounded-lg object-cover shrink-0 border border-neutral-200"
                  />
                )}
                <div>
                  <h2 className="font-display text-xl font-bold uppercase tracking-tight text-neutral-900">
                    {business?.name || "Atelier de Couture"}
                  </h2>
                  {business?.owner_name && (
                    <p className="text-xs text-neutral-600">Dirigé par {business.owner_name}</p>
                  )}
                  {business?.phone && (
                    <p className="text-xs text-neutral-600">📞 Tél : {business.phone}</p>
                  )}
                  {business?.city && (
                    <p className="text-xs text-neutral-600">
                      📍 {business.address ? `${business.address}, ` : ""}
                      {business.city}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs font-bold text-neutral-800">
                  {order.reference}
                </span>
                <p className="mt-1 text-xs text-neutral-500">Date : {dateFr(order.ordered_at)}</p>
              </div>
            </div>

            {/* Client Info Block */}
            <div className="my-4 rounded-lg bg-neutral-50 p-3 text-xs">
              <p className="font-bold text-neutral-800">CLIENT :</p>
              <p className="text-sm font-semibold text-neutral-900">
                {client ? fullName(client) : fullName(order.clients)}
              </p>
              <p className="text-neutral-600">
                Téléphone : {client?.phone || order.clients?.phone || "—"}
              </p>
            </div>

            {/* Order Items Table */}
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-neutral-100 font-semibold text-neutral-700">
                  <th className="p-2">Désignation</th>
                  <th className="p-2 text-center">Qté</th>
                  <th className="p-2 text-right">Prix</th>
                </tr>
              </thead>
              <tbody className="divide-y text-neutral-800">
                <tr>
                  <td className="p-2">
                    <p className="font-bold">{order.garment_type}</p>
                    {order.fabric && <p className="text-[0.7rem] text-neutral-500">Tissu : {order.fabric}</p>}
                    {order.description && (
                      <p className="text-[0.7rem] text-neutral-500 line-clamp-2">{order.description}</p>
                    )}
                  </td>
                  <td className="p-2 text-center">{order.quantity}</td>
                  <td className="p-2 text-right font-semibold">
                    {fcfa(totalPrice, business?.currency)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Financial Summary */}
            <div className="mt-4 border-t pt-3">
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between font-semibold">
                  <dt>Montant total :</dt>
                  <dd>{fcfa(totalPrice, business?.currency)}</dd>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <dt>Acomptes versés :</dt>
                  <dd className="font-medium text-emerald-600">
                    - {fcfa(totalPaid, business?.currency)}
                  </dd>
                </div>
                <div className="flex justify-between border-t pt-1 font-display text-sm font-bold text-neutral-900">
                  <dt>Reste à payer :</dt>
                  <dd className={balanceDue > 0 ? "text-amber-700" : "text-emerald-700"}>
                    {fcfa(balanceDue, business?.currency)}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Delivery Date Note */}
            <div className="mt-4 rounded-md border border-neutral-200 p-2.5 text-center text-xs text-neutral-700">
              🗓️ <strong>Date de livraison prévue :</strong> {dateLongFr(order.due_date)}
            </div>

            {/* Legal / Atelier receipt note */}
            {business?.receipt_note && (
              <p className="mt-3 text-center text-[0.65rem] italic text-neutral-500">
                « {business.receipt_note} »
              </p>
            )}

            {/* Signatures */}
            <div className="mt-8 grid grid-cols-2 gap-4 border-t pt-4 text-center text-[0.7rem] text-neutral-500">
              <div>
                <p>Signature Client</p>
                <div className="mt-6 border-b border-dashed border-neutral-300" />
              </div>
              <div>
                <p>Pour l'Atelier</p>
                <div className="mt-6 border-b border-dashed border-neutral-300" />
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4 flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setOpenReceiptModal(false)}>
              Fermer
            </Button>
            <Button
              variant="outline"
              className="border-success/40 text-success hover:bg-success/10"
              onClick={() => {
                setOpenReceiptModal(false);
                shareReceiptViaWhatsApp();
              }}
            >
              <MessageCircle className="mr-2 size-4" /> Envoyer par WhatsApp
            </Button>
            <Button
              onClick={() => {
                window.print();
              }}
            >
              <Printer className="mr-2 size-4" /> Imprimer maintenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Edit Order Sub-dialog
function EditOrderDialog({
  open,
  onOpenChange,
  order,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
  onUpdated: () => void;
}) {
  const businessId = order?.business_id;
  const garmentsQuery = useQuery({
    queryKey: ["garment-types", businessId],
    queryFn: () => fetchGarmentTypes(businessId),
    enabled: Boolean(open && businessId),
  });
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          garment_type: String(fd.get("garment_type") || "").trim(),
          fabric: String(fd.get("fabric") || "").trim() || null,
          quantity: Number(fd.get("quantity") || 1),
          price: Number(fd.get("price") || 0),
          ordered_at: String(fd.get("ordered_at") || today()),
          due_date: String(fd.get("due_date") || "") || null,
          description: String(fd.get("description") || "").trim() || null,
          notes: String(fd.get("notes") || "").trim() || null,
        })
        .eq("id", order.id);
      if (error) throw error;
      toast.success("Commande mise à jour");
      onUpdated();
      onOpenChange(false);
    } catch {
      toast.error("Impossible d'enregistrer les modifications");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier la commande {order.reference}</DialogTitle>
          <DialogDescription>
            Ajustez le type de vêtement, tissu, prix ou dates de livraison.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-garment">Vêtement *</Label>
              <input
                id="edit-garment"
                name="garment_type"
                required
                defaultValue={order.garment_type}
                list="garment-list-edit"
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              />
              <datalist id="garment-list-edit">
                {(garmentsQuery.data ?? []).map((g) => (
                  <option key={g.id} value={g.name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-fabric">Tissu</Label>
              <Input id="edit-fabric" name="fabric" defaultValue={order.fabric ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-qty">Quantité</Label>
              <Input
                id="edit-qty"
                name="quantity"
                type="number"
                min={1}
                defaultValue={order.quantity}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-price">Prix Total (FCFA) *</Label>
              <Input
                id="edit-price"
                name="price"
                type="number"
                min={0}
                defaultValue={order.price}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-ordered_at">Date de commande</Label>
              <Input
                id="edit-ordered_at"
                name="ordered_at"
                type="date"
                defaultValue={order.ordered_at}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-due_date">Livraison prévue</Label>
              <Input
                id="edit-due_date"
                name="due_date"
                type="date"
                defaultValue={order.due_date ?? ""}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Instructions du modèle</Label>
            <Textarea
              id="edit-desc"
              name="description"
              rows={2}
              defaultValue={order.description ?? ""}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Notes atelier</Label>
            <Textarea id="edit-notes" name="notes" rows={2} defaultValue={order.notes ?? ""} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
