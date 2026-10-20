-- ==============================================================================
-- CouturPro — Migration : Quota de Photos Catalogue (Lookbook)
-- Mensuel : Max 200 photos tous catalogues/modèles confondus
-- Trimestriel / Annuel / Admin : Illimité à l'infini
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.check_catalog_photo_quota_enforcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_is_admin boolean;
  v_expires_at timestamptz;
  v_other_photos_count integer;
  v_new_model_photos_count integer;
  v_total_photos integer;
  v_monthly_photo_limit integer := 200;
BEGIN
  -- Récupérer l'état d'abonnement de l'atelier
  SELECT plan, is_admin, plan_expires_at
    INTO v_plan, v_is_admin, v_expires_at
  FROM public.businesses
  WHERE id = NEW.business_id;

  -- 1. Exemption totale pour les comptes Administrateur
  IF v_is_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  -- 2. Vérification de l'échéance d'abonnement pour les forfaits payants
  IF v_plan IS NOT NULL AND v_plan <> 'free' THEN
    IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
      RAISE EXCEPTION 'Abonnement CouturPro expiré. Votre atelier est en mode Consultation. Réactivez votre Pass Atelier pour ajouter ou modifier des modèles.';
    END IF;
  END IF;

  -- 3. Plan Gratuit / Découverte : L'ajout de modèles personnels est réservé aux abonnés Pro
  IF v_plan IS NULL OR v_plan = 'free' THEN
    RAISE EXCEPTION 'En formule Découverte, vous pouvez consulter le Lookbook. L''ajout et la personnalisation de modèles de catalogue est réservé aux ateliers abonnés Pro.';
  END IF;

  -- 4. Formules Trimestrielle, Annuelle et Illimitée : Aucune restriction (Illimité)
  IF v_plan IN ('quarterly', 'yearly', 'unlimited', 'pro_yearly') THEN
    RETURN NEW;
  END IF;

  -- 5. Formule Pro Mensuelle ('monthly', 'pro_monthly') : Plafond strict de 200 photos tous catalogues confondus
  IF v_plan IN ('monthly', 'pro_monthly') THEN
    -- Calcul du nombre de photos dans le modèle actuel
    v_new_model_photos_count := COALESCE(cardinality(NEW.photo_paths), 0);

    -- Somme des photos présentes dans tous les autres modèles de cet atelier
    SELECT COALESCE(SUM(cardinality(photo_paths)), 0)
      INTO v_other_photos_count
    FROM public.catalog_models
    WHERE business_id = NEW.business_id
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    v_total_photos := v_other_photos_count + v_new_model_photos_count;

    IF v_total_photos > v_monthly_photo_limit THEN
      RAISE EXCEPTION 'Plafond de % photos de catalogue atteint pour la formule Pro Mensuel (actuellement % photos). Passez au Pass Trimestriel ou Annuel pour débloquer les photos illimitées à l''infini !',
        v_monthly_photo_limit, v_total_photos;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_catalog_photo_quota ON public.catalog_models;
CREATE TRIGGER trg_enforce_catalog_photo_quota
  BEFORE INSERT OR UPDATE OF photo_paths, business_id ON public.catalog_models
  FOR EACH ROW
  EXECUTE FUNCTION public.check_catalog_photo_quota_enforcement();
