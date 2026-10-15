const { createClient } = require("@supabase/supabase-js");
const { withRequestTimeout } = require("../utils/requestTimeout");

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// flags
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
const isSupabaseAdminConfigured = Boolean(
  supabaseUrl && supabaseServiceRoleKey
);

// ==============================
// DEFAULT CLIENT (ANON)
// ==============================
const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

function createSupabaseAuthClient() {
  if (!isSupabaseConfigured) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

// ==============================
// ADMIN CLIENT (BYPASS RLS)
// ==============================
const supabaseAdmin = isSupabaseAdminConfigured
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

// ==============================
// USER CLIENT (IMPORTANT 🔥)
// ==============================
// Ini yang akan enforce RLS berdasarkan user login
function createSupabaseUserClient(accessToken) {
  if (!isSupabaseConfigured || !accessToken) {
    throw new Error("Supabase user client tidak bisa dibuat");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ==============================
// HELPER: VERIFY TOKEN
// ==============================
async function getUserFromToken(accessToken) {
  if (!supabase || !accessToken) return null;

  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

// updateUser() requires an SDK-managed session, which a bearer-only server
// client does not have. Forward the verified user token without admin privileges.
async function updatePasswordWithAccessToken(accessToken, password) {
  if (!isSupabaseConfigured || !accessToken) {
    throw Object.assign(new Error("A valid recovery session is required"), { status: 401, code: "INVALID_ACCESS_TOKEN" });
  }
  return withRequestTimeout(async (signal) => {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      method: "PUT",
      signal,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { data: { user: null }, error: { message: data.msg || data.message || "Password update failed", code: data.code || data.error_code, status: response.status } };
    }
    return { data: { user: data.user || data }, error: null };
  });
}

module.exports = {
  updatePasswordWithAccessToken,
  createSupabaseAuthClient,
  createSupabaseUserClient,
  getUserFromToken,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
  supabase,
  supabaseAdmin,
  supabaseUrl,
};
