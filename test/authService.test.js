const assert = require("node:assert/strict");

const authService = require("../src/services/authService");
const errorHandler = require("../src/middlewares/errorHandler");

function run(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function createSupabaseMock({ profileRow, socialAccountRow, personaConfigRow = null }) {
  return {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          if (table === "profiles" && column === "id") {
            query._profileUserId = value;
          }

          if (table === "social_accounts") {
            if (column === "user_id") {
              query._socialUserId = value;
            }

            if (column === "platform") {
              query._platform = value;
            }
          }

          if (table === "persona_configs" && column === "user_id") {
            query._personaUserId = value;
          }

          return query;
        },
        limit() {
          return query;
        },
        single: async () => {
          if (table === "profiles") {
            return { data: profileRow, error: null };
          }

          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (table === "profiles") {
            return { data: profileRow, error: null };
          }

          if (table === "social_accounts") {
            return { data: socialAccountRow, error: null };
          }

          if (table === "persona_configs") {
            return { data: personaConfigRow, error: null };
          }

          return { data: null, error: null };
        },
      };

      return query;
    },
  };
}

async function main() {
  await run("register masks a session returned for an unconfirmed user", async () => {
    const authClient = {
      auth: {
        async signUp() {
          return {
            data: {
              user: {
                id: "pending-register",
                email: "pending@example.com",
                email_confirmed_at: null,
              },
              session: {
                access_token: "must-not-leak",
                refresh_token: "must-not-leak",
              },
            },
            error: null,
          };
        },
      },
    };

    const result = await authService.register(
      {
        email: "pending@example.com",
        password: "password123",
        accountName: "pending-register",
      },
      {
        authClient,
        accountNameChecker: async () => {},
        freePlanLoader: async () => ({ id: "free-plan" }),
        subscriptionEnsurer: async () => {},
      }
    );

    assert.equal(result.emailConfirmationRequired, true);
    assert.equal(result.session, null);
    assert.equal(result.profile, null);
  });

  await run("login maps Supabase email_not_confirmed without loading profile", async () => {
    let profileLoaded = false;
    const authClient = {
      auth: {
        async signInWithPassword() {
          return {
            data: { user: null, session: null },
            error: {
              code: "email_not_confirmed",
              message: "Email not confirmed",
              status: 400,
            },
          };
        },
      },
    };

    await assert.rejects(
      authService.login(
        { email: "pending@example.com", password: "password123" },
        {
          authClient,
          profileLoader: async () => {
            profileLoaded = true;
          },
        }
      ),
      { status: 403, code: "EMAIL_NOT_VERIFIED" }
    );
    assert.equal(profileLoaded, false);
  });

  await run("buildRegistrationResponse hides session until email is confirmed", async () => {
    const result = authService.buildRegistrationResponse({
      user: {
        id: "pending-user",
        email: "pending@example.com",
        email_confirmed_at: null,
      },
      session: {
        access_token: "must-not-leak",
        refresh_token: "must-not-leak",
      },
      profile: { id: "pending-user" },
    });

    assert.equal(result.emailConfirmationRequired, true);
    assert.equal(result.session, null);
    assert.equal(result.profile, null);
  });

  await run("assertEmailConfirmed rejects an unverified user with a stable code", async () => {
    assert.throws(
      () => authService.assertEmailConfirmed({ email_confirmed_at: null }),
      {
        status: 403,
        code: "EMAIL_NOT_VERIFIED",
        message: "Email belum diverifikasi",
      }
    );
  });

  await run("assertAccountNameAvailable rejects an existing account name with a stable conflict code", async () => {
    const adminClient = {
      from(table) {
        assert.equal(table, "profiles");
        const query = {
          select() {
            return query;
          },
          eq(column, value) {
            assert.equal(column, "account_name");
            assert.equal(value, "existing-name");
            return query;
          },
          async maybeSingle() {
            return { data: { id: "existing-user" }, error: null };
          },
        };
        return query;
      },
    };

    await assert.rejects(
      authService.assertAccountNameAvailable("existing-name", adminClient),
      {
        message: "Account name is already registered",
        status: 409,
        code: "ACCOUNT_NAME_ALREADY_EXISTS",
      }
    );
  });

  await run("createRegistrationError maps duplicate email errors to a stable conflict response", async () => {
    const error = authService.createRegistrationError({
      message: "User already registered",
      code: "user_already_exists",
      status: 422,
    });

    assert.equal(error.status, 409);
    assert.equal(error.code, "EMAIL_ALREADY_EXISTS");
    assert.equal(error.message, "Email is already registered");

    const alternateError = authService.createRegistrationError({
      message: "Email address already exists",
      code: "email_exists",
      status: 422,
    });
    assert.equal(alternateError.status, 409);
    assert.equal(alternateError.code, "EMAIL_ALREADY_EXISTS");
  });

  await run("createRegistrationError preserves a valid upstream status", async () => {
    const error = authService.createRegistrationError({
      message: "Too many requests",
      code: "over_request_rate_limit",
      status: 429,
    });

    assert.equal(error.status, 429);
    assert.equal(error.code, "REGISTRATION_FAILED");
  });

  await run("resolveRegistrationError translates a signup race into an account-name conflict", async () => {
    const adminClient = {
      from() {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          async maybeSingle() {
            return { data: { id: "race-winner" }, error: null };
          },
        };
        return query;
      },
    };

    await assert.rejects(
      authService.resolveRegistrationError(
        {
          message: "Database error saving new user",
          status: 500,
          code: "unexpected_failure",
        },
        "same-name",
        adminClient
      ),
      {
        status: 409,
        code: "ACCOUNT_NAME_ALREADY_EXISTS",
      }
    );
  });

  await run("resolveRegistrationError does not overwrite a duplicate-email error", async () => {
    let lookupCalled = false;
    const adminClient = {
      from() {
        lookupCalled = true;
        throw new Error("unexpected lookup");
      },
    };

    await assert.rejects(
      authService.resolveRegistrationError(
        { message: "User already registered", status: 422, code: "email_exists" },
        "unrelated-name",
        adminClient
      ),
      { status: 409, code: "EMAIL_ALREADY_EXISTS" }
    );
    assert.equal(lookupCalled, false);
  });

  await run("resolveRegistrationError preserves rate limits without checking account name", async () => {
    let lookupCalled = false;
    const adminClient = {
      from() {
        lookupCalled = true;
        throw new Error("unexpected lookup");
      },
    };

    await assert.rejects(
      authService.resolveRegistrationError(
        { message: "Too many requests", status: 429, code: "over_request_rate_limit" },
        "unrelated-name",
        adminClient
      ),
      { status: 429, code: "REGISTRATION_FAILED" }
    );
    assert.equal(lookupCalled, false);
  });

  await run("errorHandler exposes a stable application error code", async () => {
    let statusCode = null;
    let responseBody = null;
    const response = {
      status(value) {
        statusCode = value;
        return response;
      },
      json(value) {
        responseBody = value;
      },
    };

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      errorHandler(
        Object.assign(new Error("Account name is already registered"), {
          status: 409,
          code: "ACCOUNT_NAME_ALREADY_EXISTS",
        }),
        {},
        response,
        () => {}
      );
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(statusCode, 409);
    assert.equal(responseBody.code, "ACCOUNT_NAME_ALREADY_EXISTS");
    assert.equal(responseBody.message, "Account name is already registered");
  });

  await run("requestPasswordReset sends a recovery email to the configured frontend page", async () => {
    let receivedEmail = null;
    let receivedOptions = null;
    const authClient = {
      auth: {
        async resetPasswordForEmail(email, options) {
          receivedEmail = email;
          receivedOptions = options;
          return { data: {}, error: null };
        },
      },
    };

    const result = await authService.requestPasswordReset(
      { email: "  USER@example.com  ", redirectTo: "https://app.example.com/reset-password" },
      authClient
    );

    assert.equal(receivedEmail, "user@example.com");
    assert.deepEqual(receivedOptions, {
      redirectTo: "https://app.example.com/reset-password",
    });
    assert.deepEqual(result, { emailSent: true });
  });

  await run("resetPassword updates the authenticated Supabase user password", async () => {
    let receivedPayload = null;
    const userClient = {
      auth: {
        async updateUser(payload) {
          receivedPayload = payload;
          return {
            data: { user: { id: "user-reset", email: "reset@example.com" } },
            error: null,
          };
        },
      },
    };

    const result = await authService.resetPassword({
      supabase: userClient,
      newPassword: "new-password",
      confirmPassword: "new-password",
    });

    assert.deepEqual(receivedPayload, { password: "new-password" });
    assert.deepEqual(result, {
      user: { id: "user-reset", email: "reset@example.com" },
    });
  });

  await run("resetPassword rejects mismatched confirmation before updating Supabase", async () => {
    let updateCalled = false;
    const userClient = {
      auth: {
        async updateUser() {
          updateCalled = true;
          return { data: {}, error: null };
        },
      },
    };

    await assert.rejects(
      authService.resetPassword({
        supabase: userClient,
        newPassword: "new-password",
        confirmPassword: "different-password",
      }),
      { message: "newPassword and confirmPassword do not match", status: 400 }
    );
    assert.equal(updateCalled, false);
  });

  await run("getCurrentUserProfile includes threads social account status", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-1",
        account_name: "alpha",
        full_name: "Alpha User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: {
        access_token: "valid_access_token",
        username: "alpha_threads",
        platform_user_id: "threads_123",
        expires_at: "2099-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-1", email: "alpha@example.com" },
      supabase,
    });

    assert.equal(result.user.id, "user-1");
    assert.equal(result.profile.accountName, "alpha");
    assert.equal(result.onboarding.hasPersona, false);
    assert.equal(result.socialAccounts.threads.connected, true);
    assert.equal(result.socialAccounts.threads.needsReconnect, false);
    assert.equal(result.socialAccounts.threads.accountId, "alpha_threads");
    assert.equal(result.socialAccounts.threads.threadsId, "threads_123");
  });

  await run("getCurrentUserProfile reports an existing persona", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-persona",
        account_name: "persona-owner",
        full_name: "Persona Owner",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: null,
      personaConfigRow: { id: "persona-1" },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-persona", email: "persona@example.com" },
      supabase,
    });

    assert.equal(result.onboarding.hasPersona, true);
  });

  await run("getCurrentUserProfile marks threads connection missing when record absent", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-2",
        account_name: "beta",
        full_name: "Beta User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: null,
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-2", email: "beta@example.com" },
      supabase,
    });

    assert.equal(result.socialAccounts.threads.connected, false);
    assert.equal(result.socialAccounts.threads.accountId, null);
    assert.equal(result.socialAccounts.threads.threadsId, null);
  });

  await run("getCurrentUserProfile tolerates missing profile row", async () => {
    const supabase = createSupabaseMock({
      profileRow: null,
      socialAccountRow: {
        access_token: "valid_access_token",
        username: "missing_profile_threads",
        platform_user_id: "threads_000",
        expires_at: "2099-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-2b", email: "missing@example.com" },
      supabase,
    });

    assert.equal(result.profile, null);
    assert.equal(result.socialAccounts.threads.connected, true);
  });

  await run("getCurrentUserProfile marks threads connection needs reconnect when token expired", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-3",
        account_name: "gamma",
        full_name: "Gamma User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: {
        access_token: "expired_access_token",
        username: "gamma_threads",
        platform_user_id: "threads_456",
        expires_at: "2020-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-3", email: "gamma@example.com" },
      supabase,
    });

    assert.equal(result.socialAccounts.threads.connected, false);
    assert.equal(result.socialAccounts.threads.canUseToken, false);
    assert.equal(result.socialAccounts.threads.needsReconnect, true);
    assert.equal(result.socialAccounts.threads.status, "needs_reconnect");
  });

  await run("getCurrentUserProfile marks threads connection disconnected when expiry metadata is missing", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-4",
        account_name: "delta",
        full_name: "Delta User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: {
        access_token: "token_without_expiry",
        username: "delta_threads",
        platform_user_id: "threads_789",
        expires_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-4", email: "delta@example.com" },
      supabase,
    });

    assert.equal(result.socialAccounts.threads.connected, false);
    assert.equal(result.socialAccounts.threads.canUseToken, false);
    assert.equal(result.socialAccounts.threads.needsReconnect, true);
    assert.equal(result.socialAccounts.threads.reason, "Saved token has no expiry metadata.");
  });

  await run("getCurrentUserThreadsConnection returns threads status only", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-5",
        account_name: "echo",
        full_name: "Echo User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: {
        access_token: "valid_access_token",
        username: "echo_threads",
        platform_user_id: "threads_999",
        expires_at: "2099-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserThreadsConnection({
      user: { id: "user-5", email: "echo@example.com" },
      supabase,
    });

    assert.equal(result.connected, true);
    assert.equal(result.status, "connected");
    assert.equal(result.accountId, "echo_threads");
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
