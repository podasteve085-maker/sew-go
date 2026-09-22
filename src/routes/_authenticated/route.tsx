import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

    // Mode hors-ligne : vérification de la session locale sans appel réseau
    if (!isOnline) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        return { user: sessionData.session.user };
      }
      if (typeof window !== "undefined" && localStorage.getItem("couturpro_current_business_id")) {
        return { user: { id: localStorage.getItem("couturpro_current_user_id") || "offline_user" } };
      }
      throw redirect({ to: "/auth" });
    }

    try {
      // Mode en ligne : validation côté serveur Supabase
      const { data: userData, error } = await supabase.auth.getUser();
      if (error || !userData.user) {
        // Micro-coupure réseau : vérifier la session locale avant d'évincer l'utilisateur
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
          return { user: sessionData.session.user };
        }
        if (typeof window !== "undefined" && localStorage.getItem("couturpro_current_business_id")) {
          return { user: { id: localStorage.getItem("couturpro_current_user_id") || "offline_user" } };
        }
        throw redirect({ to: "/auth" });
      }
      return { user: userData.user };
    } catch {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        return { user: sessionData.session.user };
      }
      if (typeof window !== "undefined" && localStorage.getItem("couturpro_current_business_id")) {
        return { user: { id: localStorage.getItem("couturpro_current_user_id") || "offline_user" } };
      }
      throw redirect({ to: "/auth" });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
