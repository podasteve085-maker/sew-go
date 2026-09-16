-- Administration centrale : accès réservé aux comptes explicitement autorisés.
-- Cette migration est volontairement non exécutée automatiquement.

create schema if not exists private;

create or replace function private.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.businesses b
    where b.owner_id = (select auth.uid())
      and b.is_admin is true
  );
$$;

revoke all on function private.current_user_is_admin() from public;
grant execute on function private.current_user_is_admin() to authenticated;

-- Les policies existantes peuvent rester en place pour les propriétaires.
-- Ces policies ajoutent une autorisation explicite pour l'administration centrale.
drop policy if exists "admins_can_read_all_businesses" on public.businesses;
drop policy if exists "admins_can_update_all_businesses" on public.businesses;
create policy "admins_can_read_all_businesses"
on public.businesses for select
to authenticated
using ((select private.current_user_is_admin()) or owner_id = (select auth.uid()));

create policy "admins_can_update_all_businesses"
on public.businesses for update
to authenticated
using ((select private.current_user_is_admin()))
with check ((select private.current_user_is_admin()));

-- Les tables globales affichées dans /admin restent invisibles aux autres ateliers.
drop policy if exists "admins_can_read_all_clients" on public.clients;
create policy "admins_can_read_all_clients"
on public.clients for select
to authenticated
using ((select private.current_user_is_admin()));

drop policy if exists "admins_can_read_all_orders" on public.orders;
create policy "admins_can_read_all_orders"
on public.orders for select
to authenticated
using ((select private.current_user_is_admin()));

drop policy if exists "admins_can_read_all_payment_transactions" on public.payment_transactions;
create policy "admins_can_read_all_payment_transactions"
on public.payment_transactions for select
to authenticated
using ((select private.current_user_is_admin()));

-- Vérification manuelle après application : un utilisateur non admin ne doit
-- jamais voir le lien Administration ni obtenir de lignes via /admin.
