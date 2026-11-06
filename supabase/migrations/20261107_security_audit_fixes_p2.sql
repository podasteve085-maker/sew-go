-- ==============================================================================
-- CouturPro — MIGRATION AUDIT SÉCURITÉ NOVEMBRE 2026 — PARTIE 2
-- Correctifs : save_catalog_model (is_public), .env.example documentation
-- ==============================================================================

-- ==============================================================================
-- Mise à jour de save_catalog_model pour gérer is_public (P1-1)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.save_catalog_model(p_model jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          uuid;
  v_business_id uuid;
  v_row         public.catalog_models;
  v_photo_paths text[];
  v_tags        text[];
BEGIN
  v_id          := NULLIF(p_model->>'id', '')::uuid;
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
      name        = COALESCE(NULLIF(p_model->>'name', ''), name),
      category    = COALESCE(NULLIF(p_model->>'category', ''), category),
      description = CASE WHEN p_model ? 'description' THEN p_model->>'description' ELSE description END,
      default_price = CASE
        WHEN p_model ? 'default_price' THEN NULLIF(p_model->>'default_price', '')::numeric
        ELSE default_price
      END,
      fabric_needed = CASE WHEN p_model ? 'fabric_needed' THEN p_model->>'fabric_needed' ELSE fabric_needed END,
      photo_paths = COALESCE(v_photo_paths, photo_paths),
      tags        = COALESCE(v_tags, tags),
      is_active   = COALESCE((p_model->>'is_active')::boolean, is_active),
      -- P1-1 : mettre à jour is_public si fourni (opt-in lookbook public)
      is_public   = COALESCE((p_model->>'is_public')::boolean, is_public),
      updated_at  = now()
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
      is_active,
      is_public
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
      COALESCE((p_model->>'is_active')::boolean, true),
      -- P1-1 : default false (privé) pour tout nouveau modèle
      COALESCE((p_model->>'is_public')::boolean, false)
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

-- ==============================================================================
-- Rechargement du schéma PostgREST
-- ==============================================================================
NOTIFY pgrst, 'reload schema';
