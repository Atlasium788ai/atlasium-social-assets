import path from "node:path";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function csv(value = "") {
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function loadConfig(env = process.env) {
  const dataDir = env.CYRUS_DATA_DIR?.trim() || path.resolve(".data/cyrus");
  return {
    port: Number(env.PORT || 3000),
    dataDir,
    databasePath: path.join(dataDir, "cyrus.sqlite"),
    slackAppToken: required(env, "SLACK_APP_TOKEN"),
    slackBotToken: required(env, "SLACK_BOT_TOKEN"),
    blairSlackUserId: required(env, "BLAIR_SLACK_USER_ID"),
    slackAllowedChannelIds: csv(env.SLACK_ALLOWED_CHANNEL_IDS),
    slackSocketEnabled: bool(env.CYRUS_SOCKET_ENABLED, true),
    openAiApiKey: required(env, "OPENAI_API_KEY"),
    openAiModel: env.OPENAI_MODEL?.trim() || "gpt-6-luna",
    openAiBaseUrl: env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
    httpReadAllowlist: csv(env.HTTP_READ_ALLOWLIST),
  };
}
