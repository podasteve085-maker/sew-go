-- Correction RLS pour la phase pilote.
-- Cette migration est à appliquer manuellement dans Supabase.
-- Elle n'est pas exécutée automatiquement par v0.

DROP POLICY IF EXISTS "own business" ON public.businesses;
DROP POLICY IF EXISTS "admin select all businesses" ON public.businesses;
DROP POLICY IF EXISTS "admin update all businesses" ON public.businesses;
DROP POLICY IF EXISTS "businesses_select" ON public.businesses;
DROP POLICY IF EXISTS "businesses_insert" ON public.businesses;
DROP POLICY IF EXISTS "businesses_update" ON public.businesses;
DROP POLICY IF EXISTS "businesses_delete" ON public.businesses;

CREATE POLICY "businesses_select_owner" ON public.businesses
  FOR SELECT TO authenticated
  USING (owner_id = (select auth.uid()));

CREATE POLICY "businesses_insert_owner" ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (select auth.uid()));

CREATE POLICY "businesses_update_owner" ON public.businesses
  FOR UPDATE TO authenticated
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

CREATE POLICY "businesses_delete_owner" ON public.businesses
  FOR DELETE TO authenticated
  USING (owner_id = (select auth.uid()));

-- Les tables métier utilisent owns_business(), qui est déjà SECURITY DEFINER
-- et vérifie directement le propriétaire sans repasser par les policies de businesses.
-- Recréer les policies garantit un état idempotent après les anciennes corrections.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'clients', 'measurement_templates', 'measurement_sets', 'measurement_values',
    'garment_types', 'orders', 'order_images', 'payments', 'appointments'
  ] LOOP
    policy_name := 'pilot_owner_' || table_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id))',
      policy_name, table_name
    );
  END LOOP;
END $$;

-- Commandes à exécuter manuellement après vérification :
-- supabase db push
-- ou, avec le SQL Editor Supabase, coller le contenu de cette migration.
