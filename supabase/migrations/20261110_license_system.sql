-- ==============================================================================
-- Migration : Système de Licences Officielles, Activation Sécurisée & Anti-Fraude
-- ==============================================================================

-- 1. Création de la table des licences d'atelier
CREATE TABLE IF NOT EXISTS public.licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key text UNIQUE NOT NULL,
  plan text NOT NULL CHECK (plan IN ('monthly', 'quarterly', 'yearly')),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  assigned_phone text DEFAULT NULL,
  assigned_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  used_by_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  used_at timestamptz DEFAULT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index de performance
CREATE INDEX IF NOT EXISTS licenses_key_idx ON public.licenses(license_key);
CREATE INDEX IF NOT EXISTS licenses_status_idx ON public.licenses(status);
CREATE INDEX IF NOT EXISTS licenses_assigned_phone_idx ON public.licenses(assigned_phone);
CREATE INDEX IF NOT EXISTS licenses_used_by_business_idx ON public.licenses(used_by_business_id);

-- 2. Sécurisation RLS : Seul l'administrateur peut lire et écrire dans la table licenses
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all on licenses" ON public.licenses;
CREATE POLICY "admin all on licenses" ON public.licenses
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.licenses TO authenticated;
GRANT ALL ON public.licenses TO service_role;

-- 3. Fonction RPC sécurisée : Activation d'une clé de licence par un couturier
-- Exécutée en SECURITY DEFINER pour permettre la validation et la mise à jour atomique
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
  v_license record;
  v_business record;
  v_clean_key text;
  v_current_expires timestamptz;
  v_new_expires timestamptz;
  v_clean_phone text;
  v_assigned_clean text;
