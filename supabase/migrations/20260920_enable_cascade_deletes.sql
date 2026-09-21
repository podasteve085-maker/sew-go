-- ==============================================================================
-- CouturPro — SUPPRESSION EN CASCADE DES CLIENTS, COMMANDES ET RELEVÉS DE MESURES
-- ==============================================================================
-- Ce script configure :
-- 1. Les contraintes ON DELETE CASCADE pour supprimer automatiquement les enfants
--    lorsqu'un parent (client, commande, relevé de mesures) est supprimé.
-- 2. Une fonction RPC atomique sécurisée `delete_client_cascade` pour garantir
--    une suppression 100% propre et immédiate sous contrôle RLS.
-- ==============================================================================

-- 1. APPOINTMENTS -> CLIENTS (ON DELETE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'appointments_client_id_fkey' AND table_name = 'appointments'
  ) THEN
    ALTER TABLE public.appointments DROP CONSTRAINT appointments_client_id_fkey;
  END IF;

  ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_client_id_fkey
    FOREIGN KEY (client_id)
    REFERENCES public.clients(id)
    ON DELETE CASCADE;
END $$;

-- 2. MEASUREMENT_VALUES -> MEASUREMENT_SETS (ON DELETE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'measurement_values_set_id_fkey' AND table_name = 'measurement_values'
  ) THEN
    ALTER TABLE public.measurement_values DROP CONSTRAINT measurement_values_set_id_fkey;
  END IF;

  ALTER TABLE public.measurement_values
    ADD CONSTRAINT measurement_values_set_id_fkey
    FOREIGN KEY (set_id)
    REFERENCES public.measurement_sets(id)
    ON DELETE CASCADE;
END $$;

-- 3. MEASUREMENT_SETS -> CLIENTS (ON DELETE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'measurement_sets_client_id_fkey' AND table_name = 'measurement_sets'
  ) THEN
    ALTER TABLE public.measurement_sets DROP CONSTRAINT measurement_sets_client_id_fkey;
  END IF;

  ALTER TABLE public.measurement_sets
    ADD CONSTRAINT measurement_sets_client_id_fkey
    FOREIGN KEY (client_id)
    REFERENCES public.clients(id)
    ON DELETE CASCADE;
END $$;

-- 4. ORDER_IMAGES -> ORDERS (ON DELETE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'order_images_order_id_fkey' AND table_name = 'order_images'
  ) THEN
    ALTER TABLE public.order_images DROP CONSTRAINT order_images_order_id_fkey;
  END IF;

  ALTER TABLE public.order_images
    ADD CONSTRAINT order_images_order_id_fkey
    FOREIGN KEY (order_id)
    REFERENCES public.orders(id)
    ON DELETE CASCADE;
END $$;

-- 5. PAYMENTS -> ORDERS (ON DELETE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'payments_order_id_fkey' AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_order_id_fkey;
  END IF;

  ALTER TABLE public.payments
    ADD CONSTRAINT payments_order_id_fkey
    FOREIGN KEY (order_id)
    REFERENCES public.orders(id)
    ON DELETE CASCADE;
END $$;

-- 6. ORDERS -> CLIENTS (ON DELETE CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'orders_client_id_fkey' AND table_name = 'orders'
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_client_id_fkey;
  END IF;

  ALTER TABLE public.orders
    ADD CONSTRAINT orders_client_id_fkey
    FOREIGN KEY (client_id)
    REFERENCES public.clients(id)
    ON DELETE CASCADE;
END $$;

-- ------------------------------------------------------------------------------
-- 7. FONCTION RPC DE SUPPRESSION ATOMIQUE SÉCURISÉE D'UN CLIENT
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_client_cascade(p_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id
  FROM public.clients
  WHERE id = p_client_id;

  IF v_business_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.owns_business(v_business_id) THEN
    RAISE EXCEPTION 'Action non autorisée sur cet atelier.';
  END IF;

  -- 1. Supprimer les paiements liés aux commandes du client
  DELETE FROM public.payments
  WHERE order_id IN (
    SELECT id FROM public.orders WHERE client_id = p_client_id
  );

  -- 2. Supprimer les photos liées aux commandes du client
  DELETE FROM public.order_images
  WHERE order_id IN (
    SELECT id FROM public.orders WHERE client_id = p_client_id
  );

  -- 3. Supprimer les commandes du client
  DELETE FROM public.orders
  WHERE client_id = p_client_id;

  -- 4. Supprimer les valeurs de mesures des relevés du client
  DELETE FROM public.measurement_values
  WHERE set_id IN (
    SELECT id FROM public.measurement_sets WHERE client_id = p_client_id
  );

  -- 5. Supprimer les relevés de mesures du client
  DELETE FROM public.measurement_sets
  WHERE client_id = p_client_id;

  -- 6. Supprimer les rendez-vous du client
  DELETE FROM public.appointments
  WHERE client_id = p_client_id;

  -- 7. Supprimer le client lui-même
  DELETE FROM public.clients
  WHERE id = p_client_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client_cascade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid) TO authenticated, service_role;
