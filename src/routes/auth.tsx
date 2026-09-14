import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Scissors, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connexion — CouturPro" },
      {
        name: "description",
        content:
          "Connectez-vous à votre atelier CouturPro ou créez votre compte pour gérer clients, mesures et commandes.",
      },
      { property: "og:title", content: "Connexion — CouturPro" },
      {
        property: "og:description",
        content: "Accédez à votre atelier de couture : clients, mesures, commandes, paiements.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: `${window.location.origin}/auth`,
    });
    setLoading(false);
    if (error) {
      toast.error("Impossible d'envoyer l'email", { description: error.message });
    } else {
      toast.success("Email envoyé", {
        description: "Consultez vos messages pour réinitialiser votre mot de passe.",
      });
      setResetOpen(false);
      setResetEmail("");
    }
  }

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) {
      const lower = error.message.toLowerCase();
      let description = "Email ou mot de passe incorrect.";
      if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
        description = "Email ou mot de passe incorrect. Vérifiez votre saisie ou utilisez le lien « Mot de passe oublié ? » ci-dessous.";
      } else if (lower.includes("email not confirmed")) {
        description = "Votre email n'est pas encore confirmé. Utilisez le lien reçu par email ou contactez l'assistance.";
      } else if (lower.includes("too many requests") || lower.includes("rate limit")) {
        description = "Trop de tentatives consécutives. Veuillez patienter 2 minutes avant de réessayer.";
      } else if (error.message) {
        description = error.message;
      }
      toast.error("Connexion impossible", { description });
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  async function signUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const emailVal = String(form.get("email")).trim();
    const passwordVal = String(form.get("password"));

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: emailVal,
      password: passwordVal,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          business_name: String(form.get("business_name") ?? "").trim(),
          owner_name: String(form.get("owner_name") ?? "").trim(),
          phone: String(form.get("phone") ?? "").trim(),
        },
      },
    });

    if (error) {
      setLoading(false);
      toast.error("Inscription impossible", {
        description:
          error.message.includes("already") || error.message.includes("registered")
            ? "Cet email a déjà un compte. Connectez-vous."
            : error.message || "Vérifiez vos informations (mot de passe de 6 caractères minimum).",
      });
      return;
    }

    // Si Supabase retourne directement la session (auto-confirm actif)
    if (data.session) {
      setLoading(false);
      toast.success("Atelier créé avec succès !", { description: "Bienvenue sur CouturPro !" });
      navigate({ to: "/dashboard", replace: true });
      return;
    }

    // Si pas de session directe, tentative immédiate de connexion
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: emailVal,
      password: passwordVal,
    });
    setLoading(false);

    if (signInErr) {
      if (signInErr.message.toLowerCase().includes("email not confirmed")) {
        toast.error("Vérification d'email requise", {
          description:
            "Un lien de confirmation a été envoyé à votre adresse email. Cliquez dessus pour activer votre compte.",
        });
      } else {
        toast.info("Atelier créé !", {
          description: "Connectez-vous avec vos identifiants.",
        });
      }
      return;
    }

    toast.success("Atelier créé avec succès !", { description: "Bienvenue sur CouturPro !" });
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="faso-stripes h-2 w-full" />
      <div className="mx-auto flex max-w-md flex-col px-5 py-10">
        <Link to="/" className="mb-8 flex items-center gap-2 font-display text-lg font-bold">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Scissors className="size-5" />
          </span>
          CouturPro
        </Link>

        <div className="card-soft p-6">
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Connexion</TabsTrigger>
              <TabsTrigger value="signup">Créer mon atelier</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-6">
              <form onSubmit={signIn} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="in-email">Email</Label>
                  <Input id="in-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="in-password">Mot de passe</Label>
                    <button
                      type="button"
                      onClick={() => setResetOpen(true)}
                      className="text-xs text-primary hover:underline"
                    >
                      Mot de passe oublié ?
                    </button>
                  </div>
                  <Input
                    id="in-password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="size-4 animate-spin" />} Se connecter
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <form onSubmit={signUp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="up-business">Nom de l'atelier</Label>
                  <Input
                    id="up-business"
                    name="business_name"
                    required
                    placeholder="Atelier Ibrahim"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="up-owner">Nom du responsable</Label>
                  <Input id="up-owner" name="owner_name" required placeholder="Ibrahim OUÉDRAOGO" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="up-phone">Téléphone</Label>
                  <Input id="up-phone" name="phone" inputMode="tel" placeholder="70 00 00 00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="up-email">Email</Label>
                  <Input id="up-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="up-password">Mot de passe</Label>
                  <Input
                    id="up-password"
                    name="password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="size-4 animate-spin" />} Créer mon atelier
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Vos clients, mesures et commandes restent privés : personne d'autre que votre atelier n'y a
          accès.
        </p>

        {/* Modal Réinitialisation mot de passe */}
        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Mot de passe oublié ?</DialogTitle>
              <DialogDescription>
                Indiquez votre adresse email. Nous vous enverrons un lien sécurisé pour créer un nouveau mot de passe.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email">Votre adresse email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="atelier@example.com"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setResetOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={loading || !resetEmail.trim()}>
                  {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Envoyer le lien
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
