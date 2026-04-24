# Content Pillar Enhance

## Endpoint

- `POST /api/content-pillars/enhance`
- `POST /api/content-pillars/enhance/:id`

## Body JSON

```json
{
  "personaConfigId": "uuid-persona-config",
  "name": "Content Pillar Name",
  "templateContent": "Hook lalu value lalu CTA",
  "targetObjective": "Meningkatkan konversi",
  "audienceSegment": "Founder dan marketer",
  "keyMessage": "Konten harus singkat dan actionable",
  "ctaDirection": "Invite to reply or click",
  "affiliateLink": "https://example.com",
  "model": "gemini-2.5-flash-lite",
  "maxTokens": 350,
  "temperature": 0.5,
  "systemPrompt": "You are a helpful assistant that rewrites marketing strategy inputs into a polished, concise, and coherent Indonesian paragraph."
}
```

## Response

Endpoint ini akan mengembalikan:

- `contentPillar`
- `enhancementInput`
- `personaConfig`
- `aiEnhancedVersion`
- `model`
- `systemPrompt`

Hasil `aiEnhancedVersion` ini yang nanti bisa dipakai FE untuk tombol `Enhance with AI`, lalu disimpan lewat endpoint update content pillar yang sudah ada.
`enhancementInput` adalah payload yang sudah dinormalisasi dari FE, jadi bisa langsung dipakai untuk mapping state lokal sebelum user klik save/update.
Kalau pakai endpoint tanpa `:id`, `contentPillar` akan `null` karena record belum dibuat. Kalau pakai `:id`, backend akan validasi bahwa pillar tersebut milik user dan cocok dengan `personaConfigId` yang dikirim.
`personaConfig` di response berasal dari tabel `persona_configs` dan dipakai saat prompt disusun.

Kalau mau lihat isi prompt yang benar-benar dikirim ke model, set env:

```bash
CONTENT_PILLAR_ENHANCE_DEBUG=true
```
