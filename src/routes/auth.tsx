import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
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
  Check,
  AlertCircle,
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
  beforeLoad: async ({ search }) => {
    // 1. Si l'utilisateur a explicitement demandé à se déconnecter ou changer de compte, on ne redirige pas
    if (search.logout || search.reconnect) {
      return;
    }

    // 2. Si on est dans un flux de réinitialisation de mot de passe (mode reset/update_password, code PKCE, ou hash #type=recovery),
    // on NE DOIT PAS rediriger vers /dashboard afin de laisser l'utilisateur choisir son nouveau mot de passe !
    const isResetSearch =
      search.mode === "reset" || search.mode === "update_password" || Boolean(search.code);
    const isResetHash =
      typeof window !== "undefined" &&
      (window.location.hash.includes("type=recovery") || window.location.hash.includes("access_token"));

    if (isResetSearch || isResetHash) {
      return;
    }

    // 3. Redirection standard vers le dashboard si une session valide préexistante est active
    if (typeof window !== "undefined") {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
          throw redirect({ to: "/dashboard" });
        }
      } catch (e) {
        if (e && typeof e === "object" && "to" in e) {
          throw e;
        }
      }
    }
  },
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    logout?: boolean;
    reconnect?: boolean;
    tab?: "signin" | "signup";
    mode?: "tabs" | "forgot" | "reset" | "update_password";
    code?: string;
    error?: string;
    error_code?: string;
    error_description?: string;
  } => {
    const res: {
      logout?: boolean;
      reconnect?: boolean;
      tab?: "signin" | "signup";
      mode?: "tabs" | "forgot" | "reset" | "update_password";
      code?: string;
      error?: string;
      error_code?: string;
      error_description?: string;
    } = {};
    if (search["logout"] === true || search["logout"] === "true") res.logout = true;
    if (search["reconnect"] === true || search["reconnect"] === "true") res.reconnect = true;
    if (search["tab"] === "signup" || search["tab"] === "signin") res.tab = search["tab"];
    if (
      search["mode"] === "forgot" ||
      search["mode"] === "reset" ||
      search["mode"] === "update_password" ||
      search["mode"] === "tabs"
    ) {
      res.mode = search["mode"];
    }
    if (typeof search["code"] === "string" && search["code"].trim()) {
      res.code = search["code"].trim();
    }
    if (typeof search["error"] === "string") res.error = search["error"];
    if (typeof search["error_code"] === "string") res.error_code = search["error_code"];
    if (typeof search["error_description"] === "string") res.error_description = search["error_description"];
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
  const search = Route.useSearch();
  const {
    logout,
    reconnect,
    tab,
    mode: searchMode,
    error: searchError,
    error_code: searchErrorCode,
    error_description: searchErrorDesc,
  } = search;

  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"tabs" | "forgot" | "update_password">(() => {
    if (searchMode === "forgot") return "forgot";
    if (searchMode === "reset" || searchMode === "update_password") return "update_password";
    return "tabs";
  });

  // Champs formulaires
  const [signInEmail, setSignInEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [failedAttempts, setFailedAttempts] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("couturpro_auth_failures");
      return saved ? parseInt(saved, 10) || 0 : 0;
    }
    return 0;
  });

  const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("couturpro_auth_lockout");
      const num = saved ? parseInt(saved, 10) : null;
      if (num && num > Date.now()) return num;
    }
    return null;
  });

  // Compte à rebours de renvoi d'email (cooldown anti-spam / anti rate-limit)
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash || "";

    // 1. Détection des erreurs dans le lien (ex: #error=access_denied&error_code=otp_expired)
    let detectedError = searchErrorDesc || searchError || null;
    let detectedErrorCode = searchErrorCode || null;

    if (hash.includes("error=")) {
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      detectedError = hashParams.get("error_description") || hashParams.get("error") || detectedError;
      detectedErrorCode = hashParams.get("error_code") || detectedErrorCode;
    }

    if (detectedError || detectedErrorCode) {
      let friendlyMsg = "Ce lien de réinitialisation est invalide ou a expiré.";
      if (
        detectedErrorCode === "otp_expired" ||
        (detectedError && (detectedError.toLowerCase().includes("expired") || detectedError.toLowerCase().includes("invalid")))
      ) {
        friendlyMsg = "Ce lien a expiré ou a déjà été utilisé. Saisissez votre email ci-dessous pour en recevoir un nouveau.";
      }
      setLinkError(friendlyMsg);
      setMode("forgot");
      toast.error("Lien non valide", { description: friendlyMsg });
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {}
      return;
    }

    // 2. Détection du flux de récupération (hash ou search)
    const isRecovery =
      hash.includes("type=recovery") ||
      searchMode === "reset" ||
      searchMode === "update_password" ||
      Boolean(search.code && (searchMode === "reset" || hash.includes("type=recovery")));

    if (isRecovery) {
      setMode("update_password");
      // On reste en mode réinitialisation de mot de passe, PAS de redirection vers /dashboard
      return;
    }

    // 3. Déconnexion explicite demandée
    if (logout || reconnect) {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
      supabase.auth.signOut({ scope: "global" }).catch(() => {});
      return;
    }

    // 4. Si déjà connecté sans flux de récupération, rediriger vers /dashboard
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user && mode !== "update_password" && !isRecovery) {
        navigate({ to: "/dashboard", replace: true });
      }
    });

    // 5. Écoute de l'événement Supabase de récupération de mot de passe
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
  }, [logout, reconnect, searchMode, searchError, searchErrorCode, searchErrorDesc]);

  // Connexion avec protection anti-brute force
  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lockoutUntil && Date.now() < lockoutUntil) {
      const remainingSec = Math.ceil((lockoutUntil - Date.now()) / 1000);
      toast.error("Tentatives excessives", {
        description: `Sécurité anti-brute-force : veuillez patienter ${remainingSec} secondes avant de retenter.`,
      });
      return;
    }

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
      const nextFailures = failedAttempts + 1;
      setFailedAttempts(nextFailures);
      try {
        sessionStorage.setItem("couturpro_auth_failures", String(nextFailures));
      } catch {}

      if (nextFailures >= 5) {
        const lockoutTime = Date.now() + 60 * 1000; // 60s cooldown
        setLockoutUntil(lockoutTime);
        try {
          sessionStorage.setItem("couturpro_auth_lockout", String(lockoutTime));
        } catch {}
        toast.error("Compte temporairement bloqué", {
          description: "5 tentatives infructueuses consécutives. Veuillez patienter 60 secondes.",
        });
        return;
      }

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

    setFailedAttempts(0);
    setLockoutUntil(null);
    try {
      sessionStorage.removeItem("couturpro_auth_failures");
      sessionStorage.removeItem("couturpro_auth_lockout");
    } catch {}
    navigate({ to: "/dashboard", replace: true });
  }

  // Inscription
  async function signUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const emailVal = String(form.get("email")).trim();
    const passwordVal = String(form.get("password"));

    if (passwordVal.length < 6) {
      toast.error("Mot de passe trop court", {
        description: "Le mot de passe doit comporter au moins 6 caractères.",
      });
      return;
    }

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
      toast.error("Veuillez indiquer l'adresse email de votre atelier.");
      return;
    }

    setLoading(true);
    setLinkError(null);
    const redirectUrl = `${window.location.origin}/auth?mode=reset`;
    const { error } = await supabase.auth.resetPasswordForEmail(emailToReset, {
      redirectTo: redirectUrl,
    });
    setLoading(false);

    if (error) {
      const lower = error.message.toLowerCase();
      let description = error.message;
      if (lower.includes("rate limit") || lower.includes("too many") || lower.includes("over_email_send_rate_limit")) {
        description = "Trop de demandes d'envoi d'email. Veuillez patienter 1 minute avant de réessayer.";
      } else if (lower.includes("invalid email")) {
        description = "Format d'adresse email non valide. Vérifiez votre saisie.";
      }
      toast.error("Impossible d'envoyer l'email", { description });
    } else {
      setResetSent(true);
      setCountdown(60);
      toast.success("Email envoyé avec succès !", {
        description: `Un lien a été envoyé à ${emailToReset}. Vérifiez votre boîte mail et vos spams.`,
      });
    }
  }

  // Définir un nouveau mot de passe (après clic sur le lien reçu)
  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword) {
      toast.error("Veuillez saisir votre nouveau mot de passe.");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Mot de passe trop court", {
        description: "Le mot de passe doit comporter au moins 6 caractères.",
      });
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

    toast.success("Nouveau mot de passe enregistré avec succès !", {
      description: "Connexion à votre espace atelier...",
    });

    if (typeof window !== "undefined" && window.history.replaceState) {
      window.history.replaceState(null, "", "/auth");
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
                      Choisissez un mot de passe pour votre atelier (6 caractères minimum).
                    </p>
                  </div>
                </div>

                <form onSubmit={handleUpdatePassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-password">Nouveau mot de passe</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showNewPassword ? "text" : "password"}
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
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        title={showNewPassword ? "Masquer" : "Afficher"}
                      >
                        {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password">Confirmez le nouveau mot de passe</Label>
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        minLength={6}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Retapez le mot de passe"
                        autoComplete="new-password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        title={showConfirmPassword ? "Masquer" : "Afficher"}
                      >
                        {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                    {confirmPassword && newPassword === confirmPassword && (
                      <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1 pt-0.5">
                        <Check className="size-3.5" /> Les deux mots de passe sont identiques
                      </p>
                    )}
                    {confirmPassword && newPassword !== confirmPassword && (
                      <p className="text-[11px] text-destructive font-medium pt-0.5">
                        Les deux mots de passe ne correspondent pas
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full font-bold shadow-xs cursor-pointer h-10"
                    disabled={loading || !newPassword || newPassword.length < 6 || newPassword !== confirmPassword}
                  >
                    {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Enregistrer mon nouveau mot de passe
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
                      setLinkError(null);
                    }}
                    className="flex size-8 items-center justify-center rounded-lg border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Retour à la connexion"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                  <div>
                    <h2 className="font-display text-lg font-bold">Récupérer mon mot de passe</h2>
                    <p className="text-xs text-muted-foreground">
                      Recevez un lien par email pour choisir un nouveau mot de passe
                    </p>
                  </div>
                </div>

                {linkError && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive flex items-start gap-2.5">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <p className="leading-snug">{linkError}</p>
                  </div>
                )}

                {resetSent ? (
                  <div className="space-y-4 text-center py-2">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                      <CheckCircle2 className="size-6" />
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="text-sm font-semibold">Email envoyé avec succès !</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Un lien sécurisé a été envoyé à l'adresse <strong className="text-foreground">{resetEmail || signInEmail}</strong>.
                      </p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
                        💡 <strong>Conseil :</strong> Si l'email n'apparaît pas dans 1 minute, pensez à vérifier votre dossier <strong>Spams ou Courrier indésirable</strong>.
                      </p>
                    </div>
                    <div className="pt-2 space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full text-xs font-semibold h-10 cursor-pointer"
                        disabled={loading || countdown > 0}
                        onClick={handleResetPassword}
                      >
                        {loading ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : countdown > 0 ? (
                          `Renvoyer l'email (${countdown}s)`
                        ) : (
                          "Renvoyer le lien par email"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() => {
                          setMode("tabs");
                          setResetSent(false);
                          setLinkError(null);
                        }}
                      >
                        ← Retour à la connexion
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
                        Nous vous enverrons un lien sécurisé pour créer votre nouveau mot de passe.
                      </p>
                    </div>

                    <Button type="submit" className="w-full font-bold shadow-xs cursor-pointer h-10" disabled={loading}>
                      {loading && <Loader2 className="mr-2 size-4 animate-spin" />} Envoyer le lien par email
                    </Button>

                    <button
                      type="button"
                      onClick={() => {
                        setMode("tabs");
                        setLinkError(null);
                      }}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors pt-2 cursor-pointer"
                    >
                      ← Retour à la connexion
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* MODE 3 : FORMULAIRE DE CONNEXION / CRÉATION D'ATELIER SÉCURISÉ */}
            {mode === "tabs" && (
              <div className="rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-sm space-y-6">
                  <Tabs defaultValue={tab === "signup" ? "signup" : "signin"} className="w-full">
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
            )}
          </div>

          {/* Pied gauche : Sécurité & isolation */}
          <div className="mt-8 pt-6 border-t border-border/60 text-center space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-primary shrink-0" />
              <span>Données 100% privées & isolées · Chaque atelier dispose de son espace exclusif</span>
            </div>
            <div>
              <Link to="/politique-confidentialite" className="text-[11px] text-muted-foreground hover:text-primary underline">
                Politique de confidentialité & Protection des données (RGPD)
              </Link>
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
