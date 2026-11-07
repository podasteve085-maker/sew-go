import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // 1. Accès immédiat (0ms) en mode hors-ligne ou session locale existante.
    // Garantit que la navigation entre onglets, sous-onglets et fiches
    // ne bloque jamais et ne provoque aucun écran blanc/marron hors-ligne.
    if (typeof window !== "undefined") {
      const offlineBiz = localStorage.getItem("couturpro_current_business_id");
      const offlineUserId = localStorage.getItem("couturpro_current_user_id");
      if (offlineBiz && offlineUserId) {
        return { user: { id: offlineUserId } };
      }
    }

    // 2. Si aucun atelier local n'est enregistré sur cet appareil, vérifier la session Supabase
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) return { user: sessionData.session.user };
    } catch {
      // ignore
    }

    throw redirect({ to: "/auth" });
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
