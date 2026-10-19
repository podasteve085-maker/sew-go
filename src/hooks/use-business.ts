import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/quotas";

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
  plan?: SubscriptionPlan;
  plan_status?: SubscriptionStatus;
  plan_expires_at?: string | null;
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
      const getCached = (): Business | null => {
        if (typeof window === "undefined") return null;
        try {
          const cached = localStorage.getItem("couturpro_cached_business");
          return cached ? (JSON.parse(cached) as Business) : null;
        } catch {
          return null;
        }
      };

      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

      // Mode hors-ligne direct : retour instantané des données de l'atelier en mémoire locale
      if (!isOnline) {
        const cached = getCached();
        if (cached) return cached;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        let userId = sessionData.session?.user?.id;

        if (!userId) {
          try {
            const { data: authData } = await supabase.auth.getUser();
            userId = authData?.user?.id;
          } catch {
            // mode hors ligne ou micro-coupure réseau
          }
        }

        if (!userId) {
          const cached = getCached();
          if (cached) return cached;
          return null;
        }

        const { data, error } = await supabase
          .from("businesses")
          .select("*")
          .eq("owner_id", userId)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          const cached = getCached();
          return cached;
        }

        const rawData = data as unknown as Record<string, unknown>;

        const plan = (rawData["plan"] as SubscriptionPlan) || "free";
        const planExpiresAt = (rawData["plan_expires_at"] as string) || null;

        let planStatus: SubscriptionStatus = "active";
        if (rawData["is_admin"]) {
          planStatus = "admin";
        } else if (plan !== "free" && planExpiresAt && new Date(planExpiresAt).getTime() <= Date.now()) {
          planStatus = "expired";
        }

        const result: Business = {
          ...data,
          plan,
          plan_status: planStatus,
          plan_expires_at: planExpiresAt,
          is_admin: Boolean(rawData["is_admin"]),
        };

        if (typeof window !== "undefined") {
          try {
            localStorage.setItem("couturpro_cached_business", JSON.stringify(result));
            localStorage.setItem("couturpro_current_business_id", result.id);
            if (userId) localStorage.setItem("couturpro_current_user_id", userId);
          } catch {
            // ignore
          }
        }

        return result;
      } catch (err) {
        // En cas d'échec réseau, renvoyer l'atelier mis en cache sans jamais bloquer l'interface
        const cached = getCached();
        if (cached) return cached;
        console.warn("[useBusiness] Utilisation hors-ligne sans cache :", err);
        return null;
      }
    },
  });
}
