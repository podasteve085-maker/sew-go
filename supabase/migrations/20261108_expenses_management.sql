-- ==============================================================================
-- CouturPro — MODULE COMPTABILITÉ & GESTION DES CHARGES D'ATELIER
-- ==============================================================================
-- Table des dépenses et charges d'atelier (salaires, loyer, mercerie, énergie...)
-- Isolation stricte multi-tenants par business_id avec RLS.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- 'salaire', 'loyer', 'fournitures', 'electricite', 'maintenance', 'transport', 'autre'
  title TEXT NOT NULL, -- Motif de la dépense (ex: "Avance sur salaire Moussa", "Loyer Novembre")
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  beneficiary_name TEXT, -- Nom de l'employé, apprenti ou fournisseur
  payment_method TEXT NOT NULL DEFAULT 'cash', -- 'cash', 'wave', 'orange_money', 'mtn_momo', 'bank'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index d'optimisation pour les requêtes par atelier et par date/mois
CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON public.expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(business_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(business_id, category);

-- Activation de Row Level Security (RLS)
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Politique d'accès multi-tenant étanche
DROP POLICY IF EXISTS "tenant expenses" ON public.expenses;
CREATE POLICY "tenant expenses" ON public.expenses
  FOR ALL TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

-- Trigger pour la mise à jour automatique de updated_at
CREATE OR REPLACE FUNCTION public.handle_expenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_expenses_updated_at ON public.expenses;
CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_expenses_updated_at();
