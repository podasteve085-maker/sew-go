import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Valider la session côté Supabase, pas seulement le cache local :
    // cela évite de monter les pages protégées avec un jeton expiré.
    const { data: userData, error } = await supabase.auth.getUser();
    if (error || !userData.user) throw redirect({ to: "/auth" });
    return { user: userData.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
