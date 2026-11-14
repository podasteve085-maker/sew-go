-- ==============================================================================
-- CouturPro — Correction de la Machine à États des Commandes pour la Synchronisation Hors-Ligne
-- Date : 14 Novembre 2026
--
-- PROBLÈME RÉSOLU :
-- Lorsqu'un artisan travaille hors-ligne et fait évoluer le statut d'une commande
-- (ex: de 'preparation' directement vers 'livree' lors de la remise du vêtement au client),
-- l'ancien trigger trg_validate_order_status rejetait la synchronisation avec l'erreur :
-- "Transition de statut invalide : impossible de passer directement de 'preparation' à 'livree'".
--
-- La commande restait bloquée indéfiniment dans la file de synchronisation IndexedDB
-- avec l'icône de synchronisation en rotation permanente (⟳), affichant "Livré" dans
-- l'application locale mais restant bloquée à "En préparation" sur Supabase.
--
-- SOLUTION :
-- 1. Le propriétaire de l'atelier (public.owns_business) ou l'administrateur
--    est autorisé à mettre à jour le statut de ses commandes légitimement.
-- 2. Toutes les progressions normales vers l'avant (nouvelle -> preparation ->
--    confection -> finition -> prete -> livree) sont autorisées quel que soit le
--    nombre d'étapes franchies en mode hors-ligne.
-- 3. Les ajustements et retouches en atelier (recul d'une étape pour retouche)
--    sont autorisés pour l'artisan sans blocage.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_rank integer;
  v_new_rank integer;
BEGIN
  -- 1. Même statut : aucune modification de statut, toujours valide
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- 2. Vérification que le nouveau statut fait partie des valeurs d'énumération autorisées
  IF NEW.status NOT IN ('nouvelle', 'preparation', 'confection', 'finition', 'prete', 'livree', 'annulee') THEN
    RAISE EXCEPTION 'Statut de commande invalide : "%"', NEW.status;
  END IF;

  -- 3. Les administrateurs et les propriétaires de l'atelier (artisans authentifiés)
  --    ont pleine autorité pour gérer et synchroniser le statut de leurs commandes
  IF public.is_admin() OR public.owns_business(NEW.business_id) THEN
    RETURN NEW;
  END IF;

  -- 4. Annulation toujours autorisée depuis n'importe quel état actif
  IF NEW.status = 'annulee' THEN
    RETURN NEW;
  END IF;

  -- 5. Une commande déjà annulée ne peut plus être modifiée par un utilisateur tiers
  IF OLD.status = 'annulee' THEN
    RAISE EXCEPTION 'Impossible de modifier une commande déjà annulée';
  END IF;

  -- 6. Calcul des rangs séquentiels du flux de confection
  v_old_rank := CASE OLD.status
    WHEN 'nouvelle'    THEN 1
    WHEN 'preparation' THEN 2
    WHEN 'confection'  THEN 3
    WHEN 'finition'    THEN 4
    WHEN 'prete'       THEN 5
    WHEN 'livree'      THEN 6
    ELSE 0
  END;

  v_new_rank := CASE NEW.status
    WHEN 'nouvelle'    THEN 1
    WHEN 'preparation' THEN 2
    WHEN 'confection'  THEN 3
    WHEN 'finition'    THEN 4
    WHEN 'prete'       THEN 5
    WHEN 'livree'      THEN 6
    ELSE 0
  END;

  -- 7. Progression normale vers l'avant (autorisée même si plusieurs étapes franchies hors-ligne)
  IF v_old_rank > 0 AND v_new_rank > 0 AND v_new_rank >= v_old_rank THEN
    RETURN NEW;
  END IF;

  -- 8. Recul d'une seule étape pour ajustements / retouches de couture
  IF v_old_rank > 0 AND v_new_rank > 0 AND v_old_rank - v_new_rank = 1 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transition de statut non autorisée de "%" vers "%"', OLD.status, NEW.status;
END;
$$;

-- S'assurer que le trigger est actif avec la fonction mise à jour
DROP TRIGGER IF EXISTS trg_validate_order_status ON public.orders;
CREATE TRIGGER trg_validate_order_status
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_status_transition();
