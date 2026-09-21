-- ==============================================================================
-- CouturPro — ISOLATION STRICTE MULTI-TENANTS & VERROUILLAGE SÉCURITÉ ADMIN
-- ==============================================================================
-- Ce script garantit :
-- 1. L'étanchéité totale des ateliers de couture (aucune fuite de données inter-ateliers).
-- 2. La restriction absolue des droits d'administration au compte superadmin principal.
-- 3. La suppression de tout passe-droit admin sur les données métier (commandes, clients...).
-- 4. Une fonction RPC sécurisée pour les KPI globaux de l'Administration Centrale.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RÉVOCATION DE L'ADMIN POUR TOUS LES ATELIERS SAUF LE COMPTE SUPERADMIN
-- ------------------------------------------------------------------------------
UPDATE public.businesses
SET is_admin = false
WHERE is_admin = true
  AND owner_id NOT IN (
    SELECT id
    FROM auth.users
    WHERE lower(email) = 'podasteve085@gmail.com'
  );

UPDATE public.businesses
SET is_admin = true,
    plan = 'unlimited',
    plan_status = 'active',
    plan_expires_at = NULL
WHERE owner_id IN (
  SELECT id
  FROM auth.users
  WHERE lower(email) = 'podasteve085@gmail.com'
);

CREATE OR REPLACE FUNCTION public.prevent_admin_self_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
     AND auth.uid() IS NOT NULL
     AND auth.uid() = OLD.owner_id
     AND NOT OLD.is_admin
     AND NEW.is_admin THEN
    RAISE EXCEPTION 'Seul un administrateur existant peut accorder les droits administrateur.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_admin_self_promotion ON public.businesses;
CREATE TRIGGER prevent_admin_self_promotion
  BEFORE UPDATE OF is_admin ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_self_promotion();

REVOKE ALL ON FUNCTION public.prevent_admin_self_promotion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prevent_admin_self_promotion() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. REDÉFINITION STRICTE DE public.owns_business (AUCUNE EXCEPTION ADMIN)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owns_business(_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = _business_id
      AND b.owner_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.owns_business(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_business(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.businesses WHERE owner_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_business_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.businesses WHERE owner_id = auth.uid() LIMIT 1),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. SÉCURISATION ET ÉTANCHÉITÉ PARFAITE DES 10 TABLES MÉTIER (RLS)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant clients" ON public.clients;
DROP POLICY IF EXISTS "admin select all clients" ON public.clients;
DROP POLICY IF EXISTS "clients_all" ON public.clients;

DROP POLICY IF EXISTS "tenant orders" ON public.orders;
DROP POLICY IF EXISTS "admin select all orders" ON public.orders;
DROP POLICY IF EXISTS "orders_all" ON public.orders;

DROP POLICY IF EXISTS "tenant order images" ON public.order_images;
DROP POLICY IF EXISTS "order_images_all" ON public.order_images;

DROP POLICY IF EXISTS "tenant payments" ON public.payments;
DROP POLICY IF EXISTS "payments_all" ON public.payments;

DROP POLICY IF EXISTS "tenant appointments" ON public.appointments;
DROP POLICY IF EXISTS "appointments_all" ON public.appointments;

DROP POLICY IF EXISTS "tenant templates" ON public.measurement_templates;
DROP POLICY IF EXISTS "measurement_templates_all" ON public.measurement_templates;

DROP POLICY IF EXISTS "tenant measurement sets" ON public.measurement_sets;
DROP POLICY IF EXISTS "measurement_sets_all" ON public.measurement_sets;

DROP POLICY IF EXISTS "tenant measurement values" ON public.measurement_values;
DROP POLICY IF EXISTS "measurement_values_all" ON public.measurement_values;

DROP POLICY IF EXISTS "tenant garment types" ON public.garment_types;
DROP POLICY IF EXISTS "garment_types_all" ON public.garment_types;

DROP POLICY IF EXISTS "tenant catalog_models" ON public.catalog_models;
DROP POLICY IF EXISTS "owner_all_catalog_models" ON public.catalog_models;
DROP POLICY IF EXISTS "catalog_models_all" ON public.catalog_models;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant clients" ON public.clients
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant orders" ON public.orders
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant order images" ON public.order_images
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant payments" ON public.payments
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant appointments" ON public.appointments
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant templates" ON public.measurement_templates
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant measurement sets" ON public.measurement_sets
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant measurement values" ON public.measurement_values
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant garment types" ON public.garment_types
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "tenant catalog_models" ON public.catalog_models
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

-- ------------------------------------------------------------------------------
-- 4. POLITIQUES SUR BUSINESSES ET TRANSACTIONS D'ABONNEMENT
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "own business" ON public.businesses;
DROP POLICY IF EXISTS "admin select all businesses" ON public.businesses;
DROP POLICY IF EXISTS "admin update all businesses" ON public.businesses;
DROP POLICY IF EXISTS "businesses_select" ON public.businesses;
DROP POLICY IF EXISTS "businesses_insert" ON public.businesses;
DROP POLICY IF EXISTS "businesses_update" ON public.businesses;
DROP POLICY IF EXISTS "businesses_delete" ON public.businesses;

CREATE POLICY "businesses_select" ON public.businesses
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "businesses_insert" ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "businesses_update" ON public.businesses
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "businesses_delete" ON public.businesses
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant payment transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "admin view all transactions" ON public.payment_transactions;

CREATE POLICY "tenant payment transactions" ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (public.owns_business(business_id) OR public.is_admin());

CREATE POLICY "tenant insert payment transactions" ON public.payment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "admin update payment transactions" ON public.payment_transactions
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- 5. FONCTION RPC DE STATISTIQUES GLOBALES POUR L'ADMINISTRATION CENTRALE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_platform_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès refusé : réservé aux administrateurs de la plateforme.';
  END IF;

  RETURN json_build_object(
    'total_clients', (SELECT count(*) FROM public.clients),
    'total_orders', (SELECT count(*) FROM public.orders),
    'total_businesses', (SELECT count(*) FROM public.businesses),
    'total_revenue', (SELECT COALESCE(sum(amount), 0) FROM public.payment_transactions WHERE status = 'completed')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_platform_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_platform_stats() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
