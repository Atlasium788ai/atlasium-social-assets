import test from "node:test";
import assert from "node:assert/strict";
import { ROLE_PROFILES, SPECIALIST_PLAYBOOKS } from "../src/role_profiles.js";
import { SWARM_DOCTRINE } from "../src/swarm_doctrine.js";
import { loadConfig } from "../src/config.js";
import { systemPrompt, CYRUS_SYSTEM_PROMPT, MALIK_SYSTEM_PROMPT } from "../src/personality.js";
import { createToolbox } from "../src/tools.js";

const ALL_ROLES = ["cyrus", "malik", "clara", "mateo", "kenji", "amara", "nadia", "sloane"];
const SPECIALISTS = ALL_ROLES.filter((role) => !["cyrus", "malik"].includes(role));

function envFor(role) {
  return {
    BOT_ROLE: role,
    BOT_DATA_DIR: `/data/${role}`,
    SLACK_APP_TOKEN: "test-app-token",
    SLACK_BOT_TOKEN: "test-bot-token",
    BLAIR_SLACK_USER_ID: "U_BLAIR",
    OPENAI_API_KEY: "test-openai-key",
  };
}

test("all eight intended roles use the same runtime with isolated identity and SQLite paths", () => {
  assert.deepEqual(Object.keys(ROLE_PROFILES), ALL_ROLES);
  const paths = new Set();
  for (const role of ALL_ROLES) {
    const cfg = loadConfig(envFor(role));
    assert.equal(cfg.role, role);
    assert.equal(cfg.name, ROLE_PROFILES[role].name);
    assert.equal(cfg.title, ROLE_PROFILES[role].title);
    assert.equal(cfg.department, ROLE_PROFILES[role].department);
    assert.equal(cfg.serviceName, `${role}-runtime`);
    assert.equal(cfg.dataDir, `/data/${role}`);
    assert.equal(cfg.databasePath, `/data/${role}/${role}.sqlite`);
    paths.add(cfg.databasePath);
    const prompt = systemPrompt(role);
    assert.match(prompt, new RegExp(cfg.name));
    assert.match(prompt, new RegExp(cfg.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(paths.size, ALL_ROLES.length);
});

test("proven Cyrus and Malik base personalities remain intact and inherit the swarm doctrine", () => {
  assert.equal(systemPrompt("cyrus"), `${CYRUS_SYSTEM_PROMPT}\n\n${SWARM_DOCTRINE}`);
  assert.equal(systemPrompt("malik"), `${MALIK_SYSTEM_PROMPT}\n\n${SWARM_DOCTRINE}`);
});

test("specialists have detailed department playbooks, drill cases, relentless tone and coordination", () => {
  assert.deepEqual(Object.keys(SPECIALIST_PLAYBOOKS).sort(), SPECIALISTS.slice().sort());
  for (const role of SPECIALISTS) {
    const plan = SPECIALIST_PLAYBOOKS[role];
    const prompt = systemPrompt(role);
    assert.ok(plan.own.length >= 6, `${role}: missing detailed responsibilities`);
    assert.ok(plan.cross.length >= 5, `${role}: missing cross-department links`);
    assert.ok(plan.measure.length >= 3, `${role}: missing success indicators`);
    assert.ok(plan.guard.length >= 2, `${role}: missing safety boundaries`);
    assert.ok(plan.drill.length > 100, `${role}: no meaningful practical drill`);
    assert.match(prompt, /Cyrus is Chief of Staff and the orchestrator/);
    assert.match(prompt, /ruthless about prioritization and relentless about lawful, honest follow-through/);
    assert.match(prompt, /Handoff state/);
    assert.match(prompt, /Never report done, sent, fixed, deployed, paid, or verified without evidence/);
    assert.match(prompt, new RegExp(ROLE_PROFILES[role].department.replace(/[.*+?^${}()|[\]\\]/g, "\\test("specialist prompts define real department duties, Cyrus reporting, and evidence rules", () => {
  for (const role of SPECIALISTS) {
    const prompt = systemPrompt(role);
    assert.match(prompt, /Cyrus is the Chief of Staff/);
    assert.match(prompt, /Never report done, sent, fixed, deployed, paid, or verified without evidence/);
    assert.match(prompt, /role|department|operator/i);
  }
  assert.match(systemPrompt("sloane"), /Do not sign or accept contracts/);
  assert.match(systemPrompt("nadia"), /Do not move money/);
  assert.match(systemPrompt("kenji"), /Do not deploy/);
});")));
  }
  assert.match(systemPrompt("sloane"), /Do not sign or accept contracts/);
  assert.match(systemPrompt("nadia"), /Do not move money/);
  assert.match(systemPrompt("kenji"), /Do not deploy/);
});

test("unknown role fails closed rather than turning into Cyrus", () => {
  assert.throws(() => loadConfig(envFor("unknown")), /Unsupported BOT_ROLE/);
  assert.throws(() => systemPrompt("unknown"), /Unsupported specialist BOT_ROLE/);
});

test("specialists cannot invoke Malik-only tools even through a forged model call", async () => {
  for (const role of SPECIALISTS) {
    const config = loadConfig(envFor(role));
    const box = createToolbox({ config, store: {}, slackApi: async () => ({ ok: true }) });
    assert.equal(box.definitions.some((tool) => tool.name === "instantly_stage_lead"), false);
    assert.equal(box.definitions.some((tool) => tool.name === "reeviq_leads"), false);
    const result = await box.execute("instantly_stage_lead", { email: "someone@example.com", source_email_verified: true }, { taskId: "mock" });
    assert.equal(result.ok, false);
    assert.match(result.error, /restricted to Malik/);
  }
});

test("all swarm leaders follow a common verified-work and escalation protocol", () => {
  for (const role of ALL_ROLES) {
    const prompt = systemPrompt(role);
    for (const needle of [
      "SWARM HANDOFF PACKET",
      "RELENTLESS OPERATING LOOP",
      "Never hand off to yourself",
      "A handoff being accepted proves delivery of work, NOT completion",
      "Blair is CEO and approves executive exceptions",
      "No routine bot chatter",
    ]) {
      assert.ok(prompt.toLowerCase().includes(needle.toLowerCase()), `${role} missing ${needle}`);
    }
    assert.match(prompt, /Outreach -> Conversation -> Assessment -> Meeting -> Proposal -> Collected Cash/);
    assert.match(prompt, /One coordinated revenue-intelligence organization|one coordinated revenue-intelligence organization/);
  }
});

test("department prompts teach correct operational interdependence and no fabricated outcomes", () => {
  const drills = {
    clara: [/meeting/, /owner/, /evidence/],
    mateo: [/instantly/i, /malik/i, /do not claim emails sent/i],
    kenji: [/LinkLatch/, /first failed step/, /fix plan/],
    amara: [/payment/, /handoff/, /do not mark the customer live/],
    nadia: [/discount/, /economics/, /missing executive decision/],
    sloane: [/clawback/, /draft alternative clauses/, /jurisdiction/],
  };
  for (const [role, requirements] of Object.entries(drills)) {
    const drill = SPECIALIST_PLAYBOOKS[role].drill;
    for (const expression of requirements) assert.match(drill, expression, `${role} drill incomplete`);
  }
});
