const nf = new Intl.NumberFormat("fr-FR");

export function fcfa(value: number | null | undefined, currency = "FCFA") {
  const n = Math.round(Number(value ?? 0));
  return `${nf.format(n).replace(/\u202f|\u00a0/g, " ")} ${currency}`;
}

export function money(value: number | null | undefined) {
  return nf.format(Math.round(Number(value ?? 0))).replace(/\u202f|\u00a0/g, " ");
}

export function dateFr(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function dateLongFr(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function initials(first?: string | null, last?: string | null) {
  return `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "?";
}

export function fullName(c: { first_name?: string | null; last_name?: string | null } | null | undefined) {
  if (!c) return "Client supprimé";
  return `${c.first_name ?? ""} ${(c.last_name ?? "").toUpperCase()}`.trim();
}

/** Normalise un numéro de téléphone pour un lien WhatsApp (conserve l'indicatif international). */
export function waLink(phone: string | null | undefined, message?: string) {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `226${digits}`;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${text}`;
}

/**
 * Retourne uniquement les chiffres avec indicatif.
 * Utilisé pour construire manuellement des URLs wa.me et des liens tel:.
 */
export function cleanPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `226${digits}`;
  return digits;
}
