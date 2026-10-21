begin;

create index if not exists payment_pending_topup_user_idx
  on public.payment_orders(user_id) where status='pending' and order_type='topup';

-- Preserve existing orders; serialize new pending topups per user. The shared
-- user lock also coordinates with subscription settlement and its pending guard.
create or replace function public.guard_pending_topup_order()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.order_type is distinct from 'topup' or new.status is distinct from 'pending' then return new; end if;
  if tg_op='UPDATE' then
    if old.user_id=new.user_id and old.order_type='topup' and old.status='pending' then return new; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
  if exists(select 1 from payment_orders where user_id=new.user_id
    and order_type='topup' and status='pending' and id<>new.id) then
    raise exception 'pending_topup_order_unique' using errcode='23505', constraint='pending_topup_order_unique';
  end if;
  return new;
end $$;
revoke all on function public.guard_pending_topup_order() from public,anon,authenticated;
drop trigger if exists guard_pending_topup_order on public.payment_orders;
create trigger guard_pending_topup_order before insert or update of user_id,order_type,status
  on public.payment_orders for each row execute function public.guard_pending_topup_order();

commit;
