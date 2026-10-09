import test from "node:test";
import assert from "node:assert/strict";
import { ROLE_PROFILES, SPECIALIST_PLAYBOOKS } from "../src/role_profiles.js";
import { loadConfig } from "../src/config.js";
import { systemPrompt, CYRUS_SYSTEM_PROMPT, MALIK_SYSTEM_PROMPT } from "../src/personality.js";
import { SWARM_DOCTRINE } from "../src/swarm_doctrine.js";
import { createToolbox } from "../src/tools.js";
import { assertSlackBotIdentity } from "../src/slack.js";

const ALL_ROLES = ["cyrus", "malik", "clara", "mateo", "kenji", "amara", "nadia", "sloane"];
const SPECIALISTS = ALL_ROLES.filter((role) => !["cyrus", "malik"].includes(role));

function envFor(role) {
  return {
    BOT_ROLE: role,
    BOT_DATA_DIR: "/data/" + role,
    SLACK_APP_TOKEN: "test-app-token",
    SLACK_BOT_TOKEN: "test-bot-token",
    BLAIR_SLACK_USER_ID: "U_BLAIR",
    OPENAI_API_KEY: "test-openai-key",
  };
}

test("all eight roles share the proven runtime with separate identities and SQLite paths", () => {
  assert.deepEqual(Object.keys(ROLE_PROFILES), ALL_ROLES);
  const paths = new Set();
  for (const role of ALL_ROLES) {
    const cfg = loadConfig(envFor(role));
    assert.equal(cfg.role, role);
    assert.equal(cfg.name, ROLE_PROFILES[role].name);
    assert.equal(cfg.title, ROLE_PROFILES[role].title);
    assert.equal(cfg.department, ROLE_PROFILES[role].department);
    assert.equal(cfg.serviceName, role + "-runtime");
    assert.equal(cfg.dataDir, "/data/" + role);
    assert.equal(cfg.databasePath, "/data/" + role + "/" + role + ".sqlite");
    paths.add(cfg.databasePath);
    assert.ok(systemPrompt(role).includes(cfg.name));
    assert.ok(systemPrompt(role).includes(cfg.title));
  }
  assert.equal(paths.size, ALL_ROLES.length);
});

test("Command88 Clara is distinct from Viktor Clara and rejects wrong Slack identity", () => {
  const config = loadConfig(envFor("clara"));
  assert.equal(config.department, "Executive Operations");
  assert.equal(config.slackExpectedBotUserId, "U0C1DES05L5");
  assert.match(systemPrompt("clara"), /never invoke, impersonate, connect to, or reuse the old Viktor Clara/);
  assert.doesNotThrow(() => assertSlackBotIdentity({ user_id: "U0C1DES05L5" }, config));
  assert.throws(() => assertSlackBotIdentity({ user_id: "U_OLD_VIKTOR" }, config), /Slack bot identity mismatch for clara/);
  assert.throws(() => assertSlackBotIdentity({}, config), /Slack bot identity mismatch for clara/);
  const cyrus = loadConfig(envFor("cyrus"));
  assert.equal(cyrus.slackExpectedBotUserId, "");
  assert.doesNotThrow(() => assertSlackBotIdentity({}, cyrus));
});

test("Cyrus and Malik retain their original instructions, plus the shared doctrine", () => {
  assert.equal(systemPrompt("cyrus"), CYRUS_SYSTEM_PROMPT + "\n\n" + SWARM_DOCTRINE);
  assert.equal(systemPrompt("malik"), MALIK_SYSTEM_PROMPT + "\n\n" + SWARM_DOCTRINE);
});

test("all six department leaders have practical playbooks, cross-bot duties and strict boundaries", () => {
  assert.deepEqual(Object.keys(SPECIALIST_PLAYBOOKS).sort(), SPECIALISTS.slice().sort());
  for (const role of SPECIALISTS) {
    const plan = SPECIALIST_PLAYBOOKS[role];
    const prompt = systemPrompt(role);
    assert.ok(plan.own.length >= 6, role + ": responsibilities missing");
    assert.ok(plan.cross.length >= 5, role + ": no swarm handoffs");
    assert.ok(plan.measure.length >= 3, role + ": no success measures");
    assert.ok(plan.guard.length >= 2, role + ": boundaries missing");
    assert.ok(plan.drill.length > 100, role + ": no detailed practical drill");
    assert.ok(prompt.includes("Cyrus is Chief of Staff and the orchestrator"));
    assert.ok(prompt.includes("ruthless about prioritization and relentless about lawful, honest follow-through"));
    assert.ok(prompt.includes("Never report done, sent, fixed, deployed, paid, or verified without evidence"));
    assert.ok(prompt.includes(ROLE_PROFILES[role].department));
  }
  assert.match(systemPrompt("sloane"), /Do not sign or accept contracts/);
  assert.match(systemPrompt("nadia"), /Do not move money/);
  assert.match(systemPrompt("kenji"), /Do not deploy/);
});

test("unknown roles fail closed instead of defaulting to Cyrus", () => {
  assert.throws(() => loadConfig(envFor("unknown")), /Unsupported BOT_ROLE/);
  assert.throws(() => systemPrompt("unknown"), /Unsupported specialist BOT_ROLE/);
});

test("each role shares objective, handoff, evidence and escalation training", () => {
  for (const role of ALL_ROLES) {
    const prompt = systemPrompt(role).toLowerCase();
    for (const needle of [
      "swarm handoff packet",
      "relentless operating loop",
      "never hand off to yourself",
      "a handoff being accepted proves delivery of work, not completion",
      "blair is ceo and approves executive exceptions",
      "no routine bot chatter",
      "outreach -> conversation -> assessment -> meeting -> proposal -> collected cash",
      "one coordinated revenue-intelligence organization",
    ]) {
      assert.ok(prompt.includes(needle), role + " missing " + needle);
    }
  }
});

test("role-specific drills teach interdependent decisions, not imaginary outcomes", () => {
  const drills = {
    clara: [/meeting/, /owner/, /evidence/],
    mateo: [/instantly/i, /malik/i, /do not claim emails sent/i],
    kenji: [/LinkLatch/, /first failed step/, /fix plan/],
    amara: [/payment/, /handoff/, /do not mark the customer live/],
    nadia: [/discount/, /economics/, /missing executive decision/],
    sloane: [/clawback/, /draft alternative clauses/, /jurisdiction/],
  };
  for (const [role, requirements] of Object.entries(drills)) {
    for (const expression of requirements) {
      assert.match(SPECIALIST_PLAYBOOKS[role].drill, expression, role + " drill incomplete");
    }
  }
});

test("specialist runtimes neither advertise nor execute Malik-only revenue tools", async () => {
  for (const role of SPECIALISTS) {
    const config = loadConfig(envFor(role));
    const box = createToolbox({ config, store: {}, slackApi: async () => ({ ok: true }) });
    assert.equal(box.definitions.some((tool) => tool.name === "instantly_stage_lead"), false);
    assert.equal(box.definitions.some((tool) => tool.name === "reeviq_leads"), false);
    const result = await box.execute("instantly_stage_lead", { email: "person@example.com", source_email_verified: true }, { taskId: "test" });
    assert.equal(result.ok, false);
    assert.match(result.error, /restricted to Malik/);
  }
});
