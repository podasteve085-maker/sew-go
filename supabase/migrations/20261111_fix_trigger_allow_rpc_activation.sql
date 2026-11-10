-- ==============================================================================
-- Migration : Correctif critique – Autoriser les RPC SECURITY DEFINER à mettre
--             à jour les colonnes protégées du plan d'abonnement & création de
--             la table d'audit des licences.
--
-- PROBLÈME :
--   1. Le trigger trg_protect_business_subscription bloque toute UPDATE sur
--      businesses.plan / plan_status / plan_expires_at sauf pour les admins.
--   2. La table public.license_key_audit_log n'existait pas encore dans la base.
--
-- SOLUTION :
--   1. Créer la table public.license_key_audit_log avec RLS et index.
--   2. Réécrire la fonction trigger pour vérifier un flag de session
--      app.internal_subscription_update = 'true' (posé par les RPC internes).
--   3. Réécrire activate_license_key pour poser ce flag avant l'UPDATE
--      et rendre l'audit non-bloquant (résilient).
--   4. Réécrire admin_activate_business_plan de même.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- ÉTAPE 0 : Création de la table d'audit des clés de licence
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.license_key_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key text NOT NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  action text NOT NULL,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS license_key_audit_log_key_idx ON public.license_key_audit_log(license_key);
CREATE INDEX IF NOT EXISTS license_key_audit_log_business_idx ON public.license_key_audit_log(business_id);

ALTER TABLE public.license_key_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all on license_audit" ON public.license_key_audit_log;
CREATE POLICY "admin all on license_audit" ON public.license_key_audit_log
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

GRANT SELECT, INSERT ON public.license_key_audit_log TO authenticated;
GRANT ALL ON public.license_key_audit_log TO service_role;


