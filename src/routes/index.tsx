import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Ruler,
  Users,
  Scissors,
  Wallet,
  CalendarDays,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import heroImage from "@/assets/hero-atelier.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CouturPro — Le logiciel de gestion pour ateliers de couture en Afrique & dans le monde" },
      {
        name: "description",
        content:
          "Clients, carnet de mesures, commandes, paiements et rendez-vous : gérez tout votre atelier de couture depuis votre téléphone. Conçu pour tous les couturiers, tailleurs et créateurs de mode en Afrique et au-delà.",
      },
      { property: "og:title", content: "CouturPro — Gestion d'atelier de couture" },
      {
        property: "og:description",
        content:
          "Ne perdez plus une mesure ni une échéance. CouturPro centralise clients, mesures, commandes, paiements et rendez-vous.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: Users,
    title: "Fiches clients",
    text: "Nom, téléphone, WhatsApp, ville, photo et notes personnelles de chaque client.",
  },
  {
    icon: Ruler,
    title: "Carnet de mesures",
    text: "Modèles Homme, Femme, Enfant. Chaque relevé est daté et l'historique est conservé.",
  },
  {
    icon: Scissors,
    title: "Commandes suivies",
    text: "De « Nouvelle » à « Livrée », avec photo du modèle, du tissu et alerte de retard.",
  },
  {
    icon: Wallet,
    title: "Gestion des paiements",
    text: "Espèces, Mobile Money (Orange, Wave, MTN, Moov...), virements et multi-devises. Acomptes, soldes et reçus instantanés.",
  },
  {
    icon: CalendarDays,
    title: "Rendez-vous",
    text: "Prise de mesures, essayage, retouche, livraison : votre agenda du jour et de la semaine.",
  },
  {
    icon: ReceiptText,
    title: "Reçus imprimables",
    text: "Un bon de commande propre au nom de votre atelier, en un clic.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <div className="faso-stripes h-2 w-full" />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <span className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Scissors className="size-5" />
          </span>
          CouturPro
        </span>
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Button asChild variant="secondary" size="sm">
            <Link to="/auth">Se connecter</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/auth" search={{ tab: "signup" }}>
              Créer un atelier
            </Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-8 lg:grid-cols-2 lg:pt-16">
          <div>
            <span className="chip-new">Pensé pour l'Afrique & les créateurs du monde 🌍</span>
            <h1 className="mt-4 text-4xl font-bold leading-tight sm:text-5xl">
              Votre atelier de couture, enfin bien organisé
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
              Fini les carnets perdus et les mesures introuvables. Enregistrez vos clients, leurs
              mesures, vos commandes et vos paiements — depuis votre téléphone, en quelques
              secondes.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/auth">
                  Commencer gratuitement <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#fonctions">Voir les fonctions</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-5 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Smartphone className="size-4 text-primary" /> 100% Mobile & Ordinateur
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Données privées & sécurisées
              </span>
              <span className="flex items-center gap-2">
                <Wallet className="size-4 text-primary" /> Multi-devises & Mobile Money
              </span>
            </div>
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-border shadow-[var(--shadow-raised)]">
              <img
                src={heroImage}
                alt="Couturier et styliste travaillant sur des créations dans son atelier de couture"
                width={1600}
                height={1104}
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </section>

        <section id="fonctions" className="bg-surface py-16">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="text-2xl font-bold sm:text-3xl">Tout ce qu'il faut, rien de compliqué</h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Trois questions résolues : où sont les mesures de mon client, quelles commandes livrer
              et pour quand, combien reste-t-il à encaisser.
            </p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="card-soft p-5">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <f.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="card-soft flex flex-col items-start gap-6 p-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold">Créez votre atelier en 1 minute</h2>
              <p className="mt-2 text-muted-foreground">
                Un compte, votre nom d'atelier, et vous pouvez déjà enregistrer votre premier
                client.
              </p>
            </div>
            <Button asChild size="lg">
              <Link to="/auth">Commencer</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        CouturPro — La solution de gestion pour les couturiers, tailleurs et créateurs de mode en Afrique et à l'international.
      </footer>
    </div>
  );
}
