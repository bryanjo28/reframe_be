function createRepositoryError(message, details) {
  const error = new Error(message);
  error.status = 500;
  error.code = "THREADS_CREDENTIALS_ERROR";
  if (details) error.details = details;
  return error;
}

function requireAdminClient(supabase) {
  if (!supabase) {
    const error = new Error("Threads credential storage is not configured");
    error.status = 500;
    error.code = "THREADS_CREDENTIALS_UNAVAILABLE";
    throw error;
  }
  return supabase;
}

async function getBySocialAccountId({ supabase, socialAccountId }) {
  const client = requireAdminClient(supabase);
  const { data, error } = await client
    .from("social_account_credentials")
    .select("access_token, refresh_token")
    .eq("social_account_id", socialAccountId)
    .maybeSingle();

  if (error) throw createRepositoryError("Failed to load Threads credentials", error);
  if (!data) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function upsert({ supabase, socialAccountId, accessToken, refreshToken = null }) {
  const client = requireAdminClient(supabase);
  const { data, error } = await client
    .from("social_account_credentials")
    .upsert({
      social_account_id: socialAccountId,
      access_token: accessToken,
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
    }, { onConflict: "social_account_id" })
    .select("social_account_id")
    .single();

  if (error) throw createRepositoryError("Failed to save Threads credentials", error);
  return data;
}

async function deleteBySocialAccountId({ supabase, socialAccountId }) {
  const client = requireAdminClient(supabase);
  const { error } = await client
    .from("social_account_credentials")
    .delete()
    .eq("social_account_id", socialAccountId);

  if (error) throw createRepositoryError("Failed to delete Threads credentials", error);
}

module.exports = { deleteBySocialAccountId, getBySocialAccountId, upsert };
