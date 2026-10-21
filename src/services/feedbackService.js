const { isSupabaseAdminConfigured, supabaseAdmin } = require('../config/supabase');

function createFeedbackError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function getFeedbackDb() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    throw createFeedbackError('Feedback storage is not configured', 503, 'FEEDBACK_STORAGE_UNAVAILABLE');
  }
  return supabaseAdmin;
}

async function submitFeedback({ userId, email, name, message, pagePath }) {
  const db = getFeedbackDb();
  const { data, error } = await db
    .from('feedback_submissions')
    .insert({
      user_id: userId,
      user_email: email,
      user_name: name || null,
      message,
      page_path: pagePath || null,
    })
    .select('id, created_at')
    .single();

  if (error) {
    throw createFeedbackError('Feedback could not be saved', 503, 'FEEDBACK_SAVE_FAILED');
  }
  return { id: data.id, createdAt: data.created_at };
}

module.exports = { submitFeedback };
