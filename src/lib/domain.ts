export type OrderStatus =
  | "nouvelle"
  | "preparation"
  | "confection"
  | "finition"
  | "prete"
  | "livree"
  | "annulee";

export const ORDER_FLOW: OrderStatus[] = [
  "nouvelle",
  "preparation",
  "confection",
  "finition",
  "prete",
  "livree",
];

export const ORDER_STATUS: Record<
  OrderStatus,
  { label: string; dot: string; chip: string; iconName: string }
> = {
  nouvelle: { label: "Nouvelle", dot: "bg-status-new", chip: "chip-new", iconName: "Sparkles" },
  preparation: { label: "En préparation", dot: "bg-status-prep", chip: "chip-prep", iconName: "Scissors" },
  confection: { label: "En confection", dot: "bg-status-sewing", chip: "chip-sewing", iconName: "Shirt" },
  finition: { label: "Finition", dot: "bg-status-finish", chip: "chip-finish", iconName: "Sparkles" },
  prete: { label: "Prête", dot: "bg-status-ready", chip: "chip-ready", iconName: "CheckCircle2" },
  livree: { label: "Livrée", dot: "bg-status-done", chip: "chip-done", iconName: "PackageCheck" },
  annulee: { label: "Annulée", dot: "bg-status-cancel", chip: "chip-cancel", iconName: "XCircle" },
};

export const PAYMENT_METHODS = [
  { value: "especes", label: "Espèces" },
  { value: "orange_money", label: "Orange Money" },
  { value: "moov_money", label: "Moov Money" },
  { value: "wave", label: "Wave" },
  { value: "virement", label: "Virement" },
  { value: "autre", label: "Autre" },
] as const;

export function paymentLabel(value: string) {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;
}

export const APPOINTMENT_TYPES = [
  { value: "mesures", label: "Prise de mesures" },
  { value: "essayage", label: "Essayage" },
  { value: "retouche", label: "Retouche" },
  { value: "recuperation", label: "Récupération" },
  { value: "livraison", label: "Livraison" },
  { value: "consultation", label: "Consultation" },
] as const;

export function appointmentLabel(value: string) {
  return APPOINTMENT_TYPES.find((t) => t.value === value)?.label ?? value;
}

export const APPOINTMENT_STATUS = [
  { value: "prevu", label: "Prévu" },
  { value: "honore", label: "Honoré" },
  { value: "annule", label: "Annulé" },
] as const;

export const GENDERS = [
  { value: "homme", label: "Homme" },
  { value: "femme", label: "Femme" },
  { value: "enfant", label: "Enfant" },
] as const;

export const IMAGE_KINDS = [
  { value: "modele", label: "Modèle souhaité" },
  { value: "tissu", label: "Tissu" },
  { value: "croquis", label: "Croquis" },
  { value: "autre", label: "Autre" },
] as const;

export function isLate(order: { due_date: string | null; status: string }) {
  if (!order.due_date) return false;
  if (order.status === "livree" || order.status === "annulee") return false;
  return order.due_date < new Date().toISOString().slice(0, 10);
}

export function isActive(status: string) {
  return status !== "livree" && status !== "annulee";
}

export const CATALOG_CATEGORIES = [
  { value: "boubou", label: "Boubou & Bazin", icon: "👔" },
  { value: "faso_dan_fani", label: "Faso Dan Fani & Koko Dunda", icon: "🧵" },
  { value: "robe", label: "Robe & Cérémonie", icon: "👗" },
  { value: "chemise", label: "Chemise & Tunique", icon: "👕" },
  { value: "costume", label: "Costume & Veste", icon: "🧥" },
  { value: "enfant", label: "Enfant", icon: "🧒" },
  { value: "traditionnel", label: "Tenue Traditionnelle", icon: "✨" },
  { value: "autre", label: "Autre création", icon: "✂️" },
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number]["value"];

export function catalogCategoryLabel(category: string) {
  return CATALOG_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

