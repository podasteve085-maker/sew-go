import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Vérification instantanée depuis la mémoire locale (0 ms au lieu de 1 seconde de latence réseau)
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      const { data: userData, error } = await supabase.auth.getUser();
      if (error || !userData.user) throw redirect({ to: "/auth" });
      return { user: userData.user };
    }
    return { user: data.session.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
