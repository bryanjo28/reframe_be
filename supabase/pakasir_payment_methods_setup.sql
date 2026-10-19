-- Run after pakasir_payments_setup.sql, including on databases where it was
-- already applied. Existing QRIS orders keep their original method on retry.
begin;
alter table public.payment_orders add column if not exists payment_method text not null default 'qris'
  check (payment_method in ('qris','bri_va','bni_va','cimb_niaga_va','danamon_va',
    'maybank_va','bnc_va','bsi_va','muamalat_va','ocbc_va'));
commit;