BEGIN
  -- Nettoyage de la clé saisie (espaces, tirets superflus, casse)
  v_clean_key := upper(trim(p_license_key));

  IF v_clean_key IS NULL OR length(v_clean_key) < 8 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Format de clé de licence invalide.');
  END IF;

  -- Vérifier que l'utilisateur est bien propriétaire de l'atelier
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

  -- Récupérer et verrouiller la licence
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
    v_clean_phone := regexp_replace(coalesce(v_business.whatsapp, v_business.phone, ''), '[^0-9]', '', 'g');
    
    -- Si les 8 derniers chiffres ne correspondent pas
    IF length(v_assigned_clean) >= 8 AND length(v_clean_phone) >= 8 THEN
      IF right(v_assigned_clean, 8) <> right(v_clean_phone, 8) THEN
        RETURN jsonb_build_object(
          'success', false,
          'message', 'Cette clé de licence est scellée avec le numéro de téléphone ' || v_license.assigned_phone || '. Votre atelier est enregistré sous un autre numéro.'
        );
      END IF;
    END IF;
  END IF;

  -- Calcul de la nouvelle date d'expiration (Cumul bienveillant : pas de perte de jours restants)
  v_current_expires := v_business.plan_expires_at;
  IF v_current_expires IS NOT NULL AND v_current_expires > now() THEN
    v_new_expires := v_current_expires + (v_license.duration_days || ' days')::interval;
  ELSE
    v_new_expires := now() + (v_license.duration_days || ' days')::interval;
  END IF;

  -- Mise à jour de l'atelier
  UPDATE public.businesses
  SET
    plan = v_license.plan,
    plan_status = 'active',
    plan_expires_at = v_new_expires
  WHERE id = p_business_id;

  -- Marquer la licence comme utilisée
  UPDATE public.licenses
  SET
    status = 'used',
    used_by_business_id = p_business_id,
    used_at = now()
  WHERE id = v_license.id;

  -- Enregistrer la transaction pour traçabilité comptable
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
    v_license.plan,
    CASE
      WHEN v_license.plan = 'monthly' THEN 3000
      WHEN v_license.plan = 'quarterly' THEN 7500
      WHEN v_license.plan = 'yearly' THEN 35000
      ELSE 0
    END,
    'FCFA',
    'license_key',
    v_license.license_key,
    coalesce(v_business.whatsapp, v_business.phone, v_license.assigned_phone),
    'completed',
    now(),
    jsonb_build_object(
      'license_id', v_license.id,
      'duration_days', v_license.duration_days,
      'activated_at', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Félicitations ! Votre forfait ' || v_license.plan || ' a été activé avec succès.',
    'plan', v_license.plan,
    'duration_days', v_license.duration_days,
    'plan_expires_at', v_new_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_license_key(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_license_key(text, uuid) TO service_role;

-- 4. Fonction RPC sécurisée : Génération de licence par l'administrateur
CREATE OR REPLACE FUNCTION public.admin_generate_license_key(
  p_plan text,
  p_duration_days integer,
  p_assigned_phone text DEFAULT NULL,
  p_assigned_business_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_random_chars text;
  v_license_key text;
  v_days integer;
  v_license_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Action réservée exclusivement aux administrateurs.';
  END IF;

  IF p_plan NOT IN ('monthly', 'quarterly', 'yearly') THEN
    RAISE EXCEPTION 'Plan invalide : doit être monthly, quarterly ou yearly.';
  END IF;

  v_prefix := CASE
    WHEN p_plan = 'monthly' THEN 'CP-M'
    WHEN p_plan = 'quarterly' THEN 'CP-Q'
    WHEN p_plan = 'yearly' THEN 'CP-Y'
    ELSE 'CP-PRO'
  END;

  v_days := coalesce(p_duration_days, CASE
    WHEN p_plan = 'monthly' THEN 30
    WHEN p_plan = 'quarterly' THEN 90
    WHEN p_plan = 'yearly' THEN 365
    ELSE 30
  END);

  -- Génération d'une clé cryptographique lisible à 3 groupes de 4 caractères hexadécimaux
  v_random_chars := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 12));
  v_license_key := v_prefix || '-' || substring(v_random_chars from 1 for 4) || '-' || substring(v_random_chars from 5 for 4) || '-' || substring(v_random_chars from 9 for 4);

  INSERT INTO public.licenses (
    license_key,
    plan,
    duration_days,
    assigned_phone,
    assigned_business_id,
    created_by,
    notes
  ) VALUES (
    v_license_key,
    p_plan,
    v_days,
    nullif(trim(p_assigned_phone), ''),
    p_assigned_business_id,
    auth.uid(),
    p_notes
  )
  RETURNING id INTO v_license_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_license_id,
    'license_key', v_license_key,
    'plan', p_plan,
    'duration_days', v_days,
    'assigned_phone', p_assigned_phone
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_generate_license_key(text, integer, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_generate_license_key(text, integer, text, uuid, text) TO service_role;

-- 5. Fonction RPC sécurisée : Abonner ou réabonner directement un atelier en 1 clic depuis l'admin
CREATE OR REPLACE FUNCTION public.admin_activate_business_plan(
  p_business_id uuid,
  p_plan text,
  p_duration_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_expires timestamptz;
  v_new_expires timestamptz;
  v_business record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Action réservée exclusivement aux administrateurs.';
  END IF;

  SELECT id, plan, plan_expires_at, phone, whatsapp
  INTO v_business
  FROM public.businesses
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atelier introuvable.';
  END IF;

  -- Calcul de la prolongation (cumul des jours si déjà actif)
  v_current_expires := v_business.plan_expires_at;
  IF v_current_expires IS NOT NULL AND v_current_expires > now() THEN
    v_new_expires := v_current_expires + (p_duration_days || ' days')::interval;
  ELSE
    v_new_expires := now() + (p_duration_days || ' days')::interval;
  END IF;

  UPDATE public.businesses
  SET
    plan = p_plan,
    plan_status = 'active',
    plan_expires_at = v_new_expires
  WHERE id = p_business_id;

  -- Enregistrement de la transaction manuelle
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
      WHEN p_plan = 'monthly' THEN 3000
      WHEN p_plan = 'quarterly' THEN 7500
      WHEN p_plan = 'yearly' THEN 35000
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
      'activated_at', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'plan', p_plan,
    'duration_days', p_duration_days,
    'plan_expires_at', v_new_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_activate_business_plan(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activate_business_plan(uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
