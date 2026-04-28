const contentTopicsGenerateWebhookUrl =
  process.env.N8N_CONTENT_TOPICS_GENERATE_WEBHOOK_URL || "";

const contentTopicsGenerateWebhookSecret =
  process.env.N8N_CONTENT_TOPICS_GENERATE_WEBHOOK_SECRET || "";

const isContentTopicsGenerateDebugEnabled =
  String(process.env.N8N_CONTENT_TOPICS_GENERATE_DEBUG || "")
    .trim()
    .toLowerCase() === "true";

const isContentTopicsGenerateWebhookConfigured = Boolean(
  contentTopicsGenerateWebhookUrl
);

module.exports = {
  contentTopicsGenerateWebhookSecret,
  contentTopicsGenerateWebhookUrl,
  isContentTopicsGenerateDebugEnabled,
  isContentTopicsGenerateWebhookConfigured,
};
