-- Autoriser les visiteurs / clients sans authentification à consulter le lookbook en ligne
GRANT SELECT ON public.catalog_models TO anon;
GRANT SELECT ON public.businesses TO anon;

DROP POLICY IF EXISTS "public_read_active_catalog_models" ON public.catalog_models;
CREATE POLICY "public_read_active_catalog_models" ON public.catalog_models
  FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "public_read_businesses_info" ON public.businesses;
CREATE POLICY "public_read_businesses_info" ON public.businesses
  FOR SELECT TO anon
  USING (true);
