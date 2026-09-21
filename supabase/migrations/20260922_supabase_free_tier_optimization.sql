-- ============================================================
-- OPTIMISATION SUPABASE FREE TIER — CouturPro
-- ============================================================
-- Objectif : minimiser l'espace disque PostgreSQL (quota 500 Mo)
--            pour supporter des milliers d'ateliers en plan gratuit.
-- Auteur    : équipe CouturPro
-- Date      : 2026-09-22
-- ============================================================

-- ------------------------------------------------------------
-- 1. AUTOVACUUM AGRESSIF sur les tables à forte activité
--    (commandes, clients, paiements, businesses)
--    => Récupère l'espace mort (dead tuples) plus rapidement.
--    Valeurs par défaut : scale_factor=0.2 (20%) — trop laxiste.
--    Ici on passe à 5% pour déclencher le vacuum bien plus tôt.
-- ------------------------------------------------------------

ALTER TABLE public.orders
  SET (
    autovacuum_vacuum_scale_factor    = 0.05,
    autovacuum_analyze_scale_factor   = 0.02,
    autovacuum_vacuum_cost_delay      = 2
  );

ALTER TABLE public.clients
  SET (
    autovacuum_vacuum_scale_factor    = 0.05,
    autovacuum_analyze_scale_factor   = 0.02,
    autovacuum_vacuum_cost_delay      = 2
  );

ALTER TABLE public.payments
  SET (
    autovacuum_vacuum_scale_factor    = 0.05,
    autovacuum_analyze_scale_factor   = 0.02,
    autovacuum_vacuum_cost_delay      = 2
  );

ALTER TABLE public.businesses
  SET (
    autovacuum_vacuum_scale_factor    = 0.05,
    autovacuum_analyze_scale_factor   = 0.02,
    autovacuum_vacuum_cost_delay      = 2
  );

ALTER TABLE public.order_images
  SET (
    autovacuum_vacuum_scale_factor    = 0.05,
    autovacuum_analyze_scale_factor   = 0.02,
    autovacuum_vacuum_cost_delay      = 2
  );

ALTER TABLE public.measurement_sets
  SET (
    autovacuum_vacuum_scale_factor    = 0.05,
    autovacuum_analyze_scale_factor   = 0.02,
    autovacuum_vacuum_cost_delay      = 2
  );

-- ------------------------------------------------------------
-- 2. PURGE LOGS D'AUDIT SUPABASE
--    La table auth.audit_log_entries grossit silencieusement.
--    C'est l'une des causes n°1 de saturation du quota 500 Mo.
--    On crée une fonction sécurisée pour la purge périodique.
--    Accessible uniquement via service_role (backend Supabase).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_supabase_audit_logs(
  days int DEFAULT 14
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  deleted_count int;
BEGIN
  DELETE FROM auth.audit_log_entries
  WHERE created_at < NOW() - (days || ' days')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

-- Retire tous les droits publics, uniquement service_role peut appeler
REVOKE ALL ON FUNCTION public.purge_supabase_audit_logs(int)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.purge_supabase_audit_logs(int)
  TO service_role;

COMMENT ON FUNCTION public.purge_supabase_audit_logs IS
  'Supprime les logs d''audit Supabase plus anciens que N jours (défaut: 14).
   Appel typique via pg_cron ou Supabase Edge Function hebdomadaire :
   SELECT public.purge_supabase_audit_logs(14);';

-- ------------------------------------------------------------
-- 3. VUE DIAGNOSTIC — taille des tables publiques
--    Permet de surveiller rapidement où part l'espace disque.
--    Accessible en lecture aux utilisateurs authentifiés (admin).
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_table_sizes AS
SELECT
  schemaname || '.' || tablename                                        AS table_name,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname || '.' || tablename))       AS data_size,
  pg_size_pretty(
    pg_total_relation_size(schemaname || '.' || tablename)
    - pg_relation_size(schemaname || '.' || tablename)
  )                                                                      AS index_size,
  pg_total_relation_size(schemaname || '.' || tablename)                 AS bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY bytes DESC;

-- Seul service_role peut interroger la vue (données sensibles)
REVOKE ALL ON public.v_table_sizes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_table_sizes TO service_role;

COMMENT ON VIEW public.v_table_sizes IS
  'Vue diagnostic : taille des tables du schéma public.
   Requête : SELECT * FROM public.v_table_sizes LIMIT 20;';

-- ------------------------------------------------------------
-- 4. INDEX PARTIELS — accélèrent les requêtes fréquentes
--    et réduisent la taille des index (free tier bénéficie
--    d'index petits et ciblés).
-- ------------------------------------------------------------

-- Index pour la liste des commandes actives par atelier
CREATE INDEX IF NOT EXISTS idx_orders_business_status_active
  ON public.orders (business_id, status, due_date)
  WHERE status NOT IN ('livree', 'annulee');

COMMENT ON INDEX idx_orders_business_status_active IS
  'Index partiel : commandes en cours uniquement (excl. livrées et annulées).
   Accélère la liste des commandes actives sans indexer l''historique.';

-- Index pour recherche client par atelier
CREATE INDEX IF NOT EXISTS idx_clients_business_search
  ON public.clients (business_id, last_name, first_name);

COMMENT ON INDEX idx_clients_business_search IS
  'Index pour recherche et tri des clients par atelier.';

-- Index pour photos par commande
CREATE INDEX IF NOT EXISTS idx_order_images_order_id
  ON public.order_images (order_id, business_id);

COMMENT ON INDEX idx_order_images_order_id IS
  'Index pour récupérer les photos d''une commande rapidement.';

-- ------------------------------------------------------------
-- FIN DU SCRIPT
-- ------------------------------------------------------------
