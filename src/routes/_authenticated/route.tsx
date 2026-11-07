import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;

    // 1. Accès immédiat (0ms) en ligne comme hors-ligne si l'atelier ou une session a déjà été ouvert.
    // Ne jamais bloquer la navigation entre onglets, sous-pages ou enregistrements.
    const offlineBiz = localStorage.getItem("couturpro_current_business_id");
    const offlineUserId = localStorage.getItem("couturpro_current_user_id");
    const cachedBiz = localStorage.getItem("couturpro_cached_business");
    const hasSbToken = Object.keys(localStorage).some(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
    );

    if (offlineBiz || offlineUserId || cachedBiz || hasSbToken) {
      let resolvedUserId = offlineUserId;
      if (!resolvedUserId && cachedBiz) {
        try {
          const parsed = JSON.parse(cachedBiz);
          resolvedUserId = parsed.owner_id || parsed.id;
          if (resolvedUserId) localStorage.setItem("couturpro_current_user_id", resolvedUserId);
        } catch {
          // ignore
        }
      }
      return { user: { id: resolvedUserId || "authenticated-user" } };
    }

    // 2. Vérification réseau uniquement pour un tout premier accès (nouvel appareil sans données)
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        try {
          localStorage.setItem("couturpro_current_user_id", sessionData.session.user.id);
        } catch {
          // ignore
        }
        return { user: sessionData.session.user };
      }
    } catch {
      // ignore
    }

    // 3. Aucun compte ni session : rediriger vers la page de connexion
    throw redirect({ to: "/auth" });
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
