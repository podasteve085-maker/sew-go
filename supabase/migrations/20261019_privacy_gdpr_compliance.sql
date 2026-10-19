-- ==============================================================================
-- CouturPro / FacturaPro — MIGRATION DE CONFORMITÉ RGPD & PROTECTION DE LA VIE PRIVÉE
-- Date : Octobre 2026
-- Résout :
-- 1. Droit à l'effacement / Droit à l'oubli intégral (Art. 17 RGPD) : RPC delete_business_and_all_data
-- 2. Traçabilité des exports et accès aux données personnelles (Art. 30 & 32 RGPD)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FONCTION RPC DE SUPPRESSION ATOMIQUE INTÉGRALE D'UN ATELIER (DROIT À L'OUBLI)
-- Supprime définitivement et en cascade toutes les données rattachées à un atelier :
-- clients, mensurations, commandes, paiements, rendez-vous, modèles, transactions,
-- journaux d'audit et l'atelier lui-même.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_business_and_all_data(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Vérification d'autorisation stricte : seul le propriétaire de l'atelier ou un superadmin peut détruire le compte
  IF NOT (public.owns_business(p_business_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Action non autorisée : vous n''avez pas les privilèges pour supprimer cet atelier.';
  END IF;

  -- 1. Supprimer les paiements rattachés aux commandes de l'atelier
  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id FROM public.orders WHERE business_id = p_business_id
  );

  -- 2. Supprimer les photos de commandes
  DELETE FROM public.order_images
  WHERE business_id = p_business_id;

  -- 3. Supprimer les commandes
  DELETE FROM public.orders
  WHERE business_id = p_business_id;

  -- 4. Supprimer les valeurs de mesures
  DELETE FROM public.measurement_values
  WHERE business_id = p_business_id;

  -- 5. Supprimer les relevés de mesures
  DELETE FROM public.measurement_sets
  WHERE business_id = p_business_id;

  -- 6. Supprimer les modèles de mesures personnalisés
  DELETE FROM public.measurement_templates
  WHERE business_id = p_business_id;

  -- 7. Supprimer les rendez-vous
  DELETE FROM public.appointments
  WHERE business_id = p_business_id;

  -- 8. Supprimer les clients
  DELETE FROM public.clients
  WHERE business_id = p_business_id;

  -- 9. Supprimer les modèles du catalogue / lookbook
  DELETE FROM public.catalog_models
  WHERE business_id = p_business_id;

  -- 10. Supprimer les types de vêtements
  DELETE FROM public.garment_types
  WHERE business_id = p_business_id;

  -- 11. Supprimer les transactions de paiement
  DELETE FROM public.payment_transactions
  WHERE business_id = p_business_id;

  -- 12. Supprimer les journaux d'audit de sécurité liés à cet atelier
  DELETE FROM public.audit_security_logs
  WHERE business_id = p_business_id;

  -- 13. Supprimer enfin l'atelier lui-même
  DELETE FROM public.businesses
  WHERE id = p_business_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_business_and_all_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_business_and_all_data(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. FONCTION RPC DE JOURNALISATION SÉCURISÉE DES ACTIONS RGPD (PORTABILITÉ / AUDIT)
-- Permet aux utilisateurs authentifiés d'inscrire un log certifié lors des exports
-- de données personnelles pour satisfaire aux obligations d'Accountability (Art. 30 RGPD).
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_privacy_audit_event(
  p_business_id uuid,
  p_action text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Vérification d'autorisation : l'utilisateur doit être propriétaire de l'atelier
  IF NOT (public.owns_business(p_business_id) OR public.is_admin()) THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_security_logs (
    business_id,
    user_id,
    action,
    details,
    created_at
  ) VALUES (
    p_business_id,
    auth.uid(),
    p_action,
    p_details,
    now()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.log_privacy_audit_event(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_privacy_audit_event(uuid, text, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. RECHARGEMENT DU SCHÉMA POSTGREST
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
