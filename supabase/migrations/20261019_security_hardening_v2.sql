-- ==============================================================================
-- CouturPro / FacturaPro — MIGRATION DE DURCISSEMENT INTÉGRAL V2 (POST-AUDIT MAÎTRE)
-- Date : Octobre 2026
-- Résout :
-- 1. VULN-23 (Critique) : Blocage absolu de l'auto-élévation de plan dans public.businesses
-- 2. VULN-24 (Critique) : Protection stricte contre la modification directe des transactions
-- 3. VULN-25 (Élevé) : Verrouillage RLS Storage RESTRICTIVE (élimination du bypass cross-tenant)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PROTECTION STRICTE DE LA TABLE businesses (VULN-23)
-- Empêche formellement tout utilisateur régulier de modifier son propre forfait (plan),
-- le statut de son abonnement (plan_status), sa date d'expiration (plan_expires_at)
-- ou ses droits administrateur (is_admin).
-- Seuls le rôle service_role (Edge Functions de webhook) et les super-administrateurs
-- sont autorisés à changer ces valeurs financières critiques.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_business_subscription_and_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si l'appel provient d'un utilisateur régulier authentifié (non-admin)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    -- A. Interdiction de s'auto-attribuer ou retirer les droits administrateur
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Action interdite : seul un administrateur peut modifier les privilèges d''administration.';
    END IF;

    -- B. Interdiction absolue de modifier le plan d'abonnement
    IF NEW.plan IS DISTINCT FROM OLD.plan THEN
      RAISE EXCEPTION 'Action interdite : la formule d''abonnement ne peut être modifiée que via le webhook de paiement sécurisé.';
    END IF;

    -- C. Interdiction absolue de modifier le statut de l'abonnement
    IF NEW.plan_status IS DISTINCT FROM OLD.plan_status THEN
      RAISE EXCEPTION 'Action interdite : le statut de l''abonnement ne peut être modifié que via le webhook de paiement sécurisé.';
    END IF;

    -- D. Interdiction absolue de prolonger la date d'expiration
    IF NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at THEN
      RAISE EXCEPTION 'Action interdite : la durée de validité ne peut être prolongée que via le webhook de paiement sécurisé.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_business_subscription ON public.businesses;
CREATE TRIGGER trg_protect_business_subscription
  BEFORE UPDATE OF is_admin, plan, plan_status, plan_expires_at ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_business_subscription_and_admin();

REVOKE ALL ON FUNCTION public.protect_business_subscription_and_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_business_subscription_and_admin() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. VERROUILLAGE DES TRANSACTIONS DE PAIEMENT EN UPDATE (VULN-24)
-- Les utilisateurs réguliers ne peuvent jamais modifier une transaction existante
-- (par exemple passer manuellement un enregistrement de 'pending' à 'completed').
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_payment_transaction_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Seuls les administrateurs et le rôle service_role (webhooks) peuvent modifier une transaction
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Action interdite : la mise à jour des transactions de paiement est réservée au système d''encaissement automatisé.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_payment_transaction_update ON public.payment_transactions;
CREATE TRIGGER trg_protect_payment_transaction_update
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_payment_transaction_update();

REVOKE ALL ON FUNCTION public.protect_payment_transaction_update() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_payment_transaction_update() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. VERROUILLAGE SUPABASE STORAGE RESTRICTIVE (VULN-25)
-- Correction de la faille de cumul permissif :
-- En remplaçant la politique par AS RESTRICTIVE, PostgreSQL impose obligatoirement :
-- (Condition de dossier propriétaire 'atelier insert own') AND (Condition de type MIME)
-- Empêche tout contournement d'écriture croisée entre ateliers.
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "enforce_atelier_image_mime" ON storage.objects;

CREATE POLICY "enforce_atelier_image_mime" ON storage.objects
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'atelier' AND (
      (metadata->>'mimetype') IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
      OR name ~* '\.(jpe?g|png|webp|avif)$'
    )
  );

-- ------------------------------------------------------------------------------
-- 4. RECHARGEMENT DU SCHÉMA POSTGREST
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
