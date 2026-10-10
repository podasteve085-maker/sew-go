import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // 1. Vérification locale immédiate (0ms, aucune requête réseau, résilient hors-ligne)
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        return { user: sessionData.session.user };
      }
    } catch {
      // ignore
    }

    // 2. Mode secours hors-ligne (si le token a été purgé mais que l'atelier est actif)
    if (typeof window !== "undefined") {
      const offlineBiz = localStorage.getItem("couturpro_current_business_id");
      if (offlineBiz) {
        const offlineUserId = localStorage.getItem("couturpro_current_user_id") || "offline_user";
        return { user: { id: offlineUserId } };
      }
    }

    // 3. Aucune session locale ni atelier trouvé : redirection vers la page de connexion
    throw redirect({ to: "/auth" });
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
