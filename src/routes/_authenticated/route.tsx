import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Vérification instantanée du cache local (0ms, sans réseau)
    // Fonctionne identiquement en ligne ET hors-ligne.
    // Les clés sont posées par use-business.ts lors de tout login réussi.
    if (typeof window !== "undefined") {
      const offlineBiz = localStorage.getItem("couturpro_current_business_id");
      const offlineUserId = localStorage.getItem("couturpro_current_user_id");
      if (offlineBiz && offlineUserId) return { user: { id: offlineUserId } };
    }

    // Pas de cache local : vérification réseau (premier accès sur nouvel appareil)
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
