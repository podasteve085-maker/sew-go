-- ============================================================================
-- Sécurité : réserver l'administration aux comptes explicitement autorisés
-- À exécuter manuellement après vérification des emails administrateurs.
-- ============================================================================

-- Révoque les droits admin accordés par erreur à tous les autres ateliers.
UPDATE public.businesses
SET is_admin = false
WHERE is_admin = true
  AND owner_id NOT IN (
    SELECT id
    FROM auth.users
    WHERE lower(email) IN ('podasteve085@gmail.com', 'podasteve924@gmail.com')
  );

-- Garantit que les comptes administrateurs autorisés conservent leurs droits.
UPDATE public.businesses
SET is_admin = true,
    plan = 'unlimited',
    plan_status = 'active',
    plan_expires_at = NULL
WHERE owner_id IN (
  SELECT id
  FROM auth.users
  WHERE lower(email) IN ('podasteve085@gmail.com', 'podasteve924@gmail.com')
);

-- Empêche un propriétaire standard de s'auto-promouvoir via l'API.
CREATE OR REPLACE FUNCTION public.prevent_admin_self_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
     AND auth.uid() IS NOT NULL
     AND auth.uid() = OLD.owner_id
     AND NOT OLD.is_admin
     AND NEW.is_admin THEN
    RAISE EXCEPTION 'Seul un administrateur existant peut accorder les droits administrateur';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_admin_self_promotion ON public.businesses;
CREATE TRIGGER prevent_admin_self_promotion
  BEFORE UPDATE OF is_admin ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_self_promotion();

REVOKE ALL ON FUNCTION public.prevent_admin_self_promotion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_admin_self_promotion() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_admin_self_promotion() FROM authenticated;

COMMENT ON FUNCTION public.prevent_admin_self_promotion() IS
  'Prevents a non-admin business owner from granting itself admin access.';

-- Note : les politiques RLS existantes restent actives ; elles utilisent
-- public.is_admin() pour autoriser uniquement les administrateurs existants.
-- Cette migration ne modifie ni ne supprime les données métier.

NOTIFY pgrst, 'reload schema';
