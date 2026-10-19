// Pakasir v2 direct methods. Generic payment_link is intentionally excluded.
const PAYMENT_METHODS = Object.freeze([
  { code: 'qris', name: 'QRIS', minAmount: 500, maxAmount: 10000000 },
  { code: 'bri_va', name: 'BRI Virtual Account', minAmount: 10000, maxAmount: 50000000 },
  { code: 'bni_va', name: 'BNI Virtual Account', minAmount: 10000, maxAmount: 50000000 },
  { code: 'cimb_niaga_va', name: 'CIMB Niaga Virtual Account', minAmount: 10000, maxAmount: 50000000 },
  { code: 'danamon_va', name: 'Danamon Virtual Account', minAmount: 10000, maxAmount: 50000000 },
  { code: 'maybank_va', name: 'Maybank Virtual Account', minAmount: 10000, maxAmount: 50000000 },
  { code: 'bnc_va', name: 'Bank Neo Commerce Virtual Account', minAmount: 10000, maxAmount: 50000000 },
  { code: 'bsi_va', name: 'BSI Virtual Account', minAmount: 10000, maxAmount: 50000000 },
  { code: 'muamalat_va', name: 'Muamalat Virtual Account', minAmount: 10000, maxAmount: 50000000 },
  { code: 'ocbc_va', name: 'OCBC Virtual Account', minAmount: 10000, maxAmount: 50000000 },
].map(Object.freeze));

function getPaymentMethod(code = 'qris') {
  const method = PAYMENT_METHODS.find(item => item.code === code);
  if (!method) throw Object.assign(new Error('Metode pembayaran tidak didukung.'), { status: 400, code: 'INVALID_PAYMENT_METHOD' });
  return method;
}

module.exports = { PAYMENT_METHODS, getPaymentMethod };
