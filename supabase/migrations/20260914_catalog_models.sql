-- =============================================================
-- CouturPro — Module Catalogue de Modèles (Lookbook)
-- Table, index, RLS et triggers pour la gestion des modèles
-- =============================================================

CREATE TABLE IF NOT EXISTS public.catalog_models (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID          NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          TEXT          NOT NULL,
  category      TEXT          NOT NULL DEFAULT 'autre',
  description   TEXT,
  default_price NUMERIC(12,0),
  fabric_needed TEXT,
  photo_paths   TEXT[]        NOT NULL DEFAULT '{}',
  tags          TEXT[]        NOT NULL DEFAULT '{}',
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index pour requêtes performantes
CREATE INDEX IF NOT EXISTS catalog_models_business_idx ON public.catalog_models(business_id);
CREATE INDEX IF NOT EXISTS catalog_models_category_idx ON public.catalog_models(business_id, category);
CREATE INDEX IF NOT EXISTS catalog_models_active_idx ON public.catalog_models(business_id, is_active);

-- Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_models TO authenticated;
GRANT ALL ON public.catalog_models TO service_role;

-- Row Level Security
ALTER TABLE public.catalog_models ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='catalog_models' AND policyname='tenant catalog_models'
  ) THEN
    CREATE POLICY "tenant catalog_models" ON public.catalog_models
      FOR ALL TO authenticated
      USING (public.owns_business(business_id))
      WITH CHECK (public.owns_business(business_id));
  END IF;
END $$;

-- Trigger updated_at
CREATE OR REPLACE TRIGGER catalog_models_touch
  BEFORE UPDATE ON public.catalog_models
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
