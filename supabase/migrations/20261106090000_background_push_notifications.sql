-- Background reminders for orders and appointments.
-- This migration is additive: it does not alter or remove existing business data.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (endpoint ~ '^https://'),
  p256dh text NOT NULL,
  auth text NOT NULL,
  expiration_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_business_endpoint_key UNIQUE (business_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_business_idx
  ON public.push_subscriptions (business_id);

CREATE INDEX IF NOT EXISTS orders_due_reminders_idx
  ON public.orders (due_date)
  WHERE due_date IS NOT NULL AND status NOT IN ('livree', 'annulee');

CREATE INDEX IF NOT EXISTS appointments_due_reminders_idx
  ON public.appointments (scheduled_date)
  WHERE status = 'prevu';

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

CREATE POLICY "tenant push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE TABLE IF NOT EXISTS public.push_notification_deliveries (
  event_key text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('appointment', 'order')),
  resource_id uuid NOT NULL,
  due_date date NOT NULL,
  timing text NOT NULL CHECK (timing IN ('today', 'tomorrow')),
  status text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 8),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_notification_deliveries_updated_idx
  ON public.push_notification_deliveries (updated_at);

ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.push_notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.claim_push_notification(
  p_event_key text,
  p_business_id uuid,
  p_subscription_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_due_date date,
  p_timing text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean := false;
BEGIN
  INSERT INTO public.push_notification_deliveries (
    event_key,
    business_id,
    subscription_id,
    resource_type,
    resource_id,
    due_date,
    timing,
    status,
    attempts,
    created_at,
    updated_at
  )
  VALUES (
    p_event_key,
    p_business_id,
    p_subscription_id,
    p_resource_type,
    p_resource_id,
    p_due_date,
    p_timing,
    'sending',
    1,
    now(),
    now()
  )
  ON CONFLICT (event_key) DO UPDATE
  SET
    status = 'sending',
    attempts = public.push_notification_deliveries.attempts + 1,
    last_error = NULL,
    updated_at = now()
  WHERE public.push_notification_deliveries.status <> 'sent'
    AND public.push_notification_deliveries.attempts < 8
    AND (
      (
        public.push_notification_deliveries.status = 'failed'
        AND public.push_notification_deliveries.updated_at <= now() - interval '10 minutes'
      )
      OR (
        public.push_notification_deliveries.status = 'sending'
        AND public.push_notification_deliveries.updated_at <= now() - interval '15 minutes'
      )
    )
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_notification(text, uuid, uuid, text, uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_notification(text, uuid, uuid, text, uuid, date, text)
  TO service_role;
