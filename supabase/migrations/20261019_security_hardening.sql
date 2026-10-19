-- ==============================================================================
-- CouturPro / FacturaPro — MIGRATION DE DURCISSEMENT DE SÉCURITÉ POST-AUDIT
-- Date : Octobre 2026
-- Résout : VULN-03, VULN-04, VULN-08, VULN-10, VULN-11, VULN-15, VULN-16, VULN-17, VULN-19
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HARMONISATION DE LA CONTRAINTE DE PLAN D'ABONNEMENT (VULN-17)
-- ------------------------------------------------------------------------------
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_plan_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_plan_check
  CHECK (plan IN ('free', 'monthly', 'quarterly', 'yearly', 'pro_monthly', 'pro_yearly', 'unlimited'));

-- ------------------------------------------------------------------------------
-- 2. CONTRÔLE SERVEUR STRICT DES QUOTAS DE L'OFFRE DÉCOUVERTE (VULN-04)
-- Empêche le contournement des limites (10 clients / 10 commandes / 10 mesures)
-- via l'API REST directe de Supabase par les comptes du plan 'free'.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_workshop_quota_enforcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_is_admin boolean;
  v_expires_at timestamptz;
  v_count integer;
  v_limit integer := 10;
BEGIN
  -- Récupérer l'état d'abonnement de l'atelier
  SELECT plan, is_admin, plan_expires_at
    INTO v_plan, v_is_admin, v_expires_at
  FROM public.businesses
  WHERE id = NEW.business_id;

  -- 1. Les comptes administrateurs sont toujours exemptés
  IF v_is_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  -- 2. Si le compte a un abonnement payant non expiré, autoriser sans restriction
  IF v_plan IS NOT NULL AND v_plan <> 'free' THEN
    IF v_expires_at IS NULL OR v_expires_at > now() THEN
      RETURN NEW;
    ELSE
      -- Abonnement expiré : mode consultation stricte, création interdite
      RAISE EXCEPTION 'Abonnement CouturPro expiré. Veuillez renouveler votre pass atelier pour enregistrer de nouvelles données.';
    END IF;
  END IF;

  -- 3. Plan Gratuit / Découverte : vérification du plafond de 10 enregistrements
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

DROP TRIGGER IF EXISTS trg_enforce_client_quota ON public.clients;
CREATE TRIGGER trg_enforce_client_quota
  BEFORE INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.check_workshop_quota_enforcement();

DROP TRIGGER IF EXISTS trg_enforce_order_quota ON public.orders;
CREATE TRIGGER trg_enforce_order_quota
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_workshop_quota_enforcement();

DROP TRIGGER IF EXISTS trg_enforce_measurement_quota ON public.measurement_sets;
CREATE TRIGGER trg_enforce_measurement_quota
  BEFORE INSERT ON public.measurement_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.check_workshop_quota_enforcement();

-- ------------------------------------------------------------------------------
-- 3. SÉCURISATION DES TRANSACTIONS DE PAIEMENT (VULN-11)
-- Empêche les utilisateurs d'insérer directement des transactions 'completed'
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_payment_transaction_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si l'insertion n'est pas effectuée par service_role ou superadmin
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    -- Toute transaction créée par un utilisateur régulier doit obligatoirement être 'pending'
    IF NEW.status <> 'pending' THEN
      NEW.status := 'pending';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_payment_transaction_insert ON public.payment_transactions;
CREATE TRIGGER trg_protect_payment_transaction_insert
  BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_payment_transaction_insert();

