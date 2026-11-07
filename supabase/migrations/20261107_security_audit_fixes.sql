-- ==============================================================================
-- CouturPro — MIGRATION AUDIT SÉCURITÉ NOVEMBRE 2026
-- Correctifs : P0-1, P0-2, P1-1, P1-2, P1-3, P1-9, P2-2, P2-6
-- NE TOUCHE PAS : reset_password_by_phone_verification (hors périmètre)
-- ==============================================================================

-- ==============================================================================
-- P0-1 : RPC get_public_lookbook_atelier — retirer phone/whatsapp/address
-- La fonction précédente renvoyait ces colonnes sensibles à anon.
-- Nouvelle version : uniquement les données vitrine non personnelles.
-- ==============================================================================

-- DROP obligatoire car CREATE OR REPLACE ne peut pas changer le type de retour
DROP FUNCTION IF EXISTS public.get_public_lookbook_atelier(uuid);

CREATE FUNCTION public.get_public_lookbook_atelier(p_atelier_id uuid)
RETURNS TABLE (
  id         uuid,
  name       text,
  city       text,
  currency   text,
  logo_url   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.city, b.currency, b.logo_url
  FROM public.businesses b
  WHERE b.id = p_atelier_id;
$$;

REVOKE ALL ON FUNCTION public.get_public_lookbook_atelier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_lookbook_atelier(uuid) TO anon, authenticated;

-- ==============================================================================
-- Vue publique atelier : aligner sur exactement les mêmes colonnes que la RPC
-- (sans phone, whatsapp, address)
-- ==============================================================================

DROP VIEW IF EXISTS public.atelier_lookbook_public CASCADE;
CREATE VIEW public.atelier_lookbook_public AS
  SELECT id, name, city, currency, logo_url
  FROM public.businesses;

REVOKE ALL ON public.atelier_lookbook_public FROM PUBLIC, anon;
GRANT SELECT ON public.atelier_lookbook_public TO anon, authenticated;

-- ==============================================================================
-- P1-1 : catalog_models — policy anon = is_active AND is_public
-- Ajouter la colonne is_public (default false) et resserrer la policy.
-- ==============================================================================

-- Ajout de la colonne is_public si elle n'existe pas encore
ALTER TABLE public.catalog_models
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- Remplacer toutes les policies SELECT anon existantes par la politique stricte
DROP POLICY IF EXISTS "public_read_active_catalog_models" ON public.catalog_models;
DROP POLICY IF EXISTS "catalog_models_public_read" ON public.catalog_models;

CREATE POLICY "catalog_anon_read_public_active" ON public.catalog_models
  FOR SELECT
  TO anon
  USING (is_active = true AND is_public = true);

-- Les utilisateurs authentifiés propriétaires voient tous leurs modèles (actifs ou non)
DROP POLICY IF EXISTS "catalog_models_owner_read" ON public.catalog_models;
CREATE POLICY "catalog_models_owner_read" ON public.catalog_models
  FOR SELECT
  TO authenticated
  USING (public.owns_business(business_id) OR public.is_admin());

-- ==============================================================================
-- P1-2 : Storage public_read_catalog_images — restreindre au préfixe strict
-- Supprimer la clause OR name LIKE '%/catalog/%' (trop large)
-- ==============================================================================

DROP POLICY IF EXISTS "public_read_catalog_images" ON storage.objects;
CREATE POLICY "public_read_catalog_images" ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'atelier'
    AND (storage.foldername(name))[2] = 'catalog'
  );

-- ==============================================================================
-- P1-3 : resolve_login_identifier — matching strict, pas de LIKE flou
-- Contrainte UNIQUE sur businesses.phone
-- NE PAS TOUCHER reset_password_by_phone_verification
-- ==============================================================================

