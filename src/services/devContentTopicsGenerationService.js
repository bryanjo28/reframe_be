const devContentPillarStore = require("../store/devContentPillarStore");
const devPersonaStore = require("../store/devPersonaStore");

const blueprints = [
  { category_type: "educational", title: (focus) => `5 hal tentang ${focus} yang wajib dipahami creator sebelum mulai` },
  { category_type: "myth_busting", title: (focus) => `Mitos ${focus} yang masih dipercaya banyak orang—padahal keliru` },
  { category_type: "tutorial", title: (focus) => `Cara mulai memakai ${focus} dalam 15 menit, tanpa workflow yang rumit` },
  { category_type: "opinion", title: (focus) => `Pendapat yang mungkin tidak populer: ${focus} bukan solusi untuk semua hal` },
  { category_type: "checklist", title: (focus) => `Checklist sebelum kamu menerapkan ${focus} ke workflow konten` },
  { category_type: "storytelling", title: (focus) => `Apa yang berubah setelah creator memakai ${focus} secara konsisten` },
  { category_type: "soft_selling", title: (focus) => `Kenapa strategi ${focus} yang tepat bisa menghemat waktu setiap minggu` },
  { category_type: "educational", title: (focus) => `Kesalahan pemula saat belajar ${focus} dan cara menghindarinya` },
  { category_type: "tutorial", title: (focus) => `Framework sederhana untuk mengubah ${focus} menjadi konten bernilai` },
  { category_type: "opinion", title: (focus) => `Tren ${focus} terbaru: mana yang layak dicoba dan mana yang cuma hype` },
];

function generateContentTopics({ userId, payload }) {
  const pillar = devContentPillarStore.get(userId, payload.contentPillarId);
  if (!pillar) {
    const error = new Error("Content pillar tidak ditemukan. Muat ulang halaman lalu pilih pillar lagi.");
    error.status = 404;
    throw error;
  }

  const persona = devPersonaStore.get(userId, pillar.personaConfigId);
  const focus = pillar.pillarName || pillar.name || persona?.nicheTopicFocus || "topik pilihanmu";
  const audience = pillar.audienceSegment || persona?.targetAudience || "audiensmu";
  const count = Math.min(10, Math.max(1, Number(payload.jumlahTopics) || 5));
  const topics = blueprints.slice(0, count).map((blueprint) => ({
    title: blueprint.title(focus),
    category_type: blueprint.category_type,
    angle: pillar.keyMessage || `Sudut pandang praktis untuk ${audience}`,
    audience_pain: `${audience} butuh penjelasan yang sederhana dan bisa langsung diterapkan.`,
    why_it_works: "Spesifik, relevan, dan memberi manfaat yang jelas sejak judul.",
  }));

  return {
    success: true,
    parsed_content: { topics },
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    request: {
      contentPillarId: payload.contentPillarId,
      templateId: payload.templateId || null,
      jumlahTopics: count,
    },
  };
}

module.exports = { generateContentTopics };
