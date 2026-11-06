import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Vérification de session Supabase en priorité absolue
    // P1-4 : la garde hors-ligne ne s'active QUE si une vraie session auth est présente
    // (jeton persisté par persistSession:true), pas uniquement deux clés localStorage.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) return { user: sessionData.session.user };
    } catch {
      // Réseau coupé ou timeout : vérifier si on est hors-ligne avec session persistée
    }

    // Mode hors-ligne : autoriser uniquement si getSession() avait précédemment
    // renvoyé un user (jeton stocké dans storage). Sans session valide, les deux
    // clés localStorage seules (business_id + user_id) ne suffisent pas.
    if (typeof window !== "undefined" && typeof navigator !== "undefined" && !navigator.onLine) {
      const offlineBiz = localStorage.getItem("couturpro_current_business_id");
      const offlineUserId = localStorage.getItem("couturpro_current_user_id");
      // On accepte l'accès hors-ligne uniquement si les deux clés AND un jeton
      // Supabase sont présents dans sessionStorage/localStorage (signe d'un vrai login).
      const hasSupabaseToken =
        Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token")) ||
        Object.keys(sessionStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      if (offlineBiz && offlineUserId && hasSupabaseToken) {
        return { user: { id: offlineUserId } };
      }
    }

    throw redirect({ to: "/auth" });
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
