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
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<Business | null> => {
      // Optimisation performance mobile : lecture instantanée de la session locale en mémoire (0ms réseau)
      const { data: sessionData } = await supabase.auth.getSession();
      let userId = sessionData.session?.user?.id;

      if (!userId) {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) {
          throw new Error("Aucune session active. Reconnectez-vous pour accéder à votre atelier.");
        }
        userId = authData.user.id;
      }

      try {
        const { data, error } = await supabase
          .from("businesses")
          .select("*")
          .eq("owner_id", userId)
          .maybeSingle();

        if (error) {
          throw error;
        }
        if (!data) return null;

        const rawData = data as unknown as Record<string, unknown>;
        const result: Business = {
          ...data,
          plan: (rawData["plan"] as SubscriptionPlan) || "free",
          plan_status: (rawData["plan_status"] as SubscriptionStatus) || "active",
          plan_expires_at: (rawData["plan_expires_at"] as string) || null,
          is_admin: Boolean(rawData["is_admin"]),
        };

        if (typeof window !== "undefined") {
          try {
            localStorage.setItem("couturpro_cached_business", JSON.stringify(result));
            localStorage.setItem("couturpro_current_business_id", result.id);
          } catch {
            // ignore
          }
        }

        return result;
      } catch (networkError) {
        // En cas de coupure de réseau / mode hors-ligne, charger le profil atelier depuis le cache local
        if (typeof window !== "undefined") {
          const cached = localStorage.getItem("couturpro_cached_business");
          if (cached) {
            try {
              return JSON.parse(cached) as Business;
            } catch {
              // ignore
            }
          }
        }
        console.error("[useBusiness error]", networkError);
        throw new Error("Impossible de charger votre atelier hors-ligne.");
      }
    },
  });
}
