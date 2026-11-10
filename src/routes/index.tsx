import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
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
  Crown,
  Check,
  Zap,
  Flame,
  Sparkles,
  MessageCircle,
} from "lucide-react";
import { PLAN_CONFIG, getPlanWhatsAppUrl } from "@/lib/quotas";

import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-atelier.jpg";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    // Si l'utilisateur est déjà connecté ou a un atelier local hors-ligne légitime, aller directement au tableau de bord
    if (typeof window !== "undefined") {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const offlineBiz = localStorage.getItem("couturpro_current_business_id");
        const offlineUserId = localStorage.getItem("couturpro_current_user_id");
        if (offlineBiz && offlineUserId) throw redirect({ to: "/dashboard" });
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) throw redirect({ to: "/dashboard" });
      } catch (e) {
        if (e && typeof e === "object" && "to" in e) throw e;
      }
    }
  },
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
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const offlineBiz = localStorage.getItem("couturpro_current_business_id");
        const offlineUserId = localStorage.getItem("couturpro_current_user_id");
        if (offlineBiz && offlineUserId) navigate({ to: "/dashboard", replace: true });
        return;
      }

      supabase.auth.getSession().then(({ data }) => {
        if (data?.session?.user) navigate({ to: "/dashboard", replace: true });
      });
    }
  }, [navigate]);

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
          <a
            href="#tarifs"
            className="hidden sm:inline-flex text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors mr-2"
          >
            Tarifs
          </a>
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
                <a href="#tarifs">Voir les tarifs</a>
              </Button>
              <Button asChild size="lg" variant="ghost" className="hidden sm:inline-flex">
                <a href="#fonctions">Fonctionnalités</a>
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

        {/* Section Tarifs Officiels & Transparents */}
        <section id="tarifs" className="py-16 sm:py-24 border-t border-border/60">
          <div className="mx-auto max-w-6xl px-5">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                <Crown className="size-3.5" /> Tarifs Clairs & Sans Surprise
              </span>
              <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                Investissez dans la sérénité de votre atelier
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                Aucun prélèvement automatique, aucun frais caché. Vous choisissez librement la formule adaptée à votre rythme de travail et réglez directement par Mobile Money ou clé de licence.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-3 items-stretch">
              {/* Formule 1 : Pro Mensuel */}
              <div className="rounded-3xl border border-border bg-card p-6 sm:p-7 flex flex-col justify-between shadow-xs hover:border-primary/40 transition-all">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Pass Mensuel
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                      <Zap className="size-3" /> Liberté
                    </span>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-3xl sm:text-4xl font-extrabold text-foreground">3 000</span>
                      <span className="text-sm sm:text-base font-semibold text-muted-foreground">FCFA</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">pour 30 jours complets, sans engagement</p>
                  </div>

                  <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
                    <strong>Pourquoi choisir ce forfait ?</strong> Idéal pour démarrer, tester votre atelier en conditions réelles et garder une flexibilité maximale mois par mois.
                  </div>

                  <div className="space-y-2.5 pt-2 text-xs">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Clients & fiches de mesures illimités
                    </p>
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Commandes suivies en illimité
                    </p>
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Jusqu'à 200 photos de catalogue
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0" /> Reçus imprimables & WhatsApp avec logo
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0" /> Statistiques & suivi des acomptes
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0" /> Sauvegarde Cloud continue & mode hors-ligne
                    </p>
                  </div>
                </div>

                <div className="mt-8 pt-4 border-t border-border/70 space-y-2">
                  <a
                    href={getPlanWhatsAppUrl("monthly")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs sm:text-sm font-bold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 active:scale-95"
                  >
                    <MessageCircle className="size-4" /> Souscrire par WhatsApp
                  </a>
                  <p className="text-[10px] text-center text-muted-foreground">
                    Activation immédiate par clé de licence
                  </p>
                </div>
              </div>

              {/* Formule 2 : Pro Trimestriel (Populaire) */}
              <div className="relative rounded-3xl border-2 border-amber-500 bg-card p-6 sm:p-7 flex flex-col justify-between shadow-md">
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-3.5 py-1 text-[11px] font-extrabold text-white shadow-xs">
                  LE PLUS POPULAIRE (-17%)
                </span>

                <div className="space-y-4">
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-display text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      Pass Trimestriel
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                      <Flame className="size-3" /> Haute Saison
                    </span>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-3xl sm:text-4xl font-extrabold text-foreground">7 500</span>
                      <span className="text-sm sm:text-base font-semibold text-muted-foreground">FCFA</span>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mt-1">
                      soit seulement 2 500 FCFA / mois (90 jours)
                    </p>
                  </div>

                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-900 dark:text-amber-300 leading-relaxed">
                    <strong>Pourquoi choisir ce forfait ?</strong> Économisez 1 500 FCFA et couvrez sereinement vos périodes de forte affluence (Tabaski, mariages, fêtes de fin d'année) avec <strong>photos illimitées</strong>.
                  </div>

                  <div className="space-y-2.5 pt-2 text-xs">
                    <p className="flex items-center gap-2 font-bold text-foreground">
                      <Check className="size-4 text-amber-600 shrink-0 font-extrabold" /> Photos catalogue 100% ILLIMITÉES
                    </p>
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Clients, mesures & commandes illimités
                    </p>
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> 3 mois complets sans coupure
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0" /> Économie immédiate de 1 500 FCFA
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0" /> Reçus personnalisés avec logo de l'atelier
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0" /> Sauvegarde Cloud continue de votre atelier
                    </p>
                  </div>
                </div>

                <div className="mt-8 pt-4 border-t border-border/70 space-y-2">
                  <a
                    href={getPlanWhatsAppUrl("quarterly")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-3 text-xs sm:text-sm font-bold text-white shadow-xs transition-all active:scale-95"
                  >
                    <MessageCircle className="size-4" /> Souscrire au Pass Saison
                  </a>
                  <p className="text-[10px] text-center text-muted-foreground">
                    Formule la plus souscrite par les artisans
                  </p>
                </div>
              </div>

              {/* Formule 3 : Pro Annuel VIP */}
              <div className="rounded-3xl border border-emerald-500/40 bg-card p-6 sm:p-7 flex flex-col justify-between shadow-xs hover:border-emerald-500/70 transition-all">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                      Pass Annuel VIP
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      <Sparkles className="size-3" /> Maître Couturier
                    </span>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-3xl sm:text-4xl font-extrabold text-foreground">35 000</span>
                      <span className="text-sm sm:text-base font-semibold text-muted-foreground">FCFA</span>
                    </div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold mt-1">
                      pour 1 an complet (365 jours de sérénité)
                    </p>
                  </div>

                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-900 dark:text-emerald-300 leading-relaxed">
                    <strong>Pourquoi choisir ce forfait ?</strong> La tranquillité absolue d'un maître couturier : ne pensez plus à votre abonnement pendant 1 an et bénéficiez d'une assistance VIP dédiée.
                  </div>

                  <div className="space-y-2.5 pt-2 text-xs">
                    <p className="flex items-center gap-2 font-bold text-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0 font-extrabold" /> 365 jours complets de sérénité
                    </p>
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Photos catalogue 100% ILLIMITÉES
                    </p>
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0 font-bold" /> Toutes les fonctions Pro débloquées
                    </p>
                    <p className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400">
                      <Crown className="size-4 text-amber-500 shrink-0" /> Support VIP prioritaire par WhatsApp
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0" /> Badge Atelier Certifié CouturPro
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-4 text-emerald-600 shrink-0" /> Sauvegarde Cloud sécurisée permanente
                    </p>
                  </div>
                </div>

                <div className="mt-8 pt-4 border-t border-border/70 space-y-2">
                  <a
                    href={getPlanWhatsAppUrl("yearly")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-3 text-xs sm:text-sm font-bold text-white shadow-xs transition-all active:scale-95"
                  >
                    <MessageCircle className="size-4" /> Souscrire au Pass VIP
                  </a>
                  <p className="text-[10px] text-center text-muted-foreground">
                    Sérénité 1 an + Accompagnement VIP
                  </p>
                </div>
              </div>
            </div>

            {/* Note de réassurance */}
            <div className="mt-12 rounded-2xl border border-border bg-muted/30 p-5 text-center max-w-2xl mx-auto space-y-1.5">
              <p className="text-xs sm:text-sm font-bold text-foreground">
                🔒 Vos données restent 100 % protégées et accessibles à vie
              </p>
              <p className="text-xs text-muted-foreground">
                Même si votre forfait arrive à échéance au bout de 30 jours, votre atelier passe en mode Consultation (lecture seule) : vos fiches clients, mesures et commandes restent consultables et imprimables sans aucune perte.
              </p>
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

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground space-y-2">
        <p>CouturPro — La solution de gestion pour les couturiers, tailleurs et créateurs de mode en Afrique et à l'international.</p>
        <p className="text-xs">
          <Link to="/politique-confidentialite" className="text-primary hover:underline font-medium">
            Politique de Confidentialité & Protection des Données (RGPD)
          </Link>
        </p>
      </footer>
    </div>
  );
}
