-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ============ BUSINESSES ============
CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name text NOT NULL,
  owner_name text,
  phone text,
  whatsapp text,
  address text,
  city text,
  currency text NOT NULL DEFAULT 'FCFA',
  logo_url text,
  receipt_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX businesses_owner_idx ON public.businesses(owner_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own business" ON public.businesses FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.businesses WHERE owner_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.owns_business(_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = _business_id AND b.owner_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ CLIENTS ============
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  phone text,
  whatsapp text,
  gender text,
  birth_date date,
  address text,
  city text,
  notes text,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_business_idx ON public.clients(business_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant clients" ON public.clients FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));
CREATE TRIGGER clients_touch BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ MEASUREMENT TEMPLATES ============
CREATE TABLE public.measurement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  name text NOT NULL,
  fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX measurement_templates_business_idx ON public.measurement_templates(business_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_templates TO authenticated;
GRANT ALL ON public.measurement_templates TO service_role;
ALTER TABLE public.measurement_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant templates" ON public.measurement_templates FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));

-- ============ MEASUREMENT SETS + VALUES ============
CREATE TABLE public.measurement_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients ON DELETE CASCADE,
  label text,
  template_name text,
  notes text,
  recorded_at date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX measurement_sets_client_idx ON public.measurement_sets(client_id, recorded_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_sets TO authenticated;
GRANT ALL ON public.measurement_sets TO service_role;
ALTER TABLE public.measurement_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant measurement sets" ON public.measurement_sets FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));

CREATE TABLE public.measurement_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES public.measurement_sets ON DELETE CASCADE,
  name text NOT NULL,
  value numeric,
  unit text NOT NULL DEFAULT 'cm',
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX measurement_values_set_idx ON public.measurement_values(set_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_values TO authenticated;
GRANT ALL ON public.measurement_values TO service_role;
ALTER TABLE public.measurement_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant measurement values" ON public.measurement_values FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));

-- ============ GARMENT TYPES ============
CREATE TABLE public.garment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  name text NOT NULL,
  default_price numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX garment_types_business_idx ON public.garment_types(business_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.garment_types TO authenticated;
GRANT ALL ON public.garment_types TO service_role;
ALTER TABLE public.garment_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant garment types" ON public.garment_types FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));

-- ============ ORDERS ============
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients ON DELETE CASCADE,
  reference text NOT NULL DEFAULT '',
  garment_type text NOT NULL,
  fabric text,
  quantity integer NOT NULL DEFAULT 1,
  description text,
  price numeric NOT NULL DEFAULT 0,
  ordered_at date NOT NULL DEFAULT current_date,
  due_date date,
  status text NOT NULL DEFAULT 'nouvelle',
  notes text,
  delivered_at date,
  delivered_to text,
  delivery_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX orders_reference_idx ON public.orders(business_id, reference);
CREATE INDEX orders_business_status_idx ON public.orders(business_id, status);
CREATE INDEX orders_client_idx ON public.orders(client_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant orders" ON public.orders FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.validate_order_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('nouvelle','preparation','confection','finition','prete','livree','annulee') THEN
    RAISE EXCEPTION 'Statut de commande invalide: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER orders_validate_status BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.validate_order_status();

CREATE OR REPLACE FUNCTION public.set_order_reference()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE next_num integer; yr text;
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    yr := to_char(now(), 'YYYY');
    SELECT COALESCE(MAX(NULLIF(regexp_replace(o.reference, '^.*-', ''), '')::int), 0) + 1
      INTO next_num
      FROM public.orders o
      WHERE o.business_id = NEW.business_id AND o.reference LIKE 'CMD-' || yr || '-%';
    NEW.reference := 'CMD-' || yr || '-' || lpad(next_num::text, 5, '0');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER orders_set_reference BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_order_reference();

-- ============ ORDER IMAGES ============
CREATE TABLE public.order_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders ON DELETE CASCADE,
  path text NOT NULL,
  kind text NOT NULL DEFAULT 'modele',
  caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_images_order_idx ON public.order_images(order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_images TO authenticated;
GRANT ALL ON public.order_images TO service_role;
ALTER TABLE public.order_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant order images" ON public.order_images FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));

-- ============ PAYMENTS ============
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders ON DELETE CASCADE,
  amount numeric NOT NULL,
  method text NOT NULL DEFAULT 'especes',
  paid_at date NOT NULL DEFAULT current_date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON public.payments(order_id);
CREATE INDEX payments_business_idx ON public.payments(business_id, paid_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant payments" ON public.payments FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));

-- ============ APPOINTMENTS ============
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients ON DELETE SET NULL,
  scheduled_date date NOT NULL,
  scheduled_time time,
  type text NOT NULL DEFAULT 'essayage',
  notes text,
  status text NOT NULL DEFAULT 'prevu',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointments_business_date_idx ON public.appointments(business_id, scheduled_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant appointments" ON public.appointments FOR ALL TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));
CREATE TRIGGER appointments_touch BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ SIGNUP AUTOMATION ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'owner_name', NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO b_id FROM public.businesses WHERE owner_id = NEW.id;
  IF b_id IS NULL THEN
    INSERT INTO public.businesses (owner_id, name, owner_name, phone, whatsapp)
    VALUES (
      NEW.id,
      COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name', ''), 'Mon atelier'),
      NEW.raw_user_meta_data->>'owner_name',
      NEW.raw_user_meta_data->>'phone',
      NEW.raw_user_meta_data->>'phone'
    )
    RETURNING id INTO b_id;

    INSERT INTO public.measurement_templates (business_id, name, fields) VALUES
      (b_id, 'Homme', ARRAY['Tour de poitrine','Tour de taille','Tour de hanches','Carrure','Longueur épaule','Longueur dos','Longueur manche','Tour de bras','Tour de poignet','Longueur pantalon','Tour de cuisse','Tour de genou','Tour de cheville']),
      (b_id, 'Femme', ARRAY['Tour de poitrine','Sous-poitrine','Tour de taille','Tour de hanches','Carrure','Longueur épaule','Longueur dos','Longueur devant','Longueur manche','Tour de bras','Longueur robe','Longueur jupe','Tour de cuisse']),
      (b_id, 'Enfant', ARRAY['Tour de poitrine','Tour de taille','Tour de hanches','Longueur dos','Longueur manche','Longueur pantalon']);

    INSERT INTO public.garment_types (business_id, name)
    SELECT b_id, t FROM unnest(ARRAY['Boubou','Faso Dan Fani','Costume','Chemise','Pantalon','Robe','Jupe','Ensemble','Tenue traditionnelle','Uniforme','Autre']) AS t;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ STORAGE POLICIES ============
CREATE POLICY "atelier read own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'atelier' AND (storage.foldername(name))[1] = public.current_business_id()::text);
CREATE POLICY "atelier insert own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'atelier' AND (storage.foldername(name))[1] = public.current_business_id()::text);
CREATE POLICY "atelier update own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'atelier' AND (storage.foldername(name))[1] = public.current_business_id()::text);
CREATE POLICY "atelier delete own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'atelier' AND (storage.foldername(name))[1] = public.current_business_id()::text);