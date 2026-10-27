import assert from "node:assert/strict";
import test from "node:test";
import { qualifyOpportunity, recommendCommercials } from "../lib/qualification";
import type { OpportunityInput, QualificationRules } from "../lib/types";

const rules: QualificationRules = {
  minimumScore: 55,
  autoPrepareScore: 70,
  minimumBudget: 750,
  targetHourlyRate: 125,
  serviceFitKeywords: ["automation", "next.js", "node", "postgres", "dashboard"],
  poorFitKeywords: ["data entry", "unpaid test"],
  complexityPenaltyKeywords: ["same day", "unlimited revisions"],
  recurringKeywords: ["ongoing", "maintenance"],
};

const opportunity: OpportunityInput = {
  externalKey: "~high-fit",
  title: "Automation dashboard",
  description: "Build an ongoing Next.js and Node dashboard backed by Postgres with maintenance.",
  budgetMin: 5000,
  budgetMax: 6000,
  budgetType: "fixed",
  currency: "USD",
  jobUrl: "https://www.upwork.com/jobs/~high-fit",
  requirements: ["automation"],
  sourceSubject: "New job",
  sourceReceivedAt: new Date().toISOString(),
};

test("scores a profitable recurring fit above the preparation threshold", () => {
  const result = qualifyOpportunity(opportunity, rules);
  assert.ok(result.score >= 70);
  assert.equal(result.rejected, false);
  assert.equal(result.recurringPotential, true);
  assert.ok(result.breakdown.reasons.includes("Core revenue opportunity"));
});

test("high-value work is identified as enterprise guidance without an upper-value exclusion", () => {
  const result = qualifyOpportunity({ ...opportunity, budgetMin: 100_000, budgetMax: 125_000 }, rules);
  assert.equal(result.rejected, false);
  assert.ok(result.breakdown.reasons.includes("Enterprise / premium opportunity"));
});

test("auto-rejects explicit poor-fit work", () => {
  const result = qualifyOpportunity({ ...opportunity, title: "Data entry", description: "Large unpaid test required" }, rules);
  assert.equal(result.rejected, true);
  assert.match(result.rejectionReason ?? "", /Unsafe|Poor-fit/);
});

test("recommended milestones add up to the bid", () => {
  const commercial = recommendCommercials(opportunity, 125);
  assert.equal(commercial.milestones.reduce((sum, item) => sum + item.amount, 0), commercial.bidAmount);
  assert.ok(commercial.bidAmount <= 6000);
});

test("rejects a low fixed budget even when the service match is otherwise strong", () => {
  const result = qualifyOpportunity({
    ...opportunity,
    externalKey: "~low-budget",
    description: "Build a well-defined Next.js automation dashboard backed by Postgres with documented acceptance tests.",
    budgetMin: 250,
    budgetMax: 500,
  }, rules);
  assert.equal(result.rejected, true);
  assert.match(result.rejectionReason ?? "", /below the configured 750 minimum/i);
});

test("rejects a high-budget job with no direct Atlasium service match", () => {
  const result = qualifyOpportunity({
    ...opportunity,
    externalKey: "~wrong-service",
    title: "Architectural site survey",
    description: "Complete a detailed physical building survey and prepare stamped structural drawings for a commercial property.",
    requirements: ["Ontario engineering stamp"],
    budgetMin: 10_000,
    budgetMax: 15_000,
  }, rules);
  assert.equal(result.rejected, true);
  assert.match(result.rejectionReason ?? "", /No direct match/i);
});

test("matches configured capabilities as phrases rather than substrings", () => {
  const aiOnlyRules = { ...rules, serviceFitKeywords: ["ai"] };
  const result = qualifyOpportunity({
    ...opportunity,
    externalKey: "~email-is-not-ai",
    title: "Email newsletter editor",
    description: "Edit and proofread a weekly email newsletter using supplied copy and an existing template without changing the system.",
    requirements: ["Email proofreading"],
  }, aiOnlyRules);
  assert.equal(result.rejected, true);
  assert.equal(result.breakdown.serviceFit, 0);
});

test("hourly qualification uses the hourly ceiling and never recommends above it", () => {
  const hourly = {
    ...opportunity,
    externalKey: "~hourly",
    description: "Build and test a Node automation workflow with documented Postgres integration and an ongoing maintenance path.",
    budgetType: "hourly" as const,
    budgetMin: 60,
    budgetMax: 90,
  };
  const result = qualifyOpportunity(hourly, rules);
  const commercial = recommendCommercials(hourly, rules.targetHourlyRate);
  assert.equal(result.rejected, true);
  assert.match(result.rejectionReason ?? "", /Hourly ceiling/i);
  assert.equal(commercial.bidAmount, 90);
  assert.equal(commercial.milestones.length, 1);
});

test("rejects unsafe off-platform payment instructions", () => {
  const result = qualifyOpportunity({
    ...opportunity,
    externalKey: "~unsafe",
    description: "Build a Next.js automation dashboard and contact me via Telegram so I can arrange payment outside Upwork.",
  }, rules);
  assert.equal(result.rejected, true);
  assert.match(result.rejectionReason ?? "", /Unsafe/i);
});

test("suggested bids never exceed a stated client budget, including small jobs", () => {
  const smallFixed = recommendCommercials({ ...opportunity, budgetMin: 200, budgetMax: 200, budgetType: "fixed" }, 125);
  assert.equal(smallFixed.bidAmount, 200);
  assert.equal(smallFixed.milestones.reduce((total, m) => total + m.amount, 0), 200);

  const lowHourly = recommendCommercials({ ...opportunity, budgetMin: 25, budgetMax: 50, budgetType: "hourly" }, 125);
  assert.ok(lowHourly.bidAmount <= 50);
});

test("commercial defaults remain reviewable when the client lists no budget", () => {
  const unknown = recommendCommercials({ ...opportunity, budgetMin: null, budgetMax: null, budgetType: "unknown" }, 125);
  assert.equal(unknown.bidAmount, 2500);
  assert.equal(unknown.milestones.reduce((sum, item) => sum + item.amount, 0), 2500);
});