-- ------------------------------------------------------------------------------
-- 4. SURCHARGE SÉCURISÉE DE delete_client_cascade (VULN-16)
-- Accepte les deux signatures d'appel (1 ou 2 paramètres) sans erreur
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_client_cascade(p_client_id uuid, p_business_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id
  FROM public.clients
  WHERE id = p_client_id;

  IF v_business_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (public.owns_business(v_business_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Action non autorisée sur cet atelier.';
  END IF;

  -- 1. Supprimer les paiements liés aux commandes du client
  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id FROM public.orders WHERE client_id = p_client_id
  );

  -- 2. Supprimer les photos liées aux commandes du client
  DELETE FROM public.order_images
  WHERE order_id IN (
    SELECT id FROM public.orders WHERE client_id = p_client_id
  );

  -- 3. Supprimer les commandes du client
  DELETE FROM public.orders
  WHERE client_id = p_client_id;

  -- 4. Supprimer les valeurs de mesures des relevés du client
  DELETE FROM public.measurement_values
  WHERE set_id IN (
    SELECT id FROM public.measurement_sets WHERE client_id = p_client_id
  );

  -- 5. Supprimer les relevés de mesures du client
  DELETE FROM public.measurement_sets
  WHERE client_id = p_client_id;

  -- 6. Supprimer les rendez-vous du client
  DELETE FROM public.appointments
  WHERE client_id = p_client_id;

  -- 7. Supprimer le client lui-même
  DELETE FROM public.clients
  WHERE id = p_client_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client_cascade(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. TABLE D'AUDIT SÉCURITÉ DES ACTIONS SENSIBLES (VULN-19)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_security_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_security_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_audit_logs_select" ON public.audit_security_logs;
CREATE POLICY "admin_audit_logs_select" ON public.audit_security_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.audit_security_logs TO authenticated;
GRANT ALL ON public.audit_security_logs TO service_role;

-- ------------------------------------------------------------------------------
-- 6. PRIVACY LOOKBOOK & FONCTION RPC SÉCURISÉE (VULN-03)
-- ------------------------------------------------------------------------------

-- Fonction RPC sécurisée : ne retourne l'atelier QUE si l'identifiant exact est demandé
CREATE OR REPLACE FUNCTION public.get_public_lookbook_atelier(p_atelier_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  whatsapp text,
  address text,
  city text,
  currency text,
  logo_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.phone, b.whatsapp, b.address, b.city, b.currency, b.logo_url
  FROM public.businesses b
  WHERE b.id = p_atelier_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_lookbook_atelier(uuid) TO anon, authenticated;

-- Vue publique sécurisée : restreinte sans données de contact personnelles brutes en masse
CREATE OR REPLACE VIEW public.atelier_lookbook_public AS
  SELECT id, name, city, currency, logo_url
  FROM public.businesses;

GRANT SELECT ON public.atelier_lookbook_public TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 7. MACHINE À ÉTATS POUR LES COMMANDES (VULN-15)
-- Empêche les sauts d'états incohérents (ex: 'nouvelle' directement vers 'livree')
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Les administrateurs peuvent forcer n'importe quelle transition
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Une commande terminée ou annulée ne peut plus changer d'état
  IF OLD.status IN ('livree', 'annulee') THEN
    RAISE EXCEPTION 'Impossible de modifier le statut d''une commande déjà archivée (%)', OLD.status;
  END IF;

  -- N'importe quel état actif peut basculer vers annulee
  IF NEW.status = 'annulee' THEN
    RETURN NEW;
  END IF;

  -- Transitions séquentielles légitimes
  IF OLD.status = 'nouvelle' AND NEW.status IN ('preparation', 'confection') THEN
    RETURN NEW;
  ELSIF OLD.status = 'preparation' AND NEW.status IN ('confection', 'finition') THEN
    RETURN NEW;
  ELSIF OLD.status = 'confection' AND NEW.status IN ('finition', 'prete') THEN
    RETURN NEW;
  ELSIF OLD.status = 'finition' AND NEW.status IN ('prete', 'livree') THEN
    RETURN NEW;
  ELSIF OLD.status = 'prete' AND NEW.status = 'livree' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transition de statut invalide : impossible de passer directement de "%" à "%".', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_status ON public.orders;
CREATE TRIGGER trg_validate_order_status
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_status_transition();

-- ------------------------------------------------------------------------------
-- 8. CONTRAINTES D'INTÉGRITÉ COMPTABLE ET FINANCIÈRE
-- ------------------------------------------------------------------------------

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_price_positive;
ALTER TABLE public.orders ADD CONSTRAINT orders_price_positive CHECK (price >= 0);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_quantity_positive;
ALTER TABLE public.orders ADD CONSTRAINT orders_quantity_positive CHECK (quantity > 0);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

-- ------------------------------------------------------------------------------
-- 9. RESTRICTION DES TYPES MIME DANS LE BUCKET ATELIER (VULN-10)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "enforce_atelier_image_mime" ON storage.objects;
CREATE POLICY "enforce_atelier_image_mime" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'atelier' AND (
      (metadata->>'mimetype') IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
      OR name ~* '\.(jpe?g|png|webp|avif)$'
    )
  );

-- ------------------------------------------------------------------------------
-- 10. RECHARGEMENT DU SCHÉMA POSTGREST
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
