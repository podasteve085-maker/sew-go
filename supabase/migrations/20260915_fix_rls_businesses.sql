-- ==============================================================================
-- Correction critique des politiques RLS sur public.businesses
-- Problème : la policy "own business" FOR ALL et "admin select all businesses"
-- FOR SELECT créent un conflit — Postgres applique AND entre elles, bloquant
-- la lecture si l'utilisateur n'est pas dans les deux policies simultanément.
-- Solution : supprimer "own business" FOR ALL, recréer des policies atomiques
-- par opération (SELECT/INSERT/UPDATE/DELETE) sans récursion.
-- ==============================================================================

-- Étape 1 : Supprimer toutes les anciennes policies conflictuelles sur businesses
DROP POLICY IF EXISTS "own business" ON public.businesses;
DROP POLICY IF EXISTS "admin select all businesses" ON public.businesses;
DROP POLICY IF EXISTS "admin update all businesses" ON public.businesses;

-- Étape 2 : Recréer les policies atomiques sans récursion ni conflit

-- SELECT : chaque couturier voit son propre atelier ; les admins voient tout via SECURITY DEFINER
CREATE POLICY "businesses_select" ON public.businesses
FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR public.is_admin());

-- INSERT : uniquement pour son propre atelier
CREATE POLICY "businesses_insert" ON public.businesses
FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

-- UPDATE : le couturier met à jour son propre atelier ; les admins peuvent mettre à jour n'importe lequel
CREATE POLICY "businesses_update" ON public.businesses
FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR public.is_admin())
WITH CHECK (owner_id = auth.uid() OR public.is_admin());

-- DELETE : uniquement le propriétaire peut supprimer son atelier
CREATE POLICY "businesses_delete" ON public.businesses
FOR DELETE TO authenticated
USING (owner_id = auth.uid());
