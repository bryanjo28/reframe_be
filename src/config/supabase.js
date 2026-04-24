const { createClient } = require("@supabase/supabase-js");

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

module.exports = {
  createSupabaseUserClient,
  getUserFromToken,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
  supabase,
  supabaseAdmin,
  supabaseUrl,
};