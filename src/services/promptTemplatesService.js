const { isSupabaseConfigured } = require("../config/supabase");

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

function getSource(payload) {
  return payload && typeof payload === "object" ? payload : {};
}

function hasKey(source, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function readOptionalText(source, keys) {
  if (!hasKey(source, keys)) {
    return undefined;
  }

  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
  const value = source[matchedKey];

  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function readOptionalBoolean(source, keys) {
  if (!hasKey(source, keys)) {
    return undefined;
  }

  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
  const value = source[matchedKey];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return Boolean(value);
}

function readOptionalJson(source, keys) {
  if (!hasKey(source, keys)) {
    return undefined;
  }

  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
  const value = source[matchedKey];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (text.length === 0) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return null;
}

function normalizePromptTemplatePayload(payload = {}) {
  const source = getSource(payload);

  return {
    name: readOptionalText(source, ["name"]),
    template: readOptionalText(source, ["template"]),
    variables: readOptionalJson(source, ["variables"]),
    isGlobal: readOptionalBoolean(source, ["isGlobal", "is_global"]),
  };
}

function assertCreatePromptTemplatePayload(payload) {
  if (!payload.name || payload.name.length === 0) {
    throw createHttpError("Missing required field: name", 400);
  }

  if (!payload.template || payload.template.length === 0) {
    throw createHttpError("Missing required field: template", 400);
  }
}

function mapPromptTemplateRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    template: row.template,
    variables: row.variables,
    isGlobal: row.is_global,
    createdAt: row.created_at,
  };
}

function buildInsertPayload({ userId, input }) {
  const payload = {
    user_id: userId,
    name: input.name,
    template: input.template,
  };

  if (input.variables !== undefined) {
    payload.variables = input.variables;
  }

  if (input.isGlobal !== undefined) {
    payload.is_global = input.isGlobal;
  }

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {};

  if (input.name !== undefined) {
    payload.name = input.name;
  }

  if (input.template !== undefined) {
    payload.template = input.template;
  }

  if (input.variables !== undefined) {
    payload.variables = input.variables;
  }

  if (input.isGlobal !== undefined) {
    payload.is_global = input.isGlobal;
  }

  return payload;
}

async function listPromptTemplates({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("prompt_templates")
    .select("*")
    .or(`is_global.eq.true,user_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return (data || []).map(mapPromptTemplateRow);
}

async function getPromptTemplateById({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("prompt_templates")
    .select("*")
    .eq("id", id)
    .or(`is_global.eq.true,user_id.eq.${userId}`)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  if (!data) {
    throw createHttpError("Prompt template not found", 404);
  }

  return mapPromptTemplateRow(data);
}

async function createPromptTemplate({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizePromptTemplatePayload(payload);
  assertCreatePromptTemplatePayload(input);

  const insertPayload = buildInsertPayload({ userId, input });
  const { data, error } = await supabase
    .from("prompt_templates")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapPromptTemplateRow(data);
}

async function updatePromptTemplate({ supabase, userId, id, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizePromptTemplatePayload(payload);
  const updatePayload = buildUpdatePayload(input);

  if (Object.keys(updatePayload).length === 0) {
    throw createHttpError("No valid fields to update", 400);
  }

  const { data, error } = await supabase
    .from("prompt_templates")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Prompt template not found", 404);
  }

  return mapPromptTemplateRow(data);
}

async function deletePromptTemplate({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("prompt_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Prompt template not found", 404);
  }

  return mapPromptTemplateRow(data);
}

module.exports = {
  createPromptTemplate,
  deletePromptTemplate,
  getPromptTemplateById,
  listPromptTemplates,
  normalizePromptTemplatePayload,
  updatePromptTemplate,
};
