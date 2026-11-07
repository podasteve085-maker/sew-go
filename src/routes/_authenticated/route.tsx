import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { OfflineErrorBoundary } from "@/components/offline-error-boundary";

/**
 * Vérifie en mémoire (sans réseau) si un jeton Supabase valide est présent
 * dans localStorage ou sessionStorage (posé par persistSession:true lors
 * d'un login réussi antérieur).
 */
function getOfflineCredentials(): { userId: string; bizId: string } | null {
  if (typeof window === "undefined") return null;

  const offlineUserId = localStorage.getItem("couturpro_current_user_id");
  const offlineBizId = localStorage.getItem("couturpro_current_business_id");

  const hasSupabaseToken =
    Object.keys(localStorage).some(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
    ) ||
    Object.keys(sessionStorage).some(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
    );

  if (offlineUserId && offlineBizId && hasSupabaseToken) {
    return { userId: offlineUserId, bizId: offlineBizId };
  }
  return null;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // ─── Étape 1 : vérification instantanée du storage local ────────────────
    // AVANT tout appel réseau, on vérifie si des credentials valides existent
    // en mémoire locale. C'est la logique originale qui fonctionnait, avec en
    // plus la vérification du jeton Supabase pour la sécurité.
    //
    // Cette étape est synchrone et ne dépend pas du réseau — elle fonctionne
    // identiquement en ligne et hors-ligne.
    const offline = getOfflineCredentials();
    if (offline) {
      // Des credentials locaux existent → tenter une vérification réseau légère
      // pour rafraîchir la session si on est en ligne, mais ne JAMAIS bloquer
      // si le réseau échoue.
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
          return { user: sessionData.session.user };
        }
        // getSession() a répondu mais pas de session active (token expiré côté serveur)
        // → on fait confiance aux credentials locaux quand même : la sync/refresh
        //   se fera quand le réseau sera disponible.
        return { user: { id: offline.userId } };
      } catch {
        // Réseau coupé ou timeout → on utilise les credentials locaux.
        // C'est le comportement offline-first voulu.
        return { user: { id: offline.userId } };
      }
    }

    // ─── Étape 2 : aucun credential local → vérification réseau obligatoire ─
    // L'utilisateur n'a jamais été connecté sur cet appareil (ou a effacé
    // les données). On doit passer par le réseau.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) return { user: sessionData.session.user };
    } catch {
      // Réseau inaccessible et aucun credential local → /auth
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
