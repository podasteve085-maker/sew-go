import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, MapPin, Phone, MessageCircle } from "lucide-react";

import { fetchClients } from "@/lib/queries";
import { useBusiness } from "@/hooks/use-business";
import { fullName, initials, dateFr, cleanPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, StoredImage } from "@/components/bits";
import { ClientFormDialog } from "@/components/client-form-dialog";

export const Route = createFileRoute("/_authenticated/clients/")({
  validateSearch: (search: Record<string, unknown>): { nouveau?: boolean } => ({
    nouveau: search["nouveau"] === true || search["nouveau"] === "true",
  }),
  head: () => ({
    meta: [
      { title: "Clients — CouturPro" },
      {
        name: "description",
        content: "Tous vos clients avec téléphone, WhatsApp, quartier, mesures et historique.",
      },
      { property: "og:title", content: "Clients — CouturPro" },
      { property: "og:description", content: "Le carnet d'adresses de votre atelier de couture." },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const { nouveau } = Route.useSearch();
  const [term, setTerm] = useState("");
  const [openNew, setOpenNew] = useState(Boolean(nouveau));
  const [genderFilter, setGenderFilter] = useState<string>("all");
  const { data: business } = useBusiness();
  const clients = useQuery({ queryKey: ["clients", term], queryFn: () => fetchClients(term) });

  const filteredClients = useMemo(() => {
    const list = clients.data ?? [];
    if (genderFilter === "all") return list;
    return list.filter((c) => c.gender?.toLowerCase() === genderFilter.toLowerCase());
  }, [clients.data, genderFilter]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filteredClients.length} client(s) affiché(s)
          </p>
        </div>
        <Button onClick={() => setOpenNew(true)}>
          <Plus className="size-4" /> Nouveau
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Chercher par nom ou téléphone…"
            className="pl-9"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { id: "all", label: "Tous" },
            { id: "homme", label: "Hommes" },
            { id: "femme", label: "Femmes" },
            { id: "enfant", label: "Enfants" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setGenderFilter(f.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                genderFilter === f.id
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {clients.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : filteredClients.length === 0 ? (
        <EmptyState
          title={term || genderFilter !== "all" ? "Aucun client trouvé" : "Aucun client pour le moment"}
          text={
            term || genderFilter !== "all"
              ? "Essayez un autre filtre ou une autre recherche."
              : "Créez votre première fiche client : nom, téléphone et c'est parti."
          }
          action={<Button onClick={() => setOpenNew(true)}>Nouveau client</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredClients.map((c) => (
            <div
              key={c.id}
              className="card-soft flex flex-col justify-between p-4 transition-colors hover:border-primary/40"
            >
              <Link
                to="/clients/$clientId"
                params={{ clientId: c.id }}
                className="flex items-start gap-3"
              >
                {c.photo_url ? (
                  <StoredImage
                    path={c.photo_url}
                    alt={fullName(c)}
                    className="size-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-sm font-bold text-secondary-foreground">
                    {initials(c.first_name, c.last_name)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="truncate font-display text-sm font-bold text-foreground hover:text-primary">
                      {fullName(c)}
                    </p>
                    {c.gender && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase ${
                          c.gender === "homme"
                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                            : c.gender === "femme"
                            ? "bg-purple-500/10 text-purple-700 dark:text-purple-400"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        }`}
                      >
                        {c.gender}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs font-medium text-muted-foreground">
                    {c.phone ?? "Sans téléphone"}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {c.city ? (
                      <>
                        <MapPin className="size-3 text-muted-foreground/70" /> {c.city}
                      </>
                    ) : (
                      <>Client depuis le {dateFr(c.created_at)}</>
                    )}
                  </p>
                </div>
              </Link>

              {/* Boutons d'action tactile WhatsApp / Appel */}
              <div className="mt-3.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-border/80 pt-2.5">
                {c.phone && (
                  <a
                    href={`tel:${cleanPhone(c.phone)}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95"
                    title={`Appeler ${c.first_name}`}
                  >
                    <Phone className="size-3.5 text-primary" /> Appeler
                  </a>
                )}
                {(c.whatsapp || c.phone) && (
                  <a
                    href={`https://wa.me/${cleanPhone(c.whatsapp || c.phone)}?text=${encodeURIComponent(
                      `Bonjour ${c.first_name}, c'est ${business?.name ?? "votre atelier"}.`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2.5 text-xs font-semibold text-success transition-all hover:bg-success/20 active:scale-95"
                    title={`WhatsApp ${c.first_name}`}
                  >
                    <MessageCircle className="size-3.5" /> WhatsApp
                  </a>
                )}
                <Button size="sm" variant="ghost" className="h-8 text-xs font-semibold" asChild>
                  <Link to="/clients/$clientId" params={{ clientId: c.id }}>
                    Fiche →
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {business && (
        <ClientFormDialog open={openNew} onOpenChange={setOpenNew} businessId={business.id} />
      )}
    </div>
  );
}
