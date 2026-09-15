import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Scissors, Loader2, ArrowLeft, KeyRound, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connexion & Inscription — CouturPro" },
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
  const [mode, setMode] = useState<"tabs" | "forgot" | "update_password">("tabs");

  // Champs formulaires
  const [signInEmail, setSignInEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    // 1. Détection immédiate du jeton de récupération dans le hash de l'URL (#type=recovery)
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("type=recovery")) {
      setMode("update_password");
      return;
    }

    // 2. Écoute active des changements d'état d'authentification Supabase
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("update_password");
      } else if (session && event === "SIGNED_IN" && !window.location.hash.includes("type=recovery")) {
        navigate({ to: "/dashboard", replace: true });
      }
    });

    // 3. Si l'utilisateur est déjà connecté et ne demande pas de récupération
    if (!hash.includes("type=recovery")) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) navigate({ to: "/dashboard", replace: true });
      });
    }

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  // Connexion
  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const emailVal = String(form.get("email")).trim();
    const passVal = String(form.get("password"));

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: emailVal,
      password: passVal,
    });
    setLoading(false);

    if (error) {
      const lower = error.message.toLowerCase();
      let description = "Email ou mot de passe incorrect.";
      if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
        description =
          "Email ou mot de passe incorrect. Vérifiez votre saisie ou utilisez le lien « Mot de passe oublié ? » ci-dessous.";
      } else if (lower.includes("email not confirmed")) {
        description = "Votre compte n'est pas encore activé. Contactez l'administrateur.";
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

  // Inscription
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

    // Session directe
    if (data.session) {
      setLoading(false);
      toast.success("Atelier créé avec succès !", { description: "Bienvenue sur CouturPro !" });
      navigate({ to: "/dashboard", replace: true });
      return;
    }

    // Fallback connexion immédiate
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: emailVal,
      password: passwordVal,
    });
    setLoading(false);

    if (signInErr) {
      toast.info("Atelier créé !", {
        description: "Connectez-vous avec vos identifiants.",
      });
      return;
    }

    toast.success("Atelier créé avec succès !", { description: "Bienvenue sur CouturPro !" });
    navigate({ to: "/dashboard", replace: true });
  }

  // Demande de réinitialisation
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    const emailToReset = (resetEmail || signInEmail).trim();
    if (!emailToReset) {
      toast.error("Veuillez indiquer votre adresse email.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailToReset, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setLoading(false);

    if (error) {
      const lower = error.message.toLowerCase();
      let description = error.message;
      if (lower.includes("rate limit") || lower.includes("too many")) {
        description = "Trop de demandes en peu de temps. Veuillez patienter quelques minutes.";
      }
      toast.error("Impossible d'envoyer l'email", { description });
    } else {
      setResetSent(true);
      toast.success("Email envoyé !", {
        description: `Un lien a été envoyé à ${emailToReset}. Vérifiez votre boîte et vos spams.`,
      });
    }
  }

  // Définir un nouveau mot de passe (après clic sur le lien reçu)
  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword) {
      toast.error("Veuillez saisir un mot de passe.");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Les deux mots de passe ne sont pas identiques.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      toast.error("Mise à jour impossible", { description: error.message });
      return;
    }

    toast.success("Mot de passe mis à jour avec succès !", {
      description: "Connexion à votre atelier...",
    });

    if (typeof window !== "undefined" && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname);
    }
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

        {/* MODE 1 : MISE À JOUR DU MOT DE PASSE (Récupération suite à lien email) */}
        {mode === "update_password" && (
          <div className="card-soft p-6">
            <div className="mb-6 flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <KeyRound className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold">Nouveau mot de passe</h2>
                <p className="text-xs text-muted-foreground">
                  Choisissez un mot de passe sécurisé pour votre atelier.
                </p>
              </div>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">Nouveau mot de passe</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 caractères"
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirmez le nouveau mot de passe</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Retapez le mot de passe"
                  autoComplete="new-password"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer le mot de passe
              </Button>
            </form>
          </div>
        )}

        {/* MODE 2 : DEMANDE DE RÉINITIALISATION DU MOT DE PASSE */}
        {mode === "forgot" && (
          <div className="card-soft p-6">
            <div className="mb-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setMode("tabs");
                  setResetSent(false);
                }}
                className="flex size-8 items-center justify-center rounded-lg border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Retour à la connexion"
              >
                <ArrowLeft className="size-4" />
              </button>
              <div>
                <h2 className="font-display text-lg font-bold">Mot de passe oublié ?</h2>
                <p className="text-xs text-muted-foreground">
                  Récupérez l'accès à votre compte atelier
                </p>
              </div>
            </div>

            {resetSent ? (
              <div className="space-y-4 text-center py-2">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <CheckCircle2 className="size-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Email envoyé !</h3>
                  <p className="text-xs text-muted-foreground">
                    Consultez votre boîte <strong className="text-foreground">{resetEmail || signInEmail}</strong> (vérifiez aussi le dossier Spams). Cliquez sur le lien pour choisir votre nouveau mot de passe.
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setMode("tabs");
                      setResetSent(false);
                    }}
                  >
                    Retour à la connexion
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email">Email de votre atelier</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    required
                    value={resetEmail || signInEmail}
                    onChange={(e) => {
                      setResetEmail(e.target.value);
                      setSignInEmail(e.target.value);
                    }}
                    placeholder="exemple@couturpro.com"
                    autoComplete="email"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Nous vous enverrons un lien sécurisé pour redéfinir votre mot de passe.
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Envoyer le lien de réinitialisation
                </Button>

                <button
                  type="button"
                  onClick={() => setMode("tabs")}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors pt-2 cursor-pointer"
                >
                  ← Retour à la connexion
                </button>
              </form>
            )}
          </div>
        )}

        {/* MODE 3 : ONGLETS NORMAUX (Connexion / Créer mon atelier) */}
        {mode === "tabs" && (
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
                    <Input
                      id="in-email"
                      name="email"
                      type="email"
                      required
                      value={signInEmail}
                      onChange={(e) => {
                        setSignInEmail(e.target.value);
                        setResetEmail(e.target.value);
                      }}
                      autoComplete="email"
                      placeholder="atelier@example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="in-password">Mot de passe</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setResetEmail(signInEmail);
                          setResetSent(false);
                          setMode("forgot");
                        }}
                        className="text-xs text-primary font-medium hover:underline cursor-pointer"
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
                      placeholder="••••••••"
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
                    <Input
                      id="up-owner"
                      name="owner_name"
                      required
                      placeholder="Ibrahim OUÉDRAOGO"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="up-phone">Téléphone</Label>
                    <Input id="up-phone" name="phone" inputMode="tel" placeholder="Numéro avec indicatif (ex: +225, +226, +221...)" />
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
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Vos clients, mesures et commandes restent privés : personne d'autre que votre atelier n'y a
          accès.
        </p>
      </div>
    </div>
  );
}
