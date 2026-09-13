import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, MapPin } from "lucide-react";

import { fetchClients } from "@/lib/queries";
import { useBusiness } from "@/hooks/use-business";
import { fullName, initials, dateFr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, StoredImage } from "@/components/bits";
import { ClientFormDialog } from "@/components/client-form-dialog";

export const Route = createFileRoute("/_authenticated/clients/")({
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
  const [term, setTerm] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const { data: business } = useBusiness();
  const clients = useQuery({ queryKey: ["clients", term], queryFn: () => fetchClients(term) });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {clients.data?.length ?? 0} client(s) enregistré(s)
          </p>
        </div>
        <Button onClick={() => setOpenNew(true)}>
          <Plus className="size-4" /> Nouveau
        </Button>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Chercher par nom ou téléphone…"
          className="pl-9"
        />
      </div>

      {clients.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : (clients.data ?? []).length === 0 ? (
        <EmptyState
          title={term ? "Aucun client trouvé" : "Aucun client pour le moment"}
          text={
            term
              ? "Essayez un autre nom ou numéro."
              : "Créez votre première fiche client : nom, téléphone et c'est parti."
          }
          action={<Button onClick={() => setOpenNew(true)}>Nouveau client</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(clients.data ?? []).map((c) => (
            <Link
              key={c.id}
              to="/clients/$clientId"
              params={{ clientId: c.id }}
              className="card-soft flex items-center gap-3 p-4 transition-colors hover:border-primary/40"
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
                <p className="truncate font-display text-sm font-semibold">{fullName(c)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.phone ?? "Sans téléphone"}
                </p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {c.city ? (
                    <>
                      <MapPin className="size-3" /> {c.city}
                    </>
                  ) : (
                    <>Client depuis le {dateFr(c.created_at)}</>
                  )}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {business && (
        <ClientFormDialog open={openNew} onOpenChange={setOpenNew} businessId={business.id} />
      )}
    </div>
  );
}
