-- ==============================================================================
-- Migration : Renforcement de Sécurité Maximale du Système de Licences CouturPro
--
-- OBJECTIFS :
--   1. Clé strictement UNIQUE et À USAGE UNIQUE DÉFINITIF (impossible de réutiliser
--      la même clé le mois suivant, le trimestre suivant ou l'année suivante).
--   2. Verrouillage cryptographique par checksum (détection immédiate de fausses clés).
--   3. Ancrage temporel dans la clé (ex: CP-M2611-... pour Novembre 2026).
--   4. Verrouillage physique anti-bruteforce (blocage 15 min après 5 essais échoués).
--   5. Verrouillage anti-fraude par numéro de téléphone lié (anti-partage de clé).
--   6. Trigger PostgreSQL interdisant formellement de réactiver une clé 'used'.
--   7. Fenêtre de validité maximale d'activation (valid_until).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSION DE LA TABLE LICENSES (valid_until & activation_window)
-- ------------------------------------------------------------------------------

ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS valid_until timestamptz DEFAULT NULL;

-- ------------------------------------------------------------------------------
-- 2. TABLE DE PROTECTION ANTI-BRUTEFORCE (RATE LIMITING)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.license_activation_rate_limits (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz DEFAULT NULL,
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS license_rate_limits_locked_idx
  ON public.license_activation_rate_limits(locked_until);

ALTER TABLE public.license_activation_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all on rate_limits" ON public.license_activation_rate_limits;
CREATE POLICY "admin all on rate_limits" ON public.license_activation_rate_limits
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.license_activation_rate_limits TO authenticated;
GRANT ALL ON public.license_activation_rate_limits TO service_role;

-- ------------------------------------------------------------------------------
-- 3. TABLE D'AUDIT COMPLET DES LICENCES (SI NON EXISTANTE)
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
-- 4. VERROU STRICT : INTERDICTION ABSOLUE DE RÉUTILISER OU DE RÉACTIVER UNE CLÉ 'used'
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_license_reuse_or_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Une fois qu'une clé est passée à 'used', elle est brûlée à vie.
  -- Aucune modification de statut vers 'active' n'est permise.
  IF OLD.status = 'used' AND NEW.status <> 'used' THEN
    RAISE EXCEPTION 'Fraude détectée : Une clé de licence consommée est définitivement expirée et ne peut jamais être réactivée.';
  END IF;

  -- Impossible de changer l'atelier qui l'a consommée
  IF OLD.used_by_business_id IS NOT NULL AND NEW.used_by_business_id IS DISTINCT FROM OLD.used_by_business_id THEN
    RAISE EXCEPTION 'Fraude détectée : La clé de licence est scellée à son atelier d''origine.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_license_reuse ON public.licenses;
CREATE TRIGGER trg_prevent_license_reuse
  BEFORE UPDATE OF status, used_by_business_id ON public.licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_license_reuse_or_tampering();

-- ------------------------------------------------------------------------------
-- 5. CALCUL DE CHECKSUM CRYPTOGRAPHIQUE EMBARQUÉ
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_license_checksum(p_seed text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_hash text;
BEGIN
  -- Signature cryptographique basée sur sel interne CouturPro
  v_hash := upper(md5('COUTURPRO_SECURITY_SALT_V1_' || replace(p_seed, '-', '')));
  RETURN substring(v_hash from 1 for 4);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RPC ADMIN : GÉNÉRATION SÉCURISÉE DE CLÉ À HAUTE ENTROPIE + ANCRAGE PÉRIODE
-- ------------------------------------------------------------------------------

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
  v_period text;
  v_random1 text;
  v_random2 text;
  v_seed text;
  v_checksum text;
  v_license_key text;
  v_days integer;
  v_valid_until timestamptz;
  v_license_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Action réservée exclusivement aux administrateurs.';
  END IF;

  IF p_plan NOT IN ('monthly', 'quarterly', 'yearly') THEN
    RAISE EXCEPTION 'Plan invalide : doit être monthly, quarterly ou yearly.';
  END IF;

  -- Préfixe spécifique au forfait
  v_prefix := CASE
    WHEN p_plan = 'monthly' THEN 'CP-M'
    WHEN p_plan = 'quarterly' THEN 'CP-Q'
    WHEN p_plan = 'yearly' THEN 'CP-Y'
    ELSE 'CP-PRO'
  END;

  -- Durée par défaut
  v_days := coalesce(p_duration_days, CASE
    WHEN p_plan = 'monthly' THEN 30
    WHEN p_plan = 'quarterly' THEN 90
    WHEN p_plan = 'yearly' THEN 365
    ELSE 30
  END);

  -- Ancrage de la période d'émission : Année + Mois (ex: 2611 pour nov 2026)
  v_period := to_char(now(), 'YYMM');

  -- Génération de 2 blocs cryptographiques de 4 caractères hexadécimaux
  -- Entropie combinée : horloge + random + UUID v4
  v_random1 := upper(substring(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text) from 1 for 4));
  v_random2 := upper(substring(md5(gen_random_uuid()::text || random()::text || clock_timestamp()::text) from 5 for 4));

  -- Racine de la clé
  v_seed := v_prefix || v_period || '-' || v_random1 || '-' || v_random2;

  -- Checksum mathématique inviolable
  v_checksum := public.calculate_license_checksum(v_seed);

  -- Clé complète (Exemple : CP-M2611-8F4A-92BC-71D0)
  v_license_key := v_seed || '-' || v_checksum;

  -- Date limite maximale pour activer cette clé (ex: 60 jours pour un mensuel, 180 pour trimestre)
  v_valid_until := now() + ((v_days + 30) || ' days')::interval;

  INSERT INTO public.licenses (
    license_key,
    plan,
    duration_days,
    assigned_phone,
    assigned_business_id,
    status,
    created_by,
    valid_until,
    notes
  ) VALUES (
    v_license_key,
    p_plan,
    v_days,
    nullif(trim(p_assigned_phone), ''),
    p_assigned_business_id,
    'active',
    auth.uid(),
    v_valid_until,
    p_notes
  )
  RETURNING id INTO v_license_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_license_id,
    'license_key', v_license_key,
    'plan', p_plan,
    'duration_days', v_days,
    'assigned_phone', p_assigned_phone,
    'valid_until', v_valid_until
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_generate_license_key(text, integer, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_generate_license_key(text, integer, text, uuid, text) TO service_role;

-- ------------------------------------------------------------------------------
-- 7. RPC D'ACTIVATION SÉCURISÉE & ANTI-FRAUDE STRICTE
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
  v_clean_key        text;
  v_rate_limit       record;
  v_license          record;
  v_business         record;
  v_current_expires  timestamptz;
  v_new_expires      timestamptz;
  v_clean_phone      text;
  v_assigned_clean   text;
  v_expected_checksum text;
  v_parts            text[];
  v_seed             text;
  v_provided_check   text;
BEGIN
  -- Nettoyage strict
  v_clean_key := upper(trim(p_license_key));

  IF v_clean_key IS NULL OR length(v_clean_key) < 8 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Format de clé de licence invalide.');
  END IF;

  -- 1. VÉRIFICATION DU PROPRIÉTAIRE DE L'ATELIER
  IF NOT public.owns_business(p_business_id) AND NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vous n''êtes pas autorisé à modifier cet atelier.');
  END IF;

  -- 2. VÉRIFICATION ET APPLICATION DU RATE LIMITING ANTI-BRUTEFORCE
  SELECT *
  INTO v_rate_limit
  FROM public.license_activation_rate_limits
  WHERE business_id = p_business_id;

  IF FOUND THEN
    IF v_rate_limit.locked_until IS NOT NULL AND v_rate_limit.locked_until > now() THEN
      RETURN jsonb_build_object(
        'success', false,
        'message', 'Sécurité CouturPro : Trop de tentatives infructueuses. Activation temporairement verrouillée jusqu''à ' ||
                   to_char(v_rate_limit.locked_until, 'HH24:MI') || '. Veuillez patienter.'
      );
    END IF;
  END IF;

  -- 3. VÉRIFICATION D'EXISTENCE DE L'ATELIER
  SELECT id, phone, whatsapp, plan, plan_expires_at, name
  INTO v_business
  FROM public.businesses
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Atelier introuvable.');
  END IF;

  -- 4. VÉRIFICATION RAPIDE DU CHECKSUM SI CLÉ AU FORMAT STANDARD
  -- (Format: CP-M2611-XXXX-XXXX-CCCC ou CP-M-XXXX-XXXX-XXXX)
  IF v_clean_key ~ '^CP-[MQY][0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' THEN
    v_parts := string_to_array(v_clean_key, '-');
    v_seed := v_parts[1] || '-' || v_parts[2] || '-' || v_parts[3];
    v_provided_check := v_parts[4];
    v_expected_checksum := public.calculate_license_checksum(v_seed);

    IF v_provided_check <> v_expected_checksum THEN
      -- Incrémenter le compteur d'échecs bruteforce
      INSERT INTO public.license_activation_rate_limits (business_id, failed_attempts, last_attempt_at)
      VALUES (p_business_id, 1, now())
      ON CONFLICT (business_id) DO UPDATE SET
        failed_attempts = public.license_activation_rate_limits.failed_attempts + 1,
        locked_until = CASE
          WHEN public.license_activation_rate_limits.failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE NULL
        END,
        last_attempt_at = now();

      RETURN jsonb_build_object('success', false, 'message', 'Clé de licence invalide ou contrefaite.');
    END IF;
  END IF;

  -- 5. RECHERCHE ET VERROUILLAGE ATOMIQUE (FOR UPDATE)
  SELECT *
  INTO v_license
  FROM public.licenses
  WHERE license_key = v_clean_key
  FOR UPDATE;

  -- 6. SI CLÉ NON TROUVÉE -> INC RÉPONSE SÉCURISÉE & BRUTEFORCE COUNTER
  IF NOT FOUND THEN
    INSERT INTO public.license_activation_rate_limits (business_id, failed_attempts, last_attempt_at)
    VALUES (p_business_id, 1, now())
    ON CONFLICT (business_id) DO UPDATE SET
      failed_attempts = public.license_activation_rate_limits.failed_attempts + 1,
      locked_until = CASE
        WHEN public.license_activation_rate_limits.failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
        ELSE NULL
      END,
      last_attempt_at = now();

    RETURN jsonb_build_object('success', false, 'message', 'Clé de licence inexistante ou erronée. Vérifiez votre saisie.');
  END IF;

  -- 7. CONTRÔLE D'USAGE UNIQUE STRICT (ANTI-RÉUTILISATION LE MOIS SUIVANT)
  IF v_license.status = 'used' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Cette clé de licence a déjà été consommée définitivement le ' ||
                 coalesce(to_char(v_license.used_at, 'DD/MM/YYYY à HH24:MI'), '') ||
                 '. Chaque période (mois, trimestre ou année) nécessite une nouvelle clé officielle après renouvellement.'
    );
  END IF;

  IF v_license.status = 'revoked' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cette clé de licence a été révoquée par l''administration.');
  END IF;

  IF v_license.status = 'expired' OR (v_license.valid_until IS NOT NULL AND v_license.valid_until < now()) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Le délai maximal d''activation de cette clé est dépassé. Contactez le support.');
  END IF;

  IF v_license.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cette clé de licence n''est plus active.');
  END IF;

  -- 8. CONTRÔLE D'ASSIGNATION D'ATELIER (ANTI-PARTAGE)
  IF v_license.assigned_business_id IS NOT NULL AND v_license.assigned_business_id <> p_business_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cette clé est exclusivement réservée à un autre atelier.');
  END IF;

  -- 9. CONTRÔLE DU NUMÉRO DE TÉLÉPHONE (ANTI-FRAUDE INTER-ATELIERS)
  IF v_license.assigned_phone IS NOT NULL AND trim(v_license.assigned_phone) <> '' THEN
    v_assigned_clean := regexp_replace(v_license.assigned_phone, '[^0-9]', '', 'g');
    v_clean_phone    := regexp_replace(coalesce(v_business.whatsapp, v_business.phone, ''), '[^0-9]', '', 'g');

    IF right(v_assigned_clean, 8) <> right(v_clean_phone, 8) THEN
      RETURN jsonb_build_object(
        'success', false,
        'message', 'Cette clé est liée au numéro de téléphone se terminant par ...' ||
                   right(v_assigned_clean, 4) ||
                   '. Elle ne correspond pas aux coordonnées de votre atelier. Contactez le support.'
      );
    END IF;
  END IF;

  -- 10. CALCUL STRICT DE LA NOUVELLE EXPIRATION (CUMUL SÉCURISÉ)
  v_current_expires := v_business.plan_expires_at;
  IF v_current_expires IS NOT NULL AND v_current_expires > now() THEN
    v_new_expires := v_current_expires + (v_license.duration_days || ' days')::interval;
  ELSE
    v_new_expires := now() + (v_license.duration_days || ' days')::interval;
  END IF;

  -- 11. DÉVERROUILLAGE DU TRIGGER INTERNE AVANT UPDATE
  PERFORM set_config('app.internal_subscription_update', 'true', true);

  UPDATE public.businesses
  SET
    plan            = v_license.plan,
    plan_status     = 'active',
    plan_expires_at = v_new_expires
  WHERE id = p_business_id;

  PERFORM set_config('app.internal_subscription_update', 'false', true);

  -- 12. BRÛLAGE DÉFINITIF DE LA CLÉ (IMMUTABLE GRÂCE AU TRIGGER)
  UPDATE public.licenses
  SET
    status              = 'used',
    used_by_business_id = p_business_id,
    used_at             = now()
  WHERE id = v_license.id;

  -- 13. RÉINITIALISATION DU COMPTEUR DE TENTATIVES
  INSERT INTO public.license_activation_rate_limits (business_id, failed_attempts, locked_until, last_attempt_at)
  VALUES (p_business_id, 0, NULL, now())
  ON CONFLICT (business_id) DO UPDATE SET
    failed_attempts = 0,
    locked_until = NULL,
    last_attempt_at = now();

  -- 14. AUDIT DE SÉCURITÉ TRAÇABLE
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
        'plan',                v_license.plan,
        'duration_days',       v_license.duration_days,
        'previous_expires_at', v_current_expires,
        'new_expires_at',      v_new_expires,
        'business_name',       v_business.name,
        'activated_at',        now()
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
    'message',         'Licence ' || upper(v_license.plan) || ' activée avec succès (' || v_license.duration_days || ' jours débloqués).'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_license_key(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_license_key(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
