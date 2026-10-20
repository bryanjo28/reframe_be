-- Apply before deploying the backend that persists/reloads QRIS and VA instructions.
-- Nullable columns preserve existing orders; old instructions are not backfilled.
alter table public.payment_orders
  add column if not exists payment_qr_string text,
  add column if not exists payment_va_number text;

comment on column public.payment_orders.payment_qr_string is
  'Validated QRIS payload from checkout; render only while the order is pending.';
comment on column public.payment_orders.payment_va_number is
  'Validated virtual account number from checkout; text preserves leading zeros.';
