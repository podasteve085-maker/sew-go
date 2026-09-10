import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
};

/** L'atelier de l'utilisateur connecté (créé automatiquement à l'inscription). */
export function useBusiness() {
  return useQuery({
    queryKey: ["business"],
    staleTime: 60_000,
    queryFn: async (): Promise<Business | null> => {
      const { data, error } = await supabase
        .from("businesses")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Business | null;
    },
  });
}
