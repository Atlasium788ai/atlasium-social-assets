import assert from "node:assert/strict";
import test from "node:test";
import { proposalPreflight, rebalanceMilestones } from "../lib/proposal-preflight";
import type { OpportunityInput, ProposalDraft } from "../lib/types";

const opportunity: OpportunityInput = {
  externalKey: "~quality-test", title: "CRM lead routing and calendar integration",
  description: "Build a CRM workflow for lead routing and calendar booking.",
  budgetMin: 1_500, budgetMax: 2_000, budgetType: "fixed", currency: "USD",
  jobUrl: "https://www.upwork.com/jobs/~quality-test",
  requirements: ["CRM lead routing", "Calendar booking integration"],
  sourceSubject: "Upwork opportunity", sourceReceivedAt: "2026-10-24T12:00:00.000Z",
};

const proposal: ProposalDraft = {
  body: "I would map your CRM lead routing, connect the calendar booking integration, and verify the complete workflow with test leads before handoff. My proposed fixed price is $1,850 with delivery in 2–4 weeks.",
  questions: ["Which CRM and calendar tools are currently in place?"],
  bidAmount: 1_850, timeline: "2–4 weeks",
  milestones: [
    { name: "Plan", amount: 350, deliverable: "Confirmed workflow and acceptance criteria" },
    { name: "Delivery", amount: 1_500, deliverable: "Working integration, testing, and handoff" },
  ],
};

test("clean, grounded proposal passes the deterministic approval gate", () => {
  assert.deepEqual(proposalPreflight({ opportunity, proposal, proposalRules: { maxWords: 350 } }), { ok: true, issues: [] });
});

test("blocks objective commercial and writing failures even if an AI score were high", () => {
  const result = proposalPreflight({
    opportunity,
    proposal: {
      ...proposal,
      body: "I hope this message finds you well. We guarantee a flawless result that will double revenue.",
      questions: ["Tell me more"], bidAmount: 2_500, timeline: "TBD",
      milestones: [{ name: "Everything", amount: 2_000, deliverable: "Everything" }],
    },
    proposalRules: { maxWords: 350, bannedPhrases: ["I hope this message finds you well"] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /banned phrase/i.test(issue)));
  assert.ok(result.issues.some((issue) => /exceeds/i.test(issue)));
  assert.ok(result.issues.some((issue) => /milestone/i.test(issue)));
  assert.ok(result.issues.some((issue) => /timeline/i.test(issue)));
  assert.ok(result.issues.some((issue) => /client-specific question/i.test(issue)));
  assert.ok(result.issues.some((issue) => /actual scope/i.test(issue)));
  assert.ok(result.issues.some((issue) => /unrealistic/i.test(issue)));
});

test("client-requested proof must match Atlasium's approved proof library", () => {
  const proofOpportunity = { ...opportunity, description: opportunity.description + " Share a similar project you completed." };
  const unverified = { ...proposal, body: proposal.body + " We have delivered a similar HubSpot workflow." };
  assert.ok(proposalPreflight({ opportunity: proofOpportunity, proposal: unverified }).issues.some((issue) => /verified/i.test(issue)));
  assert.equal(proposalPreflight({
    opportunity: proofOpportunity, proposal: unverified,
    capabilityProfile: { proof: ["Delivered a similar HubSpot workflow for a verified Atlasium client"] },
  }).issues.some((issue) => /verified/i.test(issue)), false);
});

test("short-format and 30-day client instructions are enforced", () => {
  const instructed = {
    ...opportunity,
    description: "Start your proposal with 'READY'. Use 3 to 5 sentences and commit to delivery within 30 days. CRM lead routing and calendar booking are required.",
  };
  const bad = { ...proposal, body: "Wrong opening. CRM only.", timeline: "6 weeks" };
  const issues = proposalPreflight({ opportunity: instructed, proposal: bad }).issues;
  assert.ok(issues.some((issue) => /exact client-required words/i.test(issue)));
  assert.ok(issues.some((issue) => /3–5 sentence/i.test(issue)));
  assert.ok(issues.some((issue) => /30-day/i.test(issue)));
});

test("editing a bid rebalances milestones exactly and preserves their proportions", () => {
  const milestones = rebalanceMilestones(proposal.milestones, 2_000);
  assert.equal(milestones.reduce((sum, milestone) => sum + milestone.amount, 0), 2_000);
  assert.equal(milestones[0].amount, 378.38);
  assert.equal(milestones[1].amount, 1_621.62);
});

test("stress: repeated approval checks stay deterministic and never mutate the draft", () => {
  const original = JSON.stringify(proposal);
  for (let index = 0; index < 500; index++) {
    const result = proposalPreflight({ opportunity, proposal, proposalRules: { maxWords: 350 } });
    assert.equal(result.ok, true);
  }
  assert.equal(JSON.stringify(proposal), original);
});

test("blocks generic writing that lacks a practical client-specific plan", () => {
  const result = proposalPreflight({
    opportunity,
    proposal: {
      ...proposal,
      body: "Dear Hiring Manager, I am excited to apply. My proposed fixed price is $1,850 with delivery in 2 weeks.",
      questions: ["Can you tell me more?"],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /generic proposal opening/i.test(issue)));
  assert.ok(result.issues.some((issue) => /practical delivery approach/i.test(issue)));
  assert.ok(result.issues.some((issue) => /client-specific question/i.test(issue)));
});

test("blocks an hourly proposal above the client's stated maximum", () => {
  const hourlyOpportunity = { ...opportunity, budgetType: "hourly" as const, budgetMin: 75, budgetMax: 100 };
  const result = proposalPreflight({
    opportunity: hourlyOpportunity,
    proposal: {
      ...proposal,
      body: "I would map the CRM workflow, connect the calendar, and verify it with test leads. My proposed rate is $125 per hour with initial delivery in 2 weeks.",
      bidAmount: 125,
      milestones: [{ name: "Hourly delivery rate", amount: 125, deliverable: "Implementation and validation" }],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /Hourly rate exceeds/i.test(issue)));
});
