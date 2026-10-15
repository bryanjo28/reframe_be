require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

async function findAuthUserByEmail(admin, email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Unable to inspect Alurin Auth users.");
    const match = (data?.users || []).find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if ((data?.users || []).length < 1000) return null;
  }
  throw new Error("Auth user scan exceeded its safety limit.");
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = String(process.env.ALURIN_ADMIN_EMAIL || "").trim().toLowerCase();

  if (!url || !serviceKey || !email) {
    throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ALURIN_ADMIN_EMAIL in the backend environment.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ALURIN_ADMIN_EMAIL must be a valid email address.");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const user = await findAuthUserByEmail(admin, email);
  if (!user) throw new Error("Target email is not registered in the existing Alurin authentication system.");
  if (!user.email_confirmed_at) throw new Error("Target Alurin account must verify its email before receiving admin access.");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile) throw new Error("Target Alurin profile is missing or unavailable.");
  if (profile.role === "admin") {
    console.log(`Admin access is already enabled for ${email}.`);
    return;
  }

  const { error } = await admin.rpc("grant_admin_role", {
    p_user_id: user.id,
    p_reason: "Administrator access granted at the user's explicit request.",
  });
  if (error) throw new Error(`Admin provisioning failed: ${error.message}`);

  console.log(`Admin access provisioned for ${email}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
