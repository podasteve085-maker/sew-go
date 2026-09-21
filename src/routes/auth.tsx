import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Scissors,
  Loader2,
  ArrowLeft,
  KeyRound,
  CheckCircle2,
  ShieldCheck,
  LogOut,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Store,
  User,
  Phone,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import heroImage from "@/assets/hero-atelier.jpg";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (
    search: Record<string, unknown>,
  ): { logout?: boolean; reconnect?: boolean } => {
    const res: { logout?: boolean; reconnect?: boolean } = {};
    if (search["logout"] === true || search["logout"] === "true") res.logout = true;
    if (search["reconnect"] === true || search["reconnect"] === "true") res.reconnect = true;
    return res;
  },
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
  const { logout, reconnect } = Route.useSearch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"tabs" | "forgot" | "update_password">("tabs");
  const [activeSession, setActiveSession] = useState<{ email: string; businessName?: string } | null>(null);

  // Champs formulaires
  const [signInEmail, setSignInEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  useEffect(() => {
    // 1. Détection immédiate du jeton de récupération dans le hash de l'URL (#type=recovery)
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("type=recovery")) {
      setMode("update_password");
      return;
    }

    // 2. Si l'utilisateur demande explicitement une déconnexion pour changer de compte
    if (logout || reconnect) {
      supabase.auth.signOut().then(() => {
        setActiveSession(null);
      });
      return;
    }

    // 3. Vérification de session active existante
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) {
        const email = data.session.user.email ?? "";
        // Récupérer le nom de l'atelier pour l'affichage de garde
        const { data: b } = await supabase
          .from("businesses")
          .select("name")
          .eq("owner_id", data.session.user.id)
          .maybeSingle();

        setActiveSession({ email, ...(b?.name ? { businessName: b.name } : {}) });
      }
    });

    // 4. Écoute des événements de récupération de mot de passe
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("update_password");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [logout, reconnect]);

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
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20 selection:text-primary">
      <div className="faso-stripes h-2 w-full shrink-0" />

      <div className="flex-1 grid lg:grid-cols-12 min-h-[calc(100vh-8px)]">
        {/* Colonne Gauche : Formulaire & Navigation */}
        <div className="lg:col-span-6 xl:col-span-5 flex flex-col justify-between p-6 sm:p-10 lg:p-12 xl:p-16">
          {/* Navigation haute */}
          <div className="flex items-center justify-between mb-8 sm:mb-10">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors group"
            >
              <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-1" />
              <span>Retour à l'accueil</span>
            </Link>

            <Link to="/" className="flex items-center gap-2 font-display text-base sm:text-lg font-bold">
              <span className="flex size-8 sm:size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
                <Scissors className="size-4 sm:size-5" />
              </span>
              <span>CouturPro</span>
            </Link>
          </div>

          {/* Contenu dynamique du formulaire */}
          <div className="w-full max-w-md mx-auto space-y-6 my-auto">
            {/* MODE 1 : MISE À JOUR DU MOT DE PASSE */}
            {mode === "update_password" && (
              <div className="rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs space-y-5">
                <div className="flex items-center gap-3">
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
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={6}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Minimum 6 caractères"
                        autoComplete="new-password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        title={showPassword ? "Masquer" : "Afficher"}
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password">Confirmez le nouveau mot de passe</Label>
                    <Input
                      id="confirm-password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Retapez le mot de passe"
                      autoComplete="new-password"
                    />
                  </div>

                  <Button type="submit" className="w-full font-bold shadow-xs cursor-pointer h-10" disabled={loading}>
                    {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer le mot de passe
                  </Button>
                </form>
              </div>
            )}

            {/* MODE 2 : DEMANDE DE RÉINITIALISATION DU MOT DE PASSE */}
            {mode === "forgot" && (
              <div className="rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs space-y-5">
                <div className="flex items-center gap-3">
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
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Consultez votre boîte <strong className="text-foreground">{resetEmail || signInEmail}</strong> (vérifiez aussi vos spams). Cliquez sur le lien pour choisir votre nouveau mot de passe.
                      </p>
                    </div>
                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full cursor-pointer"
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
                      <div className="relative">
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
                          className="pl-9"
                        />
                        <Mail className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Nous vous enverrons un lien sécurisé pour redéfinir votre mot de passe.
                      </p>
                    </div>

                    <Button type="submit" className="w-full font-bold shadow-xs cursor-pointer h-10" disabled={loading}>
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

            {/* MODE 3 : ONGLETS NORMAUX OU SESSION ACTIVE */}
            {mode === "tabs" && (
              activeSession ? (
                <div className="rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs space-y-5">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
                      <ShieldCheck className="size-5" />
                    </span>
                    <div>
                      <h2 className="font-display text-base font-bold text-foreground">Session active détectée</h2>
                      <p className="text-xs text-muted-foreground">
                        Cet appareil est déjà connecté à un atelier.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-1">
                    <p className="font-display text-sm font-bold text-foreground">
                      {activeSession.businessName || "Mon atelier"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Compte connecté : <strong className="text-foreground">{activeSession.email}</strong>
                    </p>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Pour garantir la confidentialité de votre atelier, confirmez si vous souhaitez accéder à cet atelier ou vous déconnecter pour changer de compte.
                  </p>

                  <div className="space-y-2 pt-1">
                    <Button
                      className="w-full font-bold shadow-xs cursor-pointer h-10"
                      onClick={() => navigate({ to: "/dashboard", replace: true })}
                    >
                      Continuer vers mon atelier →
                    </Button>

                    <Button
                      variant="outline"
                      className="w-full text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer h-10"
                      onClick={async () => {
                        setLoading(true);
                        await supabase.auth.signOut();
                        setActiveSession(null);
                        setLoading(false);
                        toast.info("Session fermée. Vous pouvez saisir vos identifiants.");
                      }}
                    >
                      <LogOut className="mr-2 size-3.5" /> Se déconnecter / Utiliser un autre compte
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-sm space-y-6">
                  <Tabs defaultValue="signin" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 p-1 bg-muted/70 rounded-xl h-11">
                      <TabsTrigger value="signin" className="rounded-lg font-bold text-xs sm:text-sm">
                        Connexion
                      </TabsTrigger>
                      <TabsTrigger value="signup" className="rounded-lg font-bold text-xs sm:text-sm">
                        Créer mon atelier
                      </TabsTrigger>
                    </TabsList>

                    {/* Formulaire Connexion */}
                    <TabsContent value="signin" className="mt-6 space-y-4">
                      <div>
                        <h1 className="font-display text-xl sm:text-2xl font-extrabold text-foreground">
                          Bon retour parmi nous 👋
                        </h1>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Entrez vos identifiants pour ouvrir votre atelier de couture.
                        </p>
                      </div>

                      <form onSubmit={signIn} className="space-y-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="in-email">Email</Label>
                          <div className="relative">
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
                              className="pl-9"
                            />
                            <Mail className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          </div>
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
                          <div className="relative">
                            <Input
                              id="in-password"
                              name="password"
                              type={showPassword ? "text" : "password"}
                              required
                              autoComplete="current-password"
                              placeholder="••••••••"
                              className="pl-9 pr-10"
                            />
                            <Lock className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                              title={showPassword ? "Masquer" : "Afficher"}
                            >
                              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                          </div>
                        </div>

                        <Button type="submit" className="w-full font-bold shadow-xs cursor-pointer h-10" disabled={loading}>
                          {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Se connecter à mon atelier
                        </Button>
                      </form>
                    </TabsContent>

                    {/* Formulaire Création d'atelier */}
                    <TabsContent value="signup" className="mt-6 space-y-4">
                      <div>
                        <h1 className="font-display text-xl sm:text-2xl font-extrabold text-foreground">
                          Créez votre atelier ✨
                        </h1>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Gratuit, sans engagement et prêt en 30 secondes.
                        </p>
                      </div>

                      <form onSubmit={signUp} className="space-y-3.5">
                        <div className="space-y-1.5">
                          <Label htmlFor="up-business">Nom de l'atelier</Label>
                          <div className="relative">
                            <Input
                              id="up-business"
                              name="business_name"
                              required
                              placeholder="ex: Atelier Ibrahim Style"
                              className="pl-9"
                            />
                            <Store className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="up-owner">Nom du responsable</Label>
                          <div className="relative">
                            <Input
                              id="up-owner"
                              name="owner_name"
                              required
                              placeholder="ex: Ibrahim Ouédraogo"
                              className="pl-9"
                            />
                            <User className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="up-phone">Téléphone / WhatsApp</Label>
                          <div className="relative">
                            <Input
                              id="up-phone"
                              name="phone"
                              inputMode="tel"
                              placeholder="+225 07 00 00 00 / +226 70 00 00 00"
                              className="pl-9"
                            />
                            <Phone className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="up-email">Email professionnel</Label>
                          <div className="relative">
                            <Input
                              id="up-email"
                              name="email"
                              type="email"
                              required
                              autoComplete="email"
                              placeholder="contact@atelier.com"
                              className="pl-9"
                            />
                            <Mail className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="up-password">Mot de passe (6 car. minimum)</Label>
                          <div className="relative">
                            <Input
                              id="up-password"
                              name="password"
                              type={showSignUpPassword ? "text" : "password"}
                              required
                              minLength={6}
                              autoComplete="new-password"
                              placeholder="••••••••"
                              className="pl-9 pr-10"
                            />
                            <Lock className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <button
                              type="button"
                              onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                              title={showSignUpPassword ? "Masquer" : "Afficher"}
                            >
                              {showSignUpPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                          </div>
                        </div>

                        <Button type="submit" className="w-full font-bold shadow-xs cursor-pointer h-10 mt-2" disabled={loading}>
                          {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Créer mon atelier gratuitement
                        </Button>
                      </form>
                    </TabsContent>
                  </Tabs>
                </div>
              )
            )}
          </div>

          {/* Pied gauche : Sécurité & isolation */}
          <div className="mt-8 pt-6 border-t border-border/60 text-center">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-primary shrink-0" />
              <span>Données 100% privées & isolées · Chaque atelier dispose de son espace exclusif</span>
            </div>
          </div>
        </div>

        {/* Colonne Droite : Vitrine Visuelle Haute Couture (Visible sur Desktop / Tablette large) */}
        <div className="hidden lg:col-span-6 xl:col-span-7 lg:relative lg:flex flex-col justify-between p-12 xl:p-16 overflow-hidden bg-stone-900 text-white">
          <img
            src={heroImage}
            alt="Atelier de couture CouturPro"
            className="absolute inset-0 h-full w-full object-cover object-center opacity-45 scale-105 filter saturate-150"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950/95 via-stone-900/75 to-stone-950/40" />

          {/* En-tête vitrine */}
          <div className="relative z-10 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1 text-xs font-semibold backdrop-blur-md">
              <Sparkles className="size-3.5 text-amber-400" /> Le logiciel n°1 des ateliers de couture
            </span>
          </div>

          {/* Témoignage central */}
          <div className="relative z-10 space-y-6 max-w-lg my-auto">
            <div className="rounded-3xl border border-white/15 bg-white/10 p-7 backdrop-blur-md shadow-2xl space-y-4">
              <div className="flex items-center gap-1 text-amber-400 text-sm">
                {"★".repeat(5)}
              </div>
              <p className="font-display text-lg sm:text-xl font-medium leading-snug text-white/95 italic">
                « CouturPro a transformé le quotidien de mon atelier. Plus de carnet perdu, mes mesures sont toujours disponibles et mes clients reçoivent leurs reçus directement sur WhatsApp. »
              </p>
              <div className="flex items-center gap-3 pt-3 border-t border-white/15">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
                  MP
                </div>
                <div>
                  <p className="font-bold text-sm text-white">Mireille P.</p>
                  <p className="text-xs text-white/70">Styliste & Propriétaire d'atelier de couture</p>
                </div>
              </div>
            </div>

            {/* Badges fonctionnalités clés */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-xs">
                <p className="text-xs font-bold text-amber-300">📏 Mesures Précises</p>
                <p className="text-[11px] text-white/70 mt-0.5">Modèles Homme, Femme, Enfant</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-xs">
                <p className="text-xs font-bold text-emerald-300">✂️ Suivi Commandes</p>
                <p className="text-[11px] text-white/70 mt-0.5">Alertes de livraison & encaissements</p>
              </div>
            </div>
          </div>

          {/* Pied droit */}
          <div className="relative z-10 flex items-center justify-between text-xs text-white/60">
            <span>© {new Date().getFullYear()} CouturPro · Conçu pour les maîtres tailleurs</span>
            <span>Afrique & Monde 🌍</span>
          </div>
        </div>
      </div>
    </div>
  );
}