-- ------------------------------------------------------------------------------
-- ÉTAPE 1 : Recréer le trigger protecteur avec vérification du flag interne
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_business_subscription_and_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Autoriser les RPC internes de confiance (activate_license_key,
  -- admin_activate_business_plan) qui posent ce flag avant d'UPDATE.
  IF current_setting('app.internal_subscription_update', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Bloquer les changements non autorisés par les utilisateurs normaux
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN

    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Action interdite : seul un administrateur peut modifier les privilèges d''administration.';
    END IF;

    IF NEW.plan IS DISTINCT FROM OLD.plan THEN
      RAISE EXCEPTION 'Action interdite : la formule d''abonnement ne peut être modifiée que via le webhook de paiement sécurisé.';
    END IF;

    IF NEW.plan_status IS DISTINCT FROM OLD.plan_status THEN
      RAISE EXCEPTION 'Action interdite : le statut de l''abonnement ne peut être modifié que via le webhook de paiement sécurisé.';
    END IF;

    IF NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at THEN
      RAISE EXCEPTION 'Action interdite : la durée de validité ne peut être prolongée que via le webhook de paiement sécurisé.';
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Recréer le trigger (au cas où il n'existerait pas encore)
DROP TRIGGER IF EXISTS trg_protect_business_subscription ON public.businesses;
CREATE TRIGGER trg_protect_business_subscription
  BEFORE UPDATE OF is_admin, plan, plan_status, plan_expires_at ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_business_subscription_and_admin();

REVOKE ALL ON FUNCTION public.protect_business_subscription_and_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_business_subscription_and_admin() TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- ÉTAPE 2 : Réécrire activate_license_key avec le flag de bypass & audit sécurisé
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activate_license_key(
  p_license_key text,
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license        record;
  v_business       record;
  v_clean_key      text;
  v_current_expires timestamptz;
  v_new_expires    timestamptz;
  v_clean_phone    text;
  v_assigned_clean text;
BEGIN
  -- Nettoyage de la clé saisie (espaces, casse)
  v_clean_key := upper(trim(p_license_key));

  IF v_clean_key IS NULL OR length(v_clean_key) < 8 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Format de clé de licence invalide.');
  END IF;

  -- Vérifier que l'utilisateur est bien propriétaire de l'atelier (ou admin)
  IF NOT public.owns_business(p_business_id) AND NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vous n''êtes pas autorisé à modifier cet atelier.');
  END IF;

  -- Récupérer l'atelier
  SELECT id, phone, whatsapp, plan, plan_expires_at, name
  INTO v_business
  FROM public.businesses
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Atelier introuvable.');
  END IF;

  -- Récupérer et verrouiller la licence (FOR UPDATE pour éviter double-activation)
  SELECT *
  INTO v_license
  FROM public.licenses
  WHERE license_key = v_clean_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Clé de licence inexistante ou erronée. Vérifiez votre saisie.');
  END IF;

  -- Vérifications de statut
  IF v_license.status = 'used' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cette clé de licence a déjà été activée et utilisée.');
  END IF;

  IF v_license.status = 'revoked' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cette clé de licence a été révoquée par l''administration.');
  END IF;

  IF v_license.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cette clé de licence n''est plus active.');
  END IF;

  -- Vérification d'assignation à un atelier précis
  IF v_license.assigned_business_id IS NOT NULL AND v_license.assigned_business_id <> p_business_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cette clé est exclusivement réservée à un autre atelier.');
  END IF;

  -- Vérification anti-fraude par numéro de téléphone lié
  IF v_license.assigned_phone IS NOT NULL AND trim(v_license.assigned_phone) <> '' THEN
    v_assigned_clean := regexp_replace(v_license.assigned_phone, '[^0-9]', '', 'g');
    v_clean_phone    := regexp_replace(coalesce(v_business.whatsapp, v_business.phone, ''), '[^0-9]', '', 'g');

    -- Si les 8 derniers chiffres ne correspondent pas
    IF right(v_assigned_clean, 8) <> right(v_clean_phone, 8) THEN
      RETURN jsonb_build_object(
        'success', false,
        'message', 'Cette clé est liée à un numéro de téléphone différent de celui de votre atelier. Contactez le support.'
      );
    END IF;
  END IF;

  -- Calcul de la date d'expiration (cumul si déjà actif)
  v_current_expires := v_business.plan_expires_at;
  IF v_current_expires IS NOT NULL AND v_current_expires > now() THEN
    v_new_expires := v_current_expires + (v_license.duration_days || ' days')::interval;
  ELSE
    v_new_expires := now() + (v_license.duration_days || ' days')::interval;
  END IF;

  -- Poser le flag de bypass AVANT l'UPDATE pour passer le trigger
  PERFORM set_config('app.internal_subscription_update', 'true', true);

  -- Mise à jour de l'atelier
  UPDATE public.businesses
  SET
    plan            = v_license.plan,
    plan_status     = 'active',
    plan_expires_at = v_new_expires
  WHERE id = p_business_id;

  -- Retirer le flag immédiatement après
  PERFORM set_config('app.internal_subscription_update', 'false', true);

  -- Marquer la licence comme utilisée
  UPDATE public.licenses
  SET
    status              = 'used',
    used_by_business_id = p_business_id,
    used_at             = now()
  WHERE license_key = v_clean_key;

  -- Enregistrer l'audit (résilient : ne bloque jamais l'activation)
  BEGIN
    INSERT INTO public.license_key_audit_log (
      license_key,
      business_id,
      action,
      performed_by,
      details
    ) VALUES (
      v_clean_key,
      p_business_id,
      'activated',
      auth.uid(),
      jsonb_build_object(
        'plan',            v_license.plan,
        'duration_days',   v_license.duration_days,
        'plan_expires_at', v_new_expires,
        'business_name',   v_business.name
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success',         true,
    'plan',            v_license.plan,
    'duration_days',   v_license.duration_days,
    'plan_expires_at', v_new_expires,
    'message',         'Licence activée avec succès ! Votre atelier est maintenant Pro.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_license_key(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_license_key(text, uuid) TO service_role;


-- ------------------------------------------------------------------------------
-- ÉTAPE 3 : Réécrire admin_activate_business_plan avec le flag de bypass
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_activate_business_plan(
  p_business_id  uuid,
  p_plan         text,
  p_duration_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_expires timestamptz;
  v_new_expires     timestamptz;
  v_business        record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Action réservée exclusivement aux administrateurs.';
  END IF;

  IF p_plan NOT IN ('monthly', 'quarterly', 'yearly') THEN
    RAISE EXCEPTION 'Plan invalide : doit être monthly, quarterly ou yearly.';
  END IF;

  SELECT id, plan, plan_expires_at, phone, whatsapp
  INTO v_business
  FROM public.businesses
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atelier introuvable.';
  END IF;

  -- Calcul de la prolongation (cumul si déjà actif)
  v_current_expires := v_business.plan_expires_at;
  IF v_current_expires IS NOT NULL AND v_current_expires > now() THEN
    v_new_expires := v_current_expires + (p_duration_days || ' days')::interval;
  ELSE
    v_new_expires := now() + (p_duration_days || ' days')::interval;
  END IF;

  -- Poser le flag de bypass avant l'UPDATE
  PERFORM set_config('app.internal_subscription_update', 'true', true);

  UPDATE public.businesses
  SET
    plan            = p_plan,
    plan_status     = 'active',
    plan_expires_at = v_new_expires
  WHERE id = p_business_id;

  -- Retirer le flag immédiatement après
  PERFORM set_config('app.internal_subscription_update', 'false', true);

  -- Enregistrement de la transaction manuelle admin
  INSERT INTO public.payment_transactions (
    business_id,
    plan,
    amount,
    currency,
    provider,
    provider_tx_id,
    customer_phone,
    status,
    completed_at,
    metadata
  ) VALUES (
    p_business_id,
    p_plan,
    CASE
      WHEN p_plan = 'monthly'   THEN 3000
      WHEN p_plan = 'quarterly' THEN 7500
      WHEN p_plan = 'yearly'    THEN 35000
      ELSE 0
    END,
    'FCFA',
    'admin_manual',
    'adm_' || floor(extract(epoch from now()))::text,
    coalesce(v_business.whatsapp, v_business.phone),
    'completed',
    now(),
    jsonb_build_object(
      'duration_days', p_duration_days,
      'admin_user_id', auth.uid(),
      'activated_at',  now()
    )
  );

  RETURN jsonb_build_object(
    'success',         true,
    'plan',            p_plan,
    'duration_days',   p_duration_days,
    'plan_expires_at', v_new_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_activate_business_plan(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activate_business_plan(uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
