require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = String(process.env.SUPABASE_BOOTSTRAP_ADMIN_USER_ID || "").trim();

  if (!url || !serviceKey || !userId) {
    throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_BOOTSTRAP_ADMIN_USER_ID in the backend environment.");
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("SUPABASE_BOOTSTRAP_ADMIN_USER_ID must be a valid user UUID.");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !userResult?.user) {
    throw new Error("Target user was not found in the existing Alurin authentication system.");
  }

  const { error } = await admin.rpc("bootstrap_first_admin", { p_user_id: userId });
  if (error) {
    throw new Error(`First-admin bootstrap failed: ${error.message}`);
  }

  console.log(`First Alurin administrator provisioned for user ID ${userId}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
