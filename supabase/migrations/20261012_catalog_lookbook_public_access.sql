-- Lookbook public : un client (avec ou sans compte) peut consulter
-- les modèles actifs et les photos du dossier catalog, sans accéder
-- aux photos clients / commandes de l'atelier.
-- Le propriétaire conserve INSERT / UPDATE / DELETE sur ses propres modèles.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_models TO authenticated;
GRANT SELECT ON public.catalog_models TO anon;

-- Lecture publique limitée (colonnes vitrine uniquement)
DROP VIEW IF EXISTS public.atelier_lookbook_public;
CREATE VIEW public.atelier_lookbook_public
WITH (security_invoker = false)
AS
SELECT id, name, phone, whatsapp, address, city, currency, logo_url
FROM public.businesses;

GRANT SELECT ON public.atelier_lookbook_public TO anon, authenticated;

-- Ne pas exposer toute la fiche atelier aux visiteurs anonymes
REVOKE SELECT ON TABLE public.businesses FROM anon;

DROP POLICY IF EXISTS "public_read_active_catalog_models" ON public.catalog_models;
CREATE POLICY "public_read_active_catalog_models" ON public.catalog_models
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- Garantit que le détenteur peut toujours modifier / supprimer son catalogue
DROP POLICY IF EXISTS "catalog_models_owner_insert" ON public.catalog_models;
CREATE POLICY "catalog_models_owner_insert" ON public.catalog_models
  FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_business(business_id) OR public.is_admin());

DROP POLICY IF EXISTS "catalog_models_owner_update" ON public.catalog_models;
CREATE POLICY "catalog_models_owner_update" ON public.catalog_models
  FOR UPDATE
  TO authenticated
  USING (public.owns_business(business_id) OR public.is_admin())
  WITH CHECK (public.owns_business(business_id) OR public.is_admin());

DROP POLICY IF EXISTS "catalog_models_owner_delete" ON public.catalog_models;
CREATE POLICY "catalog_models_owner_delete" ON public.catalog_models
  FOR DELETE
  TO authenticated
  USING (public.owns_business(business_id) OR public.is_admin());

-- Photos du lookbook uniquement : {businessId}/catalog/...
DROP POLICY IF EXISTS "public_read_catalog_images" ON storage.objects;
CREATE POLICY "public_read_catalog_images" ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'atelier'
    AND (
      COALESCE((storage.foldername(name))[2], '') = 'catalog'
      OR name LIKE '%/catalog/%'
    )
  );

-- Suppression atomique d'un modèle par son propriétaire (contourne les lectures RLS vides)
CREATE OR REPLACE FUNCTION public.delete_catalog_model(p_model_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_photo_paths text[];
BEGIN
  SELECT business_id, COALESCE(photo_paths, '{}')
    INTO v_business_id, v_photo_paths
  FROM public.catalog_models
  WHERE id = p_model_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Modèle introuvable';
  END IF;

  IF NOT (public.owns_business(v_business_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Action non autorisée sur ce catalogue.';
  END IF;

  DELETE FROM public.catalog_models WHERE id = p_model_id;

  RETURN jsonb_build_object(
    'id', p_model_id,
    'photo_paths', to_jsonb(COALESCE(v_photo_paths, '{}'::text[]))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_catalog_model(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_catalog_model(uuid) TO authenticated, service_role;

-- Création / mise à jour (y compris retrait de photos) par le propriétaire
CREATE OR REPLACE FUNCTION public.save_catalog_model(p_model jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_business_id uuid;
  v_row public.catalog_models;
  v_photo_paths text[];
  v_tags text[];
BEGIN
  v_id := NULLIF(p_model->>'id', '')::uuid;
  v_business_id := NULLIF(p_model->>'business_id', '')::uuid;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Atelier introuvable';
  END IF;

  IF NOT (public.owns_business(v_business_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Action non autorisée sur ce catalogue.';
  END IF;

  IF jsonb_typeof(p_model->'photo_paths') = 'array' THEN
    SELECT COALESCE(array_agg(elem ORDER BY ord), '{}')
      INTO v_photo_paths
    FROM jsonb_array_elements_text(p_model->'photo_paths') WITH ORDINALITY AS t(elem, ord);
  END IF;

  IF jsonb_typeof(p_model->'tags') = 'array' THEN
    SELECT COALESCE(array_agg(elem ORDER BY ord), '{}')
      INTO v_tags
    FROM jsonb_array_elements_text(p_model->'tags') WITH ORDINALITY AS t(elem, ord);
  END IF;

  IF v_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.catalog_models WHERE id = v_id
  ) THEN
    UPDATE public.catalog_models SET
      name = COALESCE(NULLIF(p_model->>'name', ''), name),
      category = COALESCE(NULLIF(p_model->>'category', ''), category),
      description = CASE WHEN p_model ? 'description' THEN p_model->>'description' ELSE description END,
      default_price = CASE
        WHEN p_model ? 'default_price' THEN NULLIF(p_model->>'default_price', '')::numeric
        ELSE default_price
      END,
      fabric_needed = CASE WHEN p_model ? 'fabric_needed' THEN p_model->>'fabric_needed' ELSE fabric_needed END,
      photo_paths = COALESCE(v_photo_paths, photo_paths),
      tags = COALESCE(v_tags, tags),
      is_active = COALESCE((p_model->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = v_id
      AND business_id = v_business_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.catalog_models (
      id,
      business_id,
      name,
      category,
      description,
      default_price,
      fabric_needed,
      photo_paths,
      tags,
      is_active
    ) VALUES (
      COALESCE(v_id, gen_random_uuid()),
      v_business_id,
      NULLIF(p_model->>'name', ''),
      COALESCE(NULLIF(p_model->>'category', ''), 'boubou'),
      p_model->>'description',
      NULLIF(p_model->>'default_price', '')::numeric,
      p_model->>'fabric_needed',
      COALESCE(v_photo_paths, '{}'::text[]),
      COALESCE(v_tags, '{}'::text[]),
      COALESCE((p_model->>'is_active')::boolean, true)
    )
    RETURNING * INTO v_row;
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Impossible d''enregistrer ce modèle.';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.save_catalog_model(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_catalog_model(jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
