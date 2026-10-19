import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck, Lock, Database, UserCheck, Trash2, Download, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/politique-confidentialite")({
  head: () => ({
    meta: [
      { title: "Politique de Confidentialité & Protection des Données — CouturPro" },
      {
        name: "description",
        content:
          "Engagement de confidentialité, conformité RGPD et protection des données à caractère personnel de CouturPro et de ses ateliers.",
      },
      { property: "og:title", content: "Politique de Confidentialité — CouturPro" },
      { property: "og:description", content: "Protection rigoureuse et sécurisation de vos données d'atelier et clients." },
    ],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  const lastUpdated = "19 Octobre 2026";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="faso-stripes h-2 w-full shrink-0" />

      {/* Header de navigation */}
      <header className="border-b border-border/80 bg-card/60 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors group"
          >
            <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
            <span>Retour à l'accueil</span>
          </Link>

          <div className="flex items-center gap-2 font-display text-sm font-bold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" />
            </span>
            <span>CouturPro · Vie Privée</span>
          </div>

          <Button asChild size="sm" variant="outline" className="text-xs font-semibold">
            <Link to="/auth">Mon Espace Atelier</Link>
          </Button>
        </div>
      </header>

      {/* Contenu principal */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-5 py-10 space-y-10">
        {/* Titre & Introduction */}
        <section className="space-y-3 border-b border-border/80 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-3.5" /> Conformité RGPD & Standards Internationaux
          </div>
          <h1 className="font-display text-2xl sm:text-4xl font-extrabold tracking-tight">
            Politique de Confidentialité & Protection des Données Personnelles
          </h1>
          <p className="text-xs text-muted-foreground">
            Dernière mise à jour : <strong>{lastUpdated}</strong> · Entrée en vigueur immédiate
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed pt-2">
            Chez <strong>CouturPro</strong>, nous considérons la confidentialité des artisans couturiers, tailleurs, stylistes et de leurs clients comme un droit fondamental. La présente politique détaille avec une transparence absolue la nature des données collectées, leur finalité légitime, leur sécurisation et vos moyens d'action (accès, portabilité, suppression).
          </p>
        </section>

        {/* 1. Responsable de Traitement */}
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
              1
            </span>
            <h2 className="font-display text-lg font-bold">Responsable de Traitement & Rôles</h2>
          </div>
          <div className="card-soft p-5 space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              Dans le cadre de l'utilisation de la plateforme :
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>L'Atelier de Couture (Utilisateur / Abonné)</strong> est le <em>Responsable de Traitement</em> exclusif des données personnelles concernant ses propres clients (coordonnées, mensurations corporelles, commandes de vêtements et reçus d'acomptes).
              </li>
              <li>
                <strong>CouturPro</strong> agit en qualité de <em>Sous-traitant technique</em> et d'opérateur logiciel sécurisé, fournissant l'infrastructure d'hébergement, la synchronisation PWA hors-ligne et les mécanismes de protection d'accès.
              </li>
            </ul>
          </div>
        </section>

        {/* 2. Données Collectées & Finalités */}
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
              2
            </span>
            <h2 className="font-display text-lg font-bold">Données Collectées & Finalités Légitimes</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="card-soft p-4 space-y-2">
              <h3 className="font-display text-xs font-bold text-foreground flex items-center gap-1.5">
                <UserCheck className="size-4 text-primary" /> Données de l'Atelier
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Nom de l'atelier, nom du gérant, adresse email, téléphone, devise comptable et logo.
                <br /><strong className="text-foreground">Finalité :</strong> Authentification, gestion de l'abonnement et personnalisation des reçus clients.
              </p>
            </div>

            <div className="card-soft p-4 space-y-2">
              <h3 className="font-display text-xs font-bold text-foreground flex items-center gap-1.5">
                <FileText className="size-4 text-emerald-600" /> Données Clients & Contacts
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Nom, prénom, téléphone d'appel, numéro WhatsApp, quartier/ville et notes d'atelier.
                <br /><strong className="text-foreground">Finalité :</strong> Communication de livraison, partage WhatsApp et suivi de la relation client.
              </p>
            </div>

            <div className="card-soft p-4 space-y-2">
              <h3 className="font-display text-xs font-bold text-foreground flex items-center gap-1.5">
                <Lock className="size-4 text-amber-600" /> Mensurations Corporelles
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Dimensions physiques et gabarits de couture (tour de poitrine, taille, bassin, carrure, etc.).
                <br /><strong className="text-foreground">Finalité :</strong> Exécution technique du contrat de confection sur mesure.
              </p>
            </div>

            <div className="card-soft p-4 space-y-2">
              <h3 className="font-display text-xs font-bold text-foreground flex items-center gap-1.5">
                <Database className="size-4 text-indigo-600" /> Suivi de Commandes & Paiements
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Photos de modèles de tissu, montants facturés, acomptes perçus et dates d'échéance.
                <br /><strong className="text-foreground">Finalité :</strong> Suivi de confection et gestion comptable interne de l'atelier.
              </p>
            </div>
          </div>
        </section>

        {/* 3. Sécurité & Étanchéité */}
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
              3
            </span>
            <h2 className="font-display text-lg font-bold">Sécurité Technique & Étanchéité Multi-Tenant</h2>
          </div>
          <div className="card-soft p-5 space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              Pour garantir une protection maximale, CouturPro applique le principe de <strong>Security by Design</strong> :
            </p>
            <div className="grid sm:grid-cols-3 gap-3 pt-1">
              <div className="rounded-xl border border-border/80 bg-background/50 p-3 space-y-1">
                <p className="font-bold text-foreground flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600" /> RLS PostgreSQL
                </p>
                <p className="text-[11px]">
                  Politiques de niveau ligne (Row Level Security) empêchant formellement tout atelier d'accéder aux données d'un autre.
                </p>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/50 p-3 space-y-1">
                <p className="font-bold text-foreground flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600" /> Chiffrement TLS
                </p>
                <p className="text-[11px]">
                  Toutes les communications entre votre appareil et nos serveurs sont chiffrées de bout en bout en HTTPS / TLS 1.3.
                </p>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/50 p-3 space-y-1">
                <p className="font-bold text-foreground flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600" /> Purge Déconnexion
                </p>
                <p className="text-[11px]">
                  À chaque déconnexion, le cache local `IndexedDB` est intégralement vidé pour protéger vos données sur appareils partagés.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Fonctionnement PWA & Données Hors-Ligne */}
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
              4
            </span>
            <h2 className="font-display text-lg font-bold">Application Web Progressive (PWA) & Stockage Local</h2>
          </div>
          <div className="card-soft p-5 space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              CouturPro est conçu pour fonctionner en milieu déconnecté ou avec une connexion Internet instable :
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Vos données sont enregistrées dans la base locale sécurisée de votre navigateur (IndexedDB).
              </li>
              <li>
                Dès que la connexion est rétablie, les modifications sont synchronisées de manière chiffrée avec le serveur cloud.
              </li>
              <li>
                <strong>Zéro cookie publicitaire ou traceur tiers :</strong> nous n'utilisons aucun traceur commercial, régie publicitaire ou outil de revente de données comportementales.
              </li>
            </ul>
          </div>
        </section>

        {/* 5. Vos Droits RGPD */}
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
              5
            </span>
            <h2 className="font-display text-lg font-bold">Vos Droits (Articles 15 à 22 du RGPD)</h2>
          </div>
          <div className="card-soft p-5 space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              Vous conservez la maîtrise intégrale et souveraine de vos données :
            </p>
            <div className="space-y-2 pt-1">
              <div className="flex items-start gap-2">
                <Download className="size-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">Droit à la portabilité (Art. 20) :</strong> Vous pouvez à tout moment télécharger l'intégralité de vos données en format structuré JSON ou CSV depuis l'onglet <em>Mon atelier</em>.
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Trash2 className="size-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">Droit à l'effacement / Droit à l'oubli (Art. 17) :</strong> Vous pouvez supprimer un client individuel (et toutes ses mesures/commandes associées) ou détruire définitivement l'intégralité de votre atelier d'un seul clic avec purge totale immédiate.
                </div>
              </div>
              <div className="flex items-start gap-2">
                <UserCheck className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">Droit d'accès et rectification (Art. 15 & 16) :</strong> Vous pouvez consulter et corriger immédiatement toute information client ou commande directement depuis l'application.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Contact */}
        <section className="card-soft p-5 space-y-2 border-primary/20 bg-primary/5">
          <h2 className="font-display text-sm font-bold text-foreground">
            Question ou exercice de vos droits ?
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Pour toute demande concernant la protection de vos données personnelles ou pour exercer vos droits, vous pouvez nous écrire directement à : <strong className="text-foreground">podasteve085@gmail.com</strong>.
          </p>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        CouturPro · Logiciel de gestion d'atelier de couture · Respect strict de la vie privée
      </footer>
    </div>
  );
}
