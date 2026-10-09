import path from "node:path";
import { loadConfig, loadSharedRoleConfigs, SHARED_EXECUTIVE_ROLES } from "../src/config.js";

const primary = loadConfig(process.env);
const configs = loadSharedRoleConfigs(process.env, primary);
const issues = [];
const configuredRoles = new Set(configs.map((item) => item.role));

if (primary.role !== "cyrus") issues.push("Shared executives must run in the existing Cyrus service");
for (const role of SHARED_EXECUTIVE_ROLES) {
  if (!configuredRoles.has(role)) issues.push(`Missing shared role: ${role}`);
  const prefix = role.toUpperCase();
  const app = Boolean(process.env[`${prefix}_SLACK_APP_TOKEN`]?.trim());
  const bot = Boolean(process.env[`${prefix}_SLACK_BOT_TOKEN`]?.trim());
  const expected = Boolean(process.env[`${prefix}_EXPECTED_SLACK_BOT_USER_ID`]?.trim());
  if (app !== bot) issues.push(`${role} has only one of its two Slack tokens`);
  if (app && !expected) issues.push(`${role} direct Slack is missing its expected bot user ID guard`);
}
if (new Set(configs.map((item) => item.databasePath)).size !== configs.length) issues.push("Shared roles do not have unique database paths");
if (configs.some((item) => !path.resolve(item.databasePath).startsWith(path.resolve(primary.dataDir)))) {
  issues.push("A shared database is outside Cyrus's persistent data directory");
}

const report = {
  ok: issues.length === 0,
  primary: { role: primary.role, serviceName: primary.serviceName, autonomyEnabled: primary.autonomyEnabled, proactiveEnabled: primary.proactiveEnabled },
  executives: configs.map((item) => ({
    role: item.role,
    name: item.name,
    title: item.title,
    department: item.department,
    mode: item.slackSocketEnabled ? "direct-slack" : "cyrus-mediated",
    databasePath: item.databasePath,
  })),
  issues,
};

console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exitCode = 1;
