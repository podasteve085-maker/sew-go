import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;

    // 1. Accès immédiat (0ms) en ligne comme hors-ligne si l'atelier a déjà été ouvert
    // Ne jamais bloquer la navigation entre onglets, sous-pages ou enregistrements
    const offlineBiz = localStorage.getItem("couturpro_current_business_id");
    const offlineUserId = localStorage.getItem("couturpro_current_user_id");
    const cachedBiz = localStorage.getItem("couturpro_cached_business");
    const hasSbToken = Object.keys(localStorage).some((k) => k.includes("auth-token"));

    if (offlineBiz || offlineUserId || cachedBiz || hasSbToken) {
      return { user: { id: offlineUserId || "authenticated-user" } };
    }

    // 2. Vérification réseau uniquement pour un premier accès sans aucun cache local
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        localStorage.setItem("couturpro_current_user_id", sessionData.session.user.id);
        return { user: sessionData.session.user };
      }
    } catch {
      // Erreur réseau : laisser passer si un cache existe
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
