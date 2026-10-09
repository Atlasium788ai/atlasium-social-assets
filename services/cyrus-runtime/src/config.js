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

export const BOT_PROFILES = Object.freeze({
  cyrus: { name: "Cyrus", title: "Chief of Staff", department: "Executive" },
  malik: { name: "Malik", title: "Head of Revenue", department: "Sales" },
  clara: { name: "Clara", title: "Executive Assistant", department: "Executive Operations" },
  mateo: { name: "Mateo", title: "Head of Marketing & Content", department: "Marketing" },
  kenji: { name: "Kenji", title: "Head of Product & Development", department: "Product & Development" },
  amara: { name: "Amara", title: "Head of Client Success, Onboarding & Delivery", department: "Client Success" },
  nadia: { name: "Nadia", title: "Head of Finance & Administration", department: "Finance" },
  sloane: { name: "Sloane", title: "Head of Legal, Compliance & People", department: "Legal, Compliance & People" },
});

export const SHARED_EXECUTIVE_ROLES = Object.freeze(["clara", "mateo", "kenji", "amara", "nadia", "sloane"]);

export function loadConfig(env = process.env) {
  const role = (env.BOT_ROLE?.trim() || "cyrus").toLowerCase();
  if (!BOT_PROFILES[role]) throw new Error(`Unsupported BOT_ROLE: ${role}`);
  const name = env.BOT_NAME?.trim() || BOT_PROFILES[role].name;
  const dataDir = env.BOT_DATA_DIR?.trim() || env.CYRUS_DATA_DIR?.trim() || path.resolve(`.data/${role}`);
  return {
    role,
    name,
    title: env.BOT_TITLE?.trim() || BOT_PROFILES[role].title,
    department: env.BOT_DEPARTMENT?.trim() || BOT_PROFILES[role].department,
    serviceName: `${role}-runtime`,
    port: Number(env.PORT || 3000),
    internalPort: Number(env.INTERNAL_PORT || 3001),
    dataDir,
    databasePath: path.join(dataDir, `${role}.sqlite`),
    slackAppToken: required(env, "SLACK_APP_TOKEN"),
    slackBotToken: required(env, "SLACK_BOT_TOKEN"),
    slackExpectedBotUserId: env.EXPECTED_SLACK_BOT_USER_ID?.trim() || "",
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
    autonomyEnabled: bool(env.CYRUS_AUTONOMY_ENABLED, false),
    proactiveEnabled: bool(env.PROACTIVE_MONITORING_ENABLED, false),
    relentlessIntervalMs: Math.max(120_000, Number(env.CYRUS_RELENTLESS_INTERVAL_MS || 300_000)),
    instantlyApiKey: env.INSTANTLY_API_KEY?.trim() || "",
    instantlyBaseUrl: env.INSTANTLY_BASE_URL?.trim() || "https://api.instantly.ai/api/v2",
    instantlyCampaignId: env.INSTANTLY_CAMPAIGN_ID?.trim() || "",
    reeviqBaseUrl: env.REEVIQ_BASE_URL?.trim()?.replace(/\/$/, "") || "",
    reeviqApiKeys: [env.REEVIQ_API_KEY?.trim() || "", env.REEVIQ_WRITE_API_KEY?.trim() || ""].filter((value, index, values) => value && values.indexOf(value) === index),
  };
}

export function loadSharedRoleConfigs(env, primaryConfig) {
  const requested = (env.SHARED_BOT_ROLES || "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(requested)];
  for (const role of unique) {
    if (!SHARED_EXECUTIVE_ROLES.includes(role)) throw new Error(`Unsupported shared BOT_ROLE: ${role}`);
  }
  const sharedRoot = env.SHARED_BOT_DATA_DIR?.trim() || path.join(primaryConfig.dataDir, "executives");
  return unique.map((role) => {
    const profile = BOT_PROFILES[role];
    const prefix = role.toUpperCase();
    const slackAppToken = env[`${prefix}_SLACK_APP_TOKEN`]?.trim() || "";
    const slackBotToken = env[`${prefix}_SLACK_BOT_TOKEN`]?.trim() || "";
    const directSlackConfigured = Boolean(slackAppToken && slackBotToken);
    const dataDir = path.join(sharedRoot, role);
    return {
      ...primaryConfig,
      role,
      name: profile.name,
      title: profile.title,
      department: profile.department,
      serviceName: primaryConfig.serviceName,
      dataDir,
      databasePath: path.join(dataDir, `${role}.sqlite`),
      slackAppToken,
      slackBotToken,
      slackExpectedBotUserId: env[`${prefix}_EXPECTED_SLACK_BOT_USER_ID`]?.trim() || "",
      slackSocketEnabled: directSlackConfigured && bool(env[`${prefix}_SLACK_SOCKET_ENABLED`], true),
      slackAllowedChannelIds: csv(env[`${prefix}_SLACK_ALLOWED_CHANNEL_IDS`] || ""),
      httpReadAllowlist: new Set([
        ...csv(env[`${prefix}_HTTP_READ_ALLOWLIST`] || ""),
        "https://linklatch.atlasium788.ca",
      ]),
      agentPeers: {},
      autonomyEnabled: false,
      proactiveEnabled: false,
      instantlyApiKey: "",
      instantlyCampaignId: "",
      reeviqBaseUrl: "",
      reeviqApiKeys: [],
      sharedRuntime: true,
    };
  });
}
