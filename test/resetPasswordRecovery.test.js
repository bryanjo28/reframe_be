const assert = require('node:assert/strict');

// Isolated process: never contact the real Auth service or use real credentials.
process.env.SUPABASE_URL = 'https://recovery-test.invalid';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const config = require('../src/config/supabase');
const authService = require('../src/services/authService');

async function main() {
  let requestCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requestCount += 1;
    assert.equal(String(url), 'https://recovery-test.invalid/auth/v1/user');
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers.Authorization, 'Bearer recovery-test-token');
    assert.equal(options.headers.apikey, 'test-anon-key');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { password: 'new-test-password' });
    return new Response(JSON.stringify({ id: 'user-reset', email: 'reset@example.com' }), { status: 200 });
  };
  try {
    // Reproduce why the old bearer-only SDK path fails before making a request.
    const client = config.createSupabaseUserClient('recovery-test-token');
    const oldResult = await client.auth.updateUser({ password: 'new-test-password' });
    assert.equal(oldResult.error?.name, 'AuthSessionMissingError');
    assert.equal(requestCount, 0);

    const result = await authService.resetPassword({
      accessToken: 'recovery-test-token', newPassword: 'new-test-password', confirmPassword: 'new-test-password',
    });
    assert.equal(requestCount, 1);
    assert.equal(result.user.id, 'user-reset');
    console.log('ok - reproduces SDK session failure and resets with user bearer token without admin access');

    await assert.rejects(authService.resetPassword({
      newPassword: 'new-test-password', confirmPassword: 'new-test-password',
    }), { status: 401, code: 'INVALID_ACCESS_TOKEN' });
    assert.equal(requestCount, 1);

    global.fetch = async () => new Response(JSON.stringify({ code: 'same_password', msg: 'New password should be different from the old password.' }), { status: 422 });
    await assert.rejects(authService.resetPassword({
      accessToken: 'recovery-test-token', newPassword: 'new-test-password', confirmPassword: 'new-test-password',
    }), { status: 422, code: 'same_password' });
    console.log('ok - missing recovery tokens are rejected and provider validation errors retain their code');
  } finally { global.fetch = originalFetch; }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
