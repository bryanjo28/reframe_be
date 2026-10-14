const assert = require('node:assert/strict');
const inputSafety = require('../src/middlewares/inputSafetyMiddleware');

function check(body, path = '/content-topics', query = {}) {
  let result;
  inputSafety({ body, path, query }, {}, (error) => { result = error; });
  return result;
}

for (const path of ['/content-topics', '/content-pillars', '/persona-configs', '/content-outputs', '/prompt-templates', '/scheduled-jobs', '/auth/me']) {
  for (const value of ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<svg/onload=alert(1)>', '<iframe src="https://example.com">', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
    assert.equal(check({ config: { items: [{ text: value }] } }, path)?.code, 'UNSAFE_INPUT');
  }
}
assert.equal(check({}, '/content-topics', { search: '<img src=x>' })?.status, 400);
assert.equal(check({ topic: 'Harga < 100 dan > 20; React & TypeScript', content: 'Halo 👋\n**Konten** https://example.com' }), undefined);
assert.equal(check({ password: '<img src=x>' }, '/auth/login'), undefined);
assert.equal(check({ currentPassword: '<script>', newPassword: '<img src=x>', confirmPassword: '<img src=x>' }, '/auth/me/password'), undefined);
assert.equal(check({ password: '<img src=x>' }, '/content-topics')?.code, 'UNSAFE_INPUT');
assert.equal(check({ fullName: '<img src=x>', password: 'valid' }, '/auth/register')?.code, 'UNSAFE_INPUT');
console.log('ok - input safety covers nested API inputs, query strings, and preserves auth passwords');
