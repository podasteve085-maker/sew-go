-- ==============================================================================
-- CouturPro — Correction du calcul de Checksum de Licence & Suppression d'Atelier
-- Date : 14 Novembre 2026
--
-- 1. Correction du split de la clé de licence dans activate_license_key :
--    La clé a 4 tirets (ex: CP-M2611-163C-901F-19A2) -> 5 segments dans string_to_array.
--    Le checksum est v_parts[5] (dernier segment), et le seed est tout ce qui précède.
--    La version précédente prenait v_parts[4] comme checksum, ce qui rejetait
--    toutes les clés valides générées par l'administration.
--
-- 2. Réinitialisation des verrous temporaires anti-bruteforce (rate limits).
--
-- 3. Robustesse de delete_business_and_all_data :
--    - Idempotence si l'atelier a déjà été supprimé
--    - Nettoyage des licences, audits et rate_limits pour éviter les blocages de clés étrangères
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CORRECTION DE LA FONCTION activate_license_key
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
  v_clean_key         text;
  v_rate_limit        record;
  v_license           record;
  v_business          record;
  v_current_expires   timestamptz;
  v_new_expires       timestamptz;
  v_clean_phone       text;
  v_assigned_clean    text;
  v_expected_checksum text;
  v_parts             text[];
  v_seed              text;
  v_provided_check    text;
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

  -- 4. VÉRIFICATION DU CHECKSUM SI CLÉ AU FORMAT STANDARD
  -- Format: CP-M2611-XXXX-XXXX-CCCC (5 segments séparés par '-')
  IF v_clean_key ~ '^CP-[MQY][0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' THEN
    v_parts := string_to_array(v_clean_key, '-');
    -- Le checksum est TOUJOURS le dernier segment
    v_provided_check := v_parts[array_length(v_parts, 1)];
    -- Le seed est tout ce qui précède le dernier tiret (ex: CP-M2611-163C-901F)
    v_seed := substr(v_clean_key, 1, length(v_clean_key) - length(v_provided_check) - 1);
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

  -- 7. CONTRÔLE D'USAGE UNIQUE STRICT (ANTI-RÉUTILISATION)
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

  -- 10. CALCUL DE LA NOUVELLE EXPIRATION (CUMUL SÉCURISÉ)
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

  -- 12. BRÛLAGE DÉFINITIF DE LA CLÉ (IMMUTABLE)
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

-- ------------------------------------------------------------------------------
-- 2. RÉINITIALISATION DES RATE LIMITS DE BLOCAGE TEMPORAIRE
-- ------------------------------------------------------------------------------
DELETE FROM public.license_activation_rate_limits;

-- ------------------------------------------------------------------------------
-- 3. FONCTION DE SUPPRESSION D'ATELIER ROBUSTE (DROIT À L'OUBLI RGPD)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_business_and_all_data(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 0. Idempotence : si l'atelier a déjà été supprimé de la base, retourner true
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
    RETURN true;
  END IF;

  -- Vérification d'autorisation : propriétaire ou administrateur
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

  -- 9. Supprimer les dépenses
  BEGIN
    DELETE FROM public.expenses WHERE business_id = p_business_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 10. Supprimer les modèles du catalogue
  DELETE FROM public.catalog_models
  WHERE business_id = p_business_id;

  -- 11. Supprimer les types de vêtements
  DELETE FROM public.garment_types
  WHERE business_id = p_business_id;

  -- 12. Supprimer les transactions de paiement
  DELETE FROM public.payment_transactions
  WHERE business_id = p_business_id;

  -- 13. Supprimer les notifications push
  BEGIN
    DELETE FROM public.push_subscriptions WHERE business_id = p_business_id;
    DELETE FROM public.push_reminder_logs WHERE business_id = p_business_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 14. Dissocier / supprimer les licences et verrous rattachés
  BEGIN
    DELETE FROM public.license_activation_rate_limits WHERE business_id = p_business_id;
    DELETE FROM public.license_key_audit_log WHERE business_id = p_business_id;
    DELETE FROM public.licenses WHERE used_by_business_id = p_business_id OR assigned_business_id = p_business_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 15. Supprimer les journaux d'audit de sécurité
  DELETE FROM public.audit_security_logs
  WHERE business_id = p_business_id;

  -- 16. Supprimer enfin l'atelier lui-même
  DELETE FROM public.businesses
  WHERE id = p_business_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_business_and_all_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_business_and_all_data(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
