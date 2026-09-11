import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Scissors, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

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
      toast.error("Connexion impossible", { description: "Email ou mot de passe incorrect." });
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  async function signUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          business_name: String(form.get("business_name") ?? "").trim(),
          owner_name: String(form.get("owner_name") ?? "").trim(),
          phone: String(form.get("phone") ?? "").trim(),
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Inscription impossible", {
        description:
          error.message.includes("already") || error.message.includes("registered")
            ? "Cet email a déjà un compte. Connectez-vous."
            : "Vérifiez vos informations (mot de passe de 6 caractères minimum).",
      });
      return;
    }
    toast.success("Atelier créé", { description: "Bienvenue sur CouturPro !" });
    navigate({ to: "/dashboard", replace: true });
  }

  async function google() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      toast.error("Connexion Google impossible");
      return;
    }
    if (result.redirected) return;
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
                  <Label htmlFor="in-password">Mot de passe</Label>
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

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="outline" className="w-full" onClick={google} disabled={loading}>
            Continuer avec Google
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Vos clients, mesures et commandes restent privés : personne d'autre que votre atelier n'y a
          accès.
        </p>
      </div>
    </div>
  );
}
