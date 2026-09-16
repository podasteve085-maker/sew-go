import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SubscriptionPlan = "free" | "pro_monthly" | "pro_yearly" | "unlimited";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing";

export type Business = {
  id: string;
  owner_id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  currency: string;
  logo_url: string | null;
  receipt_note: string | null;
  plan: SubscriptionPlan;
  plan_status: SubscriptionStatus;
  plan_expires_at: string | null;
  is_admin: boolean;
};

/** L'atelier de l'utilisateur connecté (créé automatiquement à l'inscription). */
export function useBusiness() {
  return useQuery({
    queryKey: ["business"],
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<Business | null> => {
      // Vérifier l'utilisateur avant la requête métier : sans session Supabase,
      // RLS renvoie une erreur et l'écran affichait à tort une simple erreur réseau.
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw new Error("Votre session a expiré. Reconnectez-vous pour accéder à votre atelier.");
      if (!authData.user) throw new Error("Aucune session active. Reconnectez-vous pour accéder à votre atelier.");

      const { data, error } = await supabase
        .from("businesses")
        .select("*")
        .eq("owner_id", authData.user.id)
        .maybeSingle();

      if (error) {
        console.error("[useBusiness error]", error);
        throw new Error(`Impossible de charger votre atelier (${error.message})`);
      }
      if (!data) return null;

      return {
        ...data,
        plan: ((data as Record<string, unknown>).plan as SubscriptionPlan) || "free",
        plan_status: ((data as Record<string, unknown>).plan_status as SubscriptionStatus) || "active",
        plan_expires_at: ((data as Record<string, unknown>).plan_expires_at as string) || null,
        is_admin: Boolean((data as Record<string, unknown>).is_admin),
      } as Business;
    },
  });
}
