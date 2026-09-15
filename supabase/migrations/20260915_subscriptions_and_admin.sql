-- ==============================================================================
-- Migration : Abonnements (Freemium / Pro / Annuel), Transactions & Droits Admin
-- ==============================================================================

-- 1. Ajout des colonnes d'abonnement et d'administration sur la table businesses
ALTER TABLE public.businesses
ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free',
ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Contraintes sur les valeurs de plan
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_plan_check'
  ) THEN
    ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_plan_check
    CHECK (plan IN ('free', 'pro_monthly', 'pro_yearly', 'unlimited'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_plan_status_check'
  ) THEN
    ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_plan_status_check
    CHECK (plan_status IN ('active', 'past_due', 'canceled', 'trialing'));
  END IF;
END $$;

-- 2. Table des transactions de paiement (traçabilité comptable & agrégateurs)
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'FCFA',
  provider text NOT NULL, -- 'orange_money', 'moov_money', 'wave', 'cinetpay', 'fedapay', 'paydunya', 'admin_manual'
  provider_tx_id text,
  customer_phone text,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'canceled'
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS payment_transactions_business_idx ON public.payment_transactions(business_id);
CREATE INDEX IF NOT EXISTS payment_transactions_status_idx ON public.payment_transactions(status);

GRANT SELECT, INSERT, UPDATE ON public.payment_transactions TO authenticated;
GRANT ALL ON public.payment_transactions TO service_role;

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- Les couturiers voient uniquement leurs propres transactions d'abonnement
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant payment transactions' AND tablename = 'payment_transactions') THEN
    CREATE POLICY "tenant payment transactions" ON public.payment_transactions
    FOR ALL TO authenticated
    USING (public.owns_business(business_id))
    WITH CHECK (public.owns_business(business_id));
  END IF;
END $$;

-- 3. Fonction SECURITY DEFINER pour éviter toute récursion infinie dans les RLS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.businesses WHERE owner_id = auth.uid() LIMIT 1),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- Politiques d'administration (permet aux admins de lire et gérer tous les ateliers sans récursion)
DROP POLICY IF EXISTS "admin select all businesses" ON public.businesses;
DROP POLICY IF EXISTS "admin update all businesses" ON public.businesses;
DROP POLICY IF EXISTS "admin view all transactions" ON public.payment_transactions;

CREATE POLICY "admin select all businesses" ON public.businesses
FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "admin update all businesses" ON public.businesses
FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR public.is_admin())
WITH CHECK (owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "admin view all transactions" ON public.payment_transactions
FOR SELECT TO authenticated
USING (public.owns_business(business_id) OR public.is_admin());

-- 4. Attribution automatique des droits admin au compte principal de l'utilisateur
UPDATE public.businesses
SET is_admin = true, plan = 'unlimited', plan_status = 'active'
WHERE owner_id IN (
  SELECT id FROM auth.users
  WHERE email IN ('podasteve085@gmail.com', 'podasteve924@gmail.com')
);