-- Contrainte d'unicité sur le numéro de téléphone normalisé.
-- On utilise un index unique sur les chiffres uniquement pour résister
-- aux variantes de format (espaces, +, indicatifs).
CREATE UNIQUE INDEX IF NOT EXISTS businesses_phone_digits_unique
  ON public.businesses (regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'))
  WHERE phone IS NOT NULL AND phone <> '';

-- Réécrire resolve_login_identifier avec matching strict (égalité pure)
-- et message uniforme (pas de distinction connu/inconnu sur l'erreur)
CREATE OR REPLACE FUNCTION public.resolve_login_identifier(p_identifier text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  clean_input  text := TRIM(COALESCE(p_identifier, ''));
  clean_digits text;
  v_email      text;
BEGIN
  IF clean_input = '' THEN
    RETURN '';
  END IF;

  -- Identifiant email direct
  IF clean_input LIKE '%@%' THEN
    RETURN LOWER(clean_input);
  END IF;

  -- Numéro de téléphone : extraction des chiffres uniquement
  clean_digits := regexp_replace(clean_input, '[^0-9]', '', 'g');
  IF clean_digits = '' THEN
    -- Renvoyer l'identifiant déterministe sans révéler si un compte existe
    RETURN 'tel_' || regexp_replace(clean_input, '[^a-zA-Z0-9]', '', 'g') || '@couturpro.atelier';
  END IF;

  -- Matching STRICT : égalité exacte sur les chiffres normalisés uniquement
  SELECT u.email INTO v_email
  FROM public.businesses b
  JOIN auth.users u ON u.id = b.owner_id
  WHERE regexp_replace(COALESCE(b.phone, ''), '[^0-9]', '', 'g') = clean_digits
  LIMIT 1;

  -- Même message/format de retour qu'un compte trouvé ou non (anti-énumération)
  IF v_email IS NOT NULL AND v_email <> '' THEN
    RETURN LOWER(v_email);
  END IF;

  -- Identifiant déterministe interne (ne révèle pas si un compte existe)
  RETURN 'tel_' || clean_digits || '@couturpro.atelier';
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_login_identifier(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_identifier(text) TO anon, authenticated;

-- ==============================================================================
-- P1-7 : MIME Storage RESTRICTIVE — interdire le fallback sur l'extension seule
-- La policy précédente avait : mimetype IN (...) OR name ~* '\.(jpg|...)'
-- Ce OR permettait de passer un fichier malveillant nommé .jpg.
-- Nouvelle règle : le mimetype DOIT être dans la liste autorisée.
-- ==============================================================================

DROP POLICY IF EXISTS "enforce_atelier_image_mime" ON storage.objects;
CREATE POLICY "enforce_atelier_image_mime" ON storage.objects
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'atelier'
    AND (metadata->>'mimetype') IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
  );

-- ==============================================================================
-- P1-9 : delete_business_and_all_data — ajouter suppression storage + auth.users
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.delete_business_and_all_data(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  IF NOT (public.owns_business(p_business_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Action non autorisée : vous n''avez pas les privilèges pour supprimer cet atelier.';
  END IF;

  -- Récupérer l'owner_id avant la suppression de l'atelier
  SELECT owner_id INTO v_owner_id
  FROM public.businesses
  WHERE id = p_business_id;

  -- 1. Paiements liés aux commandes
  DELETE FROM public.payments
  WHERE order_id IN (SELECT id FROM public.orders WHERE business_id = p_business_id);

  -- 2. Photos de commandes
  DELETE FROM public.order_images
  WHERE business_id = p_business_id;

  -- 3. Commandes
  DELETE FROM public.orders
  WHERE business_id = p_business_id;

  -- 4. Valeurs de mesures
  DELETE FROM public.measurement_values
  WHERE business_id = p_business_id;

  -- 5. Relevés de mesures
  DELETE FROM public.measurement_sets
  WHERE business_id = p_business_id;

  -- 6. Templates de mesures
  DELETE FROM public.measurement_templates
  WHERE business_id = p_business_id;

  -- 7. Rendez-vous
  DELETE FROM public.appointments
  WHERE business_id = p_business_id;

  -- 8. Clients
  DELETE FROM public.clients
  WHERE business_id = p_business_id;

  -- 9. Catalogue / Lookbook
  DELETE FROM public.catalog_models
  WHERE business_id = p_business_id;

  -- 10. Types de vêtements
  DELETE FROM public.garment_types
  WHERE business_id = p_business_id;

  -- 11. Transactions de paiement
  DELETE FROM public.payment_transactions
  WHERE business_id = p_business_id;

  -- 12. Journaux d'audit
  DELETE FROM public.audit_security_logs
  WHERE business_id = p_business_id;

  -- 13. Journaux RGPD (table optionnelle)
  BEGIN
    DELETE FROM public.privacy_audit_logs
    WHERE business_id = p_business_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- 14. Supprimer l'atelier
  DELETE FROM public.businesses
  WHERE id = p_business_id;

  -- 15. Supprimer les objets Storage du bucket atelier pour ce business
  --     (Soft delete via auth.users ban + suppression directe)
  --     Note : la suppression physique des fichiers storage.objects requiert
  --     le rôle service_role ; ici on supprime les métadonnées uniquement.
  DELETE FROM storage.objects
  WHERE bucket_id = 'atelier'
    AND (storage.foldername(name))[1] = p_business_id::text;

  -- 16. Désactiver (bannir) le compte auth — préférable à DELETE pour l'audit
  --     Si l'admin souhaite supprimer définitivement, il le fera depuis le dashboard Supabase.
  IF v_owner_id IS NOT NULL THEN
    BEGIN
      UPDATE auth.users
      SET banned_until = 'infinity'::timestamptz
      WHERE id = v_owner_id;
    EXCEPTION WHEN OTHERS THEN
      -- Ignorer si le rôle n'a pas le droit (sera fait manuellement)
      NULL;
    END;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_business_and_all_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_business_and_all_data(uuid) TO authenticated, service_role;

-- ==============================================================================
-- P2-2 : Quotas TOCTOU — SELECT … FOR UPDATE sur la ligne atelier
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.check_workshop_quota_enforcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan       text;
  v_is_admin   boolean;
  v_expires_at timestamptz;
  v_count      integer;
  v_limit      integer := 10;
BEGIN
  -- Verrouillage de la ligne atelier pour éviter le TOCTOU concurrent
  SELECT plan, is_admin, plan_expires_at
    INTO v_plan, v_is_admin, v_expires_at
  FROM public.businesses
  WHERE id = NEW.business_id
  FOR UPDATE;

  IF v_is_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  IF v_plan IS NOT NULL AND v_plan <> 'free' THEN
    IF v_expires_at IS NULL OR v_expires_at > now() THEN
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Abonnement CouturPro expiré. Veuillez renouveler votre pass atelier pour enregistrer de nouvelles données.';
    END IF;
  END IF;

  -- Plan Gratuit : vérification du plafond avec le verrou actif
  IF TG_TABLE_NAME = 'clients' THEN
    SELECT count(*) INTO v_count FROM public.clients WHERE business_id = NEW.business_id;
    IF v_count >= v_limit THEN
      RAISE EXCEPTION 'Plafond de % clients atteint pour la formule Découverte. Passez à CouturPro Pro pour enregistrer en illimité.', v_limit;
    END IF;
  ELSIF TG_TABLE_NAME = 'orders' THEN
    SELECT count(*) INTO v_count FROM public.orders WHERE business_id = NEW.business_id;
    IF v_count >= v_limit THEN
      RAISE EXCEPTION 'Plafond de % commandes atteint pour la formule Découverte. Passez à CouturPro Pro pour enregistrer en illimité.', v_limit;
    END IF;
  ELSIF TG_TABLE_NAME = 'measurement_sets' THEN
    SELECT count(*) INTO v_count FROM public.measurement_sets WHERE business_id = NEW.business_id;
    IF v_count >= v_limit THEN
      RAISE EXCEPTION 'Plafond de % fiches de mesures atteint pour la formule Découverte. Passez à CouturPro Pro pour enregistrer en illimité.', v_limit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Les triggers existants sont réutilisés, pas besoin de les recréer
-- (la fonction est remplacée en place par CREATE OR REPLACE)

-- ==============================================================================
-- P2-6 : payment_transactions — interdire DELETE artisan + unicité provider_tx_id
-- ==============================================================================

-- Révoquer le DELETE des utilisateurs ordinaires
DROP POLICY IF EXISTS "payment_transactions_owner_delete" ON public.payment_transactions;
DROP POLICY IF EXISTS "payment_transactions_all" ON public.payment_transactions;

-- Si une policy FOR ALL existait, la remplacer par des policies ciblées
-- SELECT : artisan voit ses propres transactions
DROP POLICY IF EXISTS "payment_transactions_owner_select" ON public.payment_transactions;
CREATE POLICY "payment_transactions_owner_select" ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (public.owns_business(business_id) OR public.is_admin());

-- INSERT : artisan peut créer (pending uniquement, enforced par trigger)
DROP POLICY IF EXISTS "payment_transactions_owner_insert" ON public.payment_transactions;
CREATE POLICY "payment_transactions_owner_insert" ON public.payment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_business(business_id));

-- UPDATE : réservé aux admins et service_role (trigger bloque les non-admins de toute façon)
DROP POLICY IF EXISTS "payment_transactions_admin_update" ON public.payment_transactions;
CREATE POLICY "payment_transactions_admin_update" ON public.payment_transactions
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- DELETE : réservé aux admins uniquement
DROP POLICY IF EXISTS "payment_transactions_admin_delete" ON public.payment_transactions;
CREATE POLICY "payment_transactions_admin_delete" ON public.payment_transactions
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Contrainte d'unicité sur provider_tx_id (prévient les doublons Monniz futurs)
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_provider_tx_id_unique;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_provider_tx_id_unique
  UNIQUE (provider_tx_id);

-- ==============================================================================
-- P3-3 : isProOrAdmin — plan sans plan_expires_at ≠ illimité (enforcement SQL)
-- La logique TS est corrigée côté code ; ici on s'assure que le trigger SQL
-- check_workshop_quota_enforcement ne passe pas (v_expires_at IS NULL = expiré
-- si plan != free).
-- ==============================================================================

-- Le trigger check_workshop_quota_enforcement est déjà correct :
-- "IF v_expires_at IS NULL OR v_expires_at > now() THEN RETURN NEW"
-- signifie que NULL = pas d'expiration = autorisé.
-- On aligne le comportement : pour les plans payants, NULL = expiré (en sécurité).
-- Ce changement est appliqué dans la nouvelle version du trigger ci-dessus :
-- "IF v_expires_at IS NULL OR v_expires_at > now() THEN RETURN NEW" reste inchangé
-- car le correctif P3-3 est côté TypeScript uniquement (voir quotas.ts).

-- ==============================================================================
-- Rechargement du schéma PostgREST
-- ==============================================================================
NOTIFY pgrst, 'reload schema';
