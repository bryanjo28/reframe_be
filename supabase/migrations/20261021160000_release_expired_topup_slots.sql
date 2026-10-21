begin;

-- Keep expired orders pending for provider verification, but allow a new payable
-- topup. A missing provider expiry reserves the slot for retry/recovery.
create or replace function public.guard_pending_topup_order()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.order_type is distinct from 'topup' or new.status is distinct from 'pending'
    or new.provider_expires_at<=now() then return new; end if;
  if tg_op='UPDATE' then
    if old.user_id=new.user_id and old.order_type='topup' and old.status='pending'
      and (old.provider_expires_at is null or old.provider_expires_at>now()) then return new; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
  if exists(select 1 from payment_orders where user_id=new.user_id
    and order_type='topup' and status='pending' and id<>new.id
    and (provider_expires_at is null or provider_expires_at>now())) then
    raise exception 'pending_topup_order_unique' using errcode='23505', constraint='pending_topup_order_unique';
  end if;
  return new;
end $$;
revoke all on function public.guard_pending_topup_order() from public,anon,authenticated;
drop trigger if exists guard_pending_topup_order on public.payment_orders;
create trigger guard_pending_topup_order before insert or update of user_id,order_type,status,provider_expires_at
  on public.payment_orders for each row execute function public.guard_pending_topup_order();

commit;
