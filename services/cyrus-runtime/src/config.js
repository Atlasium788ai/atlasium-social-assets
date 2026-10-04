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

function jsonObject(value, name) {
  if (!value?.trim()) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${name} must be valid JSON`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name} must be a JSON object`);
  return Object.fromEntries(Object.entries(parsed).map(([key, url]) => [key, String(url).replace(/\/$/, "")]));
}

export function loadConfig(env = process.env) {
  const role = (env.BOT_ROLE?.trim() || "cyrus").toLowerCase();
  const identities = { cyrus: "Cyrus", malik: "Malik" };
  if (!identities[role]) throw new Error(`Unsupported BOT_ROLE: ${role}`);
  const name = env.BOT_NAME?.trim() || identities[role];
  const dataDir = env.BOT_DATA_DIR?.trim() || env.CYRUS_DATA_DIR?.trim() || path.resolve(`.data/${role}`);
  return {
    role,
    name,
    serviceName: `${role}-runtime`,
    port: Number(env.PORT || 3000),
    internalPort: Number(env.INTERNAL_PORT || 3001),
    dataDir,
    databasePath: path.join(dataDir, `${role}.sqlite`),
    slackAppToken: required(env, "SLACK_APP_TOKEN"),
    slackBotToken: required(env, "SLACK_BOT_TOKEN"),
    blairSlackUserId: required(env, "BLAIR_SLACK_USER_ID"),
    slackAllowedChannelIds: csv(env.SLACK_ALLOWED_CHANNEL_IDS),
    slackSocketEnabled: bool(env.BOT_SOCKET_ENABLED ?? env.CYRUS_SOCKET_ENABLED, true),
    slackDmPollMs: Math.max(10_000, Number(env.SLACK_DM_POLL_MS || 15_000)),
    openAiApiKey: required(env, "OPENAI_API_KEY"),
    openAiModel: env.OPENAI_MODEL?.trim() || "gpt-6-luna",
    openAiBaseUrl: env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
    httpReadAllowlist: new Set([
      ...csv(env.HTTP_READ_ALLOWLIST),
      "https://linklatch.atlasium788.ca",
    ]),
    agentPeers: jsonObject(env.AGENT_PEERS_JSON, "AGENT_PEERS_JSON"),
    followupPollMs: Math.max(5_000, Number(env.FOLLOWUP_POLL_MS || 15_000)),
    proactiveEnabled: bool(env.PROACTIVE_MONITORING_ENABLED, false),
    relentlessIntervalMs: Math.max(120_000, Number(env.CYRUS_RELENTLESS_INTERVAL_MS || 300_000)),
    instantlyApiKey: env.INSTANTLY_API_KEY?.trim() || "",
    instantlyBaseUrl: env.INSTANTLY_BASE_URL?.trim() || "https://api.instantly.ai/api/v2",
    instantlyCampaignId: env.INSTANTLY_CAMPAIGN_ID?.trim() || "",
    reeviqBaseUrl: env.REEVIQ_BASE_URL?.trim()?.replace(/\/$/, "") || "",
    reeviqApiKeys: [env.REEVIQ_API_KEY?.trim() || "", env.REEVIQ_WRITE_API_KEY?.trim() || ""].filter((value, index, values) => value && values.indexOf(value) === index),
    reeviqBaseUrl: env.REEVIQ_BASE_URL?.trim() || "",
    reeviqApiKeys: [env.REEVIQ_API_KEY?.trim() || "", env.REEVIQ_WRITE_API_KEY?.trim() || ""].filter((value, index, all) => value && all.indexOf(value) === index),
    instantlyApiKey: env.INSTANTLY_API_KEY?.trim() || "",
    instantlyBaseUrl: env.INSTANTLY_BASE_URL?.trim() || "https://api.instantly.ai/api/v2",
    instantlyCampaignId: env.INSTANTLY_CAMPAIGN_ID?.trim() || "",
  };
}
