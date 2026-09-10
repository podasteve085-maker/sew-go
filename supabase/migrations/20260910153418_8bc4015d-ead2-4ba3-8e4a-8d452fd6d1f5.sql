REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_business(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_order_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_order_reference() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_business_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_business(uuid) TO authenticated;