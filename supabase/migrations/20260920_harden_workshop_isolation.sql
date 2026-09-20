-- CouturPro: hard tenant isolation
-- Safe to run repeatedly. This migration does not delete or rewrite business data.

create or replace function public.enforce_workshop_relationships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_business_id uuid;
begin
  if tg_table_name = 'measurement_sets' then
    select c.business_id into parent_business_id from public.clients c where c.id = new.client_id;
  elsif tg_table_name = 'measurement_values' then
    select m.business_id into parent_business_id from public.measurement_sets m where m.id = new.set_id;
  elsif tg_table_name = 'orders' then
    select c.business_id into parent_business_id from public.clients c where c.id = new.client_id;
  elsif tg_table_name = 'payments' then
    select o.business_id into parent_business_id from public.orders o where o.id = new.order_id;
  elsif tg_table_name = 'order_images' then
    select o.business_id into parent_business_id from public.orders o where o.id = new.order_id;
  elsif tg_table_name = 'appointments' and new.client_id is not null then
    select c.business_id into parent_business_id from public.clients c where c.id = new.client_id;
  else
    return new;
  end if;

  if parent_business_id is null or parent_business_id is distinct from new.business_id then
    raise exception 'Les données liées doivent appartenir au même atelier';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_workshop_relationships() from public, anon, authenticated;

drop trigger if exists enforce_measurement_set_workshop on public.measurement_sets;
create trigger enforce_measurement_set_workshop
before insert or update of business_id, client_id on public.measurement_sets
for each row execute function public.enforce_workshop_relationships();

drop trigger if exists enforce_measurement_value_workshop on public.measurement_values;
create trigger enforce_measurement_value_workshop
before insert or update of business_id, set_id on public.measurement_values
for each row execute function public.enforce_workshop_relationships();

drop trigger if exists enforce_order_workshop on public.orders;
create trigger enforce_order_workshop
before insert or update of business_id, client_id on public.orders
for each row execute function public.enforce_workshop_relationships();

drop trigger if exists enforce_payment_workshop on public.payments;
create trigger enforce_payment_workshop
before insert or update of business_id, order_id on public.payments
for each row execute function public.enforce_workshop_relationships();

drop trigger if exists enforce_order_image_workshop on public.order_images;
create trigger enforce_order_image_workshop
before insert or update of business_id, order_id on public.order_images
for each row execute function public.enforce_workshop_relationships();

drop trigger if exists enforce_appointment_workshop on public.appointments;
create trigger enforce_appointment_workshop
before insert or update of business_id, client_id on public.appointments
for each row execute function public.enforce_workshop_relationships();

-- Replace broad FOR ALL tenant policies with explicit policies. Existing policy names
-- are removed first so old permissive combinations cannot remain active.
do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'clients','measurement_templates','measurement_sets','measurement_values',
    'garment_types','orders','order_images','payments','appointments',
    'catalog_models','payment_transactions'
  ] loop
    for policy_name in
      select policyname from pg_policies where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    end loop;
  end loop;
end $$;

-- Every operation is isolated independently. Admin access is retained through the
-- existing SECURITY DEFINER public.is_admin() helper.
do $$
declare
  table_name text;
  predicate text;
begin
  foreach table_name in array array[
    'clients','measurement_templates','measurement_sets','measurement_values',
    'garment_types','orders','order_images','payments','appointments',
    'catalog_models','payment_transactions'
  ] loop
    predicate := format('(public.owns_business(business_id) or public.is_admin())');

    execute format('create policy %I on public.%I for select to authenticated using (%s)', table_name || '_tenant_select', table_name, predicate);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', table_name || '_tenant_insert', table_name, predicate);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', table_name || '_tenant_update', table_name, predicate, predicate);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', table_name || '_tenant_delete', table_name, predicate);
  end loop;
end $$;

-- Ensure the client role can reach only the operations covered above.
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.measurement_templates to authenticated;
grant select, insert, update, delete on public.measurement_sets to authenticated;
grant select, insert, update, delete on public.measurement_values to authenticated;
grant select, insert, update, delete on public.garment_types to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_images to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.catalog_models to authenticated;
grant select, insert, update on public.payment_transactions to authenticated;

notify pgrst, 'reload schema';

-- Verification query to run after applying this migration:
-- select tablename, policyname, cmd from pg_policies
-- where schemaname = 'public'
-- and tablename in ('clients','orders','appointments','measurement_sets','measurement_values','payments','order_images')
-- order by tablename, cmd;
