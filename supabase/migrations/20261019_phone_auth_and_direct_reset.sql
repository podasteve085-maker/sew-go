-- ==============================================================================
-- CouturPro — Migration : Authentification Phone-First & Récupération Directe
-- Permet la connexion/inscription sans email et la réinitialisation directe
-- de mot de passe par vérification de téléphone et confirmations d'atelier.
-- ==============================================================================

-- 1. Activer pgcrypto dans le schéma extensions pour le hachage bcrypt
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Table pour le rate limiting et la sécurité anti-brute force des réinitialisations
CREATE TABLE IF NOT EXISTS public.phone_reset_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_digits text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS phone_reset_attempts_phone_idx 
  ON public.phone_reset_attempts(phone_digits, attempted_at DESC);

-- Activer RLS pour protéger cette table interne
ALTER TABLE public.phone_reset_attempts ENABLE ROW LEVEL SECURITY;
-- Aucun accès direct pour les utilisateurs, accessible uniquement via les fonctions SECURITY DEFINER

-- Nettoyage automatique des tentatives de plus de 24h
DELETE FROM public.phone_reset_attempts WHERE attempted_at < now() - interval '24 hours';

-- 3. Fonction pour résoudre l'identifiant de connexion (Téléphone ou Email)
CREATE OR REPLACE FUNCTION public.resolve_login_identifier(p_identifier text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  clean_input text := TRIM(COALESCE(p_identifier, ''));
  clean_digits text;
  v_email text;
BEGIN
  -- Si vide, renvoyer vide
  IF clean_input = '' THEN
    RETURN '';
  END IF;

  -- Si l'identifiant contient '@', c'est déjà un email direct
  IF clean_input LIKE '%@%' THEN
    RETURN LOWER(clean_input);
  END IF;

  -- Sinon, c'est un numéro de téléphone : on extrait les chiffres
  clean_digits := regexp_replace(clean_input, '[^0-9]', '', 'g');
  IF clean_digits = '' THEN
    RETURN clean_input;
  END IF;

  -- Rechercher si ce numéro correspond à un atelier existant
  SELECT u.email INTO v_email
  FROM public.businesses b
  JOIN auth.users u ON u.id = b.owner_id
  WHERE (
    regexp_replace(COALESCE(b.phone, ''), '[^0-9]', '', 'g') = clean_digits
    OR regexp_replace(COALESCE(b.phone, ''), '[^0-9]', '', 'g') LIKE '%' || clean_digits
    OR clean_digits LIKE '%' || regexp_replace(COALESCE(b.phone, ''), '[^0-9]', '', 'g')
    OR regexp_replace(COALESCE(b.whatsapp, ''), '[^0-9]', '', 'g') = clean_digits
    OR regexp_replace(COALESCE(b.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || clean_digits
  )
  ORDER BY b.created_at DESC
  LIMIT 1;

  -- Si un compte existant est trouvé avec cet email, on le renvoie
  IF v_email IS NOT NULL AND v_email != '' THEN
    RETURN LOWER(v_email);
  END IF;

  -- Sinon, renvoyer l'identifiant interne déterministe par défaut
  RETURN 'tel_' || clean_digits || '@couturpro.atelier';
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_login_identifier(text) TO anon, authenticated;

-- 4. Fonction de réinitialisation directe du mot de passe avec vérification stricte
CREATE OR REPLACE FUNCTION public.reset_password_by_phone_verification(
  p_phone text,
  p_business_name text,
  p_owner_name text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  clean_digits text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  clean_bname text := LOWER(TRIM(COALESCE(p_business_name, '')));
  clean_oname text := LOWER(TRIM(COALESCE(p_owner_name, '')));
  v_recent_failures int;
  v_business_id uuid;
  v_owner_id uuid;
  v_stored_oname text;
  v_user_email text;
BEGIN
  -- A. Validation minimale des entrées
  IF clean_digits = '' OR length(clean_digits) < 6 THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Veuillez renseigner un numéro de téléphone valide.'
    );
  END IF;

  IF clean_bname = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Veuillez indiquer le nom exact de votre atelier pour confirmer votre identité.'
    );
  END IF;

  IF length(COALESCE(p_new_password, '')) < 6 THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Le nouveau mot de passe doit comporter au moins 6 caractères.'
    );
  END IF;

  -- B. Sécurité Anti-Brute-Force : Maximum 5 échecs consécutifs sur ce numéro en 15 minutes
  SELECT COUNT(*) INTO v_recent_failures
  FROM public.phone_reset_attempts
  WHERE phone_digits = clean_digits
    AND success = false
    AND attempted_at > (now() - interval '15 minutes');

  IF v_recent_failures >= 5 THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Sécurité anti-brute-force : 5 tentatives infructueuses sur ce numéro. Veuillez patienter 15 minutes avant de réessayer.'
    );
  END IF;

  -- C. Recherche de l'atelier correspondant au numéro ET au nom de l'atelier
  SELECT b.id, b.owner_id, LOWER(TRIM(COALESCE(b.owner_name, ''))), u.email
  INTO v_business_id, v_owner_id, v_stored_oname, v_user_email
  FROM public.businesses b
  JOIN auth.users u ON u.id = b.owner_id
  WHERE (
    regexp_replace(COALESCE(b.phone, ''), '[^0-9]', '', 'g') = clean_digits
    OR regexp_replace(COALESCE(b.phone, ''), '[^0-9]', '', 'g') LIKE '%' || clean_digits
    OR clean_digits LIKE '%' || regexp_replace(COALESCE(b.phone, ''), '[^0-9]', '', 'g')
    OR regexp_replace(COALESCE(b.whatsapp, ''), '[^0-9]', '', 'g') = clean_digits
    OR regexp_replace(COALESCE(b.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || clean_digits
  )
  AND (
    LOWER(TRIM(b.name)) = clean_bname
    OR clean_bname LIKE '%' || LOWER(TRIM(b.name)) || '%'
    OR LOWER(TRIM(b.name)) LIKE '%' || clean_bname || '%'
  )
  ORDER BY b.created_at DESC
  LIMIT 1;

  -- Si l'atelier n'est pas trouvé
  IF v_owner_id IS NULL THEN
    INSERT INTO public.phone_reset_attempts (phone_digits, success)
    VALUES (clean_digits, false);

    RETURN jsonb_build_object(
      'success', false,
      'message', 'Les informations fournies ne correspondent à aucun atelier enregistré. Vérifiez votre numéro et le nom de votre atelier.'
    );
  END IF;

  -- D. Si le nom du responsable a été renseigné, vérifier la correspondance
  IF clean_oname != '' AND v_stored_oname != '' THEN
    IF NOT (
      v_stored_oname = clean_oname
      OR v_stored_oname LIKE '%' || clean_oname || '%'
      OR clean_oname LIKE '%' || v_stored_oname || '%'
    ) THEN
      INSERT INTO public.phone_reset_attempts (phone_digits, success)
      VALUES (clean_digits, false);

      RETURN jsonb_build_object(
        'success', false,
        'message', 'Le nom du responsable ne correspond pas aux informations de cet atelier.'
      );
    END IF;
  END IF;

  -- E. SUCCÈS : Mise à jour immédiate et atomique du mot de passe dans auth.users
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id = v_owner_id;

  -- Enregistrer le succès dans les tentatives
  INSERT INTO public.phone_reset_attempts (phone_digits, success)
  VALUES (clean_digits, true);

  -- Journaliser dans l'audit de confidentialité si la table existe
  BEGIN
    INSERT INTO public.privacy_audit_logs (business_id, action, details)
    VALUES (
      v_business_id,
      'PASSWORD_RESET_VIA_PHONE_VERIFICATION',
      jsonb_build_object(
        'status', 'success',
        'masked_phone', overlay(clean_digits placing '****' from 3 for 4),
        'timestamp', now()
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Ne pas bloquer si la table d'audit optionnelle a une contrainte
    NULL;
  END;

  -- F. Retourner la confirmation et l'identifiant pour auto-connexion instantanée
  RETURN jsonb_build_object(
    'success', true,
    'email', v_user_email,
    'message', 'Mot de passe modifié avec succès ! Connexion en cours...'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_password_by_phone_verification(text, text, text, text) TO anon, authenticated;
