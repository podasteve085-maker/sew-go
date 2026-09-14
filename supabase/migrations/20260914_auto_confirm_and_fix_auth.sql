-- =============================================================
-- CouturPro — SOLUTION DÉFINITIVE AUTOMATISATION AUTHENTIFICATION
-- =============================================================
-- Ce script configure la base de données pour que TOUTES les
-- inscriptions soient automatiquement confirmées à 100% sans jamais
-- demander d'email ni d'intervention manuelle dans Supabase.
-- =============================================================

-- 1. Trigger BEFORE INSERT pour valider automatiquement l'email à la création :
CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Définit automatiquement la date de confirmation de l'email à l'instant présent
  NEW.email_confirmed_at = COALESCE(NEW.email_confirmed_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_auto_confirm
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_user();

-- 2. Confirmer immédiatement tous les comptes existants qui étaient bloqués :
UPDATE auth.users
SET email_confirmed_at = now()
WHERE email_confirmed_at IS NULL;

-- 3. S'assurer que tous les utilisateurs ont bien leur atelier initialisé :
DO $$
DECLARE
  u RECORD;
  b_id uuid;
BEGIN
  FOR u IN SELECT id, raw_user_meta_data FROM auth.users LOOP
    SELECT id INTO b_id FROM public.businesses WHERE owner_id = u.id;
    IF b_id IS NULL THEN
      INSERT INTO public.businesses (owner_id, name, owner_name, phone, whatsapp)
      VALUES (
        u.id,
        COALESCE(NULLIF(u.raw_user_meta_data->>'business_name', ''), 'Mon atelier'),
        u.raw_user_meta_data->>'owner_name',
        u.raw_user_meta_data->>'phone',
        u.raw_user_meta_data->>'phone'
      )
      RETURNING id INTO b_id;

      INSERT INTO public.measurement_templates (business_id, name, fields) VALUES
        (b_id, 'Homme', ARRAY['Tour de poitrine','Tour de taille','Tour de hanches','Carrure','Longueur épaule','Longueur dos','Longueur manche','Tour de bras','Tour de poignet','Longueur pantalon','Tour de cuisse','Tour de genou','Tour de cheville']),
        (b_id, 'Femme', ARRAY['Tour de poitrine','Sous-poitrine','Tour de taille','Tour de hanches','Carrure','Longueur épaule','Longueur dos','Longueur devant','Longueur manche','Tour de bras','Longueur robe','Longueur jupe','Tour de cuisse']),
        (b_id, 'Enfant', ARRAY['Tour de poitrine','Tour de taille','Tour de hanches','Longueur dos','Longueur manche','Longueur pantalon'])
      ON CONFLICT DO NOTHING;

      INSERT INTO public.garment_types (business_id, name)
      SELECT b_id, t FROM unnest(ARRAY['Boubou','Faso Dan Fani','Costume','Chemise','Pantalon','Robe','Jupe','Ensemble','Tenue traditionnelle','Uniforme','Autre']) AS t
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
