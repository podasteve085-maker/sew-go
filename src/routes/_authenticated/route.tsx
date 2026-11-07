import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { OfflineErrorBoundary } from "@/components/offline-error-boundary";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // ─── Étape 1 : tentative réseau ─────────────────────────────────────────
    // Si Supabase répond et renvoie un utilisateur, on est authentifié.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) return { user: sessionData.session.user };
    } catch {
      // Réseau coupé, timeout, ou Supabase inaccessible → passe à l'étape 2.
    }

    // ─── Étape 2 : repli hors-ligne ─────────────────────────────────────────
    // NE PAS conditionner sur navigator.onLine — il est peu fiable sur mobile
    // PWA (peut renvoyer true même sans connectivité réelle, notamment sur
    // Android avec données mobiles sans accès Internet effectif).
    //
    // On autorise l'accès hors-ligne uniquement si :
    //   • un identifiant d'atelier et d'utilisateur sont présents (déjà connecté)
    //   • ET un vrai jeton Supabase est en localStorage/sessionStorage
    //     (preuve d'une authentification réussie antérieure via persistSession:true)
    //
    // Sans ces trois éléments, on redirige vers /auth comme d'habitude.
    if (typeof window !== "undefined") {
      const offlineBiz = localStorage.getItem("couturpro_current_business_id");
      const offlineUserId = localStorage.getItem("couturpro_current_user_id");
      const hasSupabaseToken =
        Object.keys(localStorage).some(
          (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
        ) ||
        Object.keys(sessionStorage).some(
          (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
        );

      if (offlineBiz && offlineUserId && hasSupabaseToken) {
        return { user: { id: offlineUserId } };
      }
    }

    throw redirect({ to: "/auth" });
  },
  component: () => (
    // OfflineErrorBoundary intercepte toute exception de rendu dans l'arborescence
    // AppShell / Outlet. Sans cette barrière, un crash hors-ligne démonterait
    // tout le sous-arbre React et laisserait le fond #1c1917 visible (écran marron).
    <OfflineErrorBoundary>
      <AppShell>
        <Outlet />
      </AppShell>
    </OfflineErrorBoundary>
  ),
});
