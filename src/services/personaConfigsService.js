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

function normalizePersonaConfigPayload(payload = {}) {
  const source = getSource(payload);

  return {
    persona: readOptionalText(source, ["persona", "persona_name", "personaName"]),
    targetAudience: readOptionalText(source, ["targetAudience", "target_audience"]),
    nicheTopicFocus: readOptionalText(source, ["nicheTopicFocus", "niche_topic_focus"]),
    contentStyle: readOptionalText(source, ["contentStyle", "content_style"]),
    tone: readOptionalText(source, ["tone"]),
    goal: readOptionalText(source, ["goal"]),
    posisiPersonaSaatIni: readOptionalText(
      source,
      ["posisiPersonaSaatIni", "posisi_persona_saat_ini"]
    ),
    audienceMasalahUtama: readOptionalText(
      source,
      ["audienceMasalahUtama", "audience_masalah_utama"]
    ),
    apaYangMerekaRasakan: readOptionalText(
      source,
      ["apaYangMerekaRasakan", "apa_yang_mereka_rasakan"]
    ),
    kenapaHarusFollow: readOptionalText(source, ["kenapaHarusFollow", "kenapa_harus_follow"]),
    gayaKomunikasi: readOptionalText(source, ["gayaKomunikasi", "gaya_komunikasi"]),
    platform: readOptionalText(source, ["platform"]),
    formatOutput: readOptionalText(source, ["formatOutput", "format_output"]),
    gayaHook: readOptionalText(source, ["gayaHook", "gaya_hook"]),
    seberapaPersonal: readOptionalText(source, ["seberapaPersonal", "seberapa_personal"]),
    ctaStyle: readOptionalText(source, ["ctaStyle", "cta_style"]),
    isActive: readOptionalBoolean(source, ["isActive", "is_active"]),
    contentPillarPrioritas: readOptionalText(
      source,
      ["contentPillarPrioritas", "content_pillar_prioritas"]
    ),
    referensiGaya: readOptionalText(source, ["referensiGaya", "referensi_gaya"]),
    batasanKonten: readOptionalText(source, ["batasanKonten", "batasan_konten"]),
  };
}

function assertCreatePersonaConfigPayload(payload) {
  if (!payload.persona || payload.persona.length === 0) {
    throw createHttpError("Missing required field: persona", 400);
  }
}

function mapPersonaConfigRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    persona: row.persona,
    targetAudience: row.target_audience,
    nicheTopicFocus: row.niche_topic_focus,
    contentStyle: row.content_style,
    tone: row.tone,
    goal: row.goal,
    posisiPersonaSaatIni: row.posisi_persona_saat_ini,
    audienceMasalahUtama: row.audience_masalah_utama,
    apaYangMerekaRasakan: row.apa_yang_mereka_rasakan,
    kenapaHarusFollow: row.kenapa_harus_follow,
    gayaKomunikasi: row.gaya_komunikasi,
    platform: row.platform,
    formatOutput: row.format_output,
    gayaHook: row.gaya_hook,
    seberapaPersonal: row.seberapa_personal,
    ctaStyle: row.cta_style,
    isActive: row.is_active,
    contentPillarPrioritas: row.content_pillar_prioritas,
    referensiGaya: row.referensi_gaya,
    batasanKonten: row.batasan_konten,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildInsertPayload({ userId, input }) {
  const payload = { user_id: userId };

  if (input.persona !== undefined) payload.persona = input.persona;
  if (input.targetAudience !== undefined) payload.target_audience = input.targetAudience;
  if (input.nicheTopicFocus !== undefined) payload.niche_topic_focus = input.nicheTopicFocus;
  if (input.contentStyle !== undefined) payload.content_style = input.contentStyle;
  if (input.tone !== undefined) payload.tone = input.tone;
  if (input.goal !== undefined) payload.goal = input.goal;
  if (input.posisiPersonaSaatIni !== undefined) {
    payload.posisi_persona_saat_ini = input.posisiPersonaSaatIni;
  }
  if (input.audienceMasalahUtama !== undefined) {
    payload.audience_masalah_utama = input.audienceMasalahUtama;
  }
  if (input.apaYangMerekaRasakan !== undefined) {
    payload.apa_yang_mereka_rasakan = input.apaYangMerekaRasakan;
  }
  if (input.kenapaHarusFollow !== undefined) {
    payload.kenapa_harus_follow = input.kenapaHarusFollow;
  }
  if (input.gayaKomunikasi !== undefined) {
    payload.gaya_komunikasi = input.gayaKomunikasi;
  }
  if (input.platform !== undefined) payload.platform = input.platform;
  if (input.formatOutput !== undefined) payload.format_output = input.formatOutput;
  if (input.gayaHook !== undefined) payload.gaya_hook = input.gayaHook;
  if (input.seberapaPersonal !== undefined) payload.seberapa_personal = input.seberapaPersonal;
  if (input.ctaStyle !== undefined) payload.cta_style = input.ctaStyle;
  if (input.isActive !== undefined && input.isActive !== null) payload.is_active = input.isActive;
  if (input.contentPillarPrioritas !== undefined) {
    payload.content_pillar_prioritas = input.contentPillarPrioritas;
  }
  if (input.referensiGaya !== undefined) payload.referensi_gaya = input.referensiGaya;
  if (input.batasanKonten !== undefined) payload.batasan_konten = input.batasanKonten;

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {};

  if (input.persona !== undefined) payload.persona = input.persona;
  if (input.targetAudience !== undefined) payload.target_audience = input.targetAudience;
  if (input.nicheTopicFocus !== undefined) payload.niche_topic_focus = input.nicheTopicFocus;
  if (input.contentStyle !== undefined) payload.content_style = input.contentStyle;
  if (input.tone !== undefined) payload.tone = input.tone;
  if (input.goal !== undefined) payload.goal = input.goal;
  if (input.posisiPersonaSaatIni !== undefined) {
    payload.posisi_persona_saat_ini = input.posisiPersonaSaatIni;
  }
  if (input.audienceMasalahUtama !== undefined) {
    payload.audience_masalah_utama = input.audienceMasalahUtama;
  }
  if (input.apaYangMerekaRasakan !== undefined) {
    payload.apa_yang_mereka_rasakan = input.apaYangMerekaRasakan;
  }
  if (input.kenapaHarusFollow !== undefined) {
    payload.kenapa_harus_follow = input.kenapaHarusFollow;
  }
  if (input.gayaKomunikasi !== undefined) {
    payload.gaya_komunikasi = input.gayaKomunikasi;
  }
  if (input.platform !== undefined) payload.platform = input.platform;
  if (input.formatOutput !== undefined) payload.format_output = input.formatOutput;
  if (input.gayaHook !== undefined) payload.gaya_hook = input.gayaHook;
  if (input.seberapaPersonal !== undefined) payload.seberapa_personal = input.seberapaPersonal;
  if (input.ctaStyle !== undefined) payload.cta_style = input.ctaStyle;
  if (input.isActive !== undefined && input.isActive !== null) payload.is_active = input.isActive;
  if (input.contentPillarPrioritas !== undefined) {
    payload.content_pillar_prioritas = input.contentPillarPrioritas;
  }
  if (input.referensiGaya !== undefined) payload.referensi_gaya = input.referensiGaya;
  if (input.batasanKonten !== undefined) payload.batasan_konten = input.batasanKonten;

  return payload;
}

async function listPersonaConfigs({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return (data || []).map(mapPersonaConfigRow);
}

async function getPersonaConfigById({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  if (!data) {
    throw createHttpError("Persona config not found", 404);
  }

  return mapPersonaConfigRow(data);
}

async function createPersonaConfig({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizePersonaConfigPayload(payload);
  assertCreatePersonaConfigPayload(input);

  const insertPayload = buildInsertPayload({ userId, input });
  console.log("[persona-configs:create] insertPayload:", insertPayload);

  const { data: authData, error: authError } = await supabase.auth.getUser();
  console.log("[persona-configs:create] supabase.auth.getUser():", {
    userId: authData?.user?.id,
    error: authError?.message || null,
  });

  const { data, error } = await supabase
    .from("persona_configs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapPersonaConfigRow(data);
}

async function updatePersonaConfig({ supabase, userId, id, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizePersonaConfigPayload(payload);
  const updatePayload = buildUpdatePayload(input);

  if (Object.keys(updatePayload).length === 0) {
    throw createHttpError("No valid fields to update", 400);
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Persona config not found", 404);
  }

  return mapPersonaConfigRow(data);
}

async function deletePersonaConfig({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Persona config not found", 404);
  }

  return mapPersonaConfigRow(data);
}

module.exports = {
  createPersonaConfig,
  deletePersonaConfig,
  getPersonaConfigById,
  listPersonaConfigs,
  normalizePersonaConfigPayload,
  updatePersonaConfig,
};


