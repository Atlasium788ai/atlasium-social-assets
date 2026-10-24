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
});

test("auto-rejects explicit poor-fit work", () => {
  const result = qualifyOpportunity({ ...opportunity, title: "Data entry", description: "Large unpaid test required" }, rules);
  assert.equal(result.rejected, true);
  assert.match(result.rejectionReason ?? "", /Poor-fit/);
});

test("recommended milestones add up to the bid", () => {
  const commercial = recommendCommercials(opportunity, 125);
  assert.equal(commercial.milestones.reduce((sum, item) => sum + item.amount, 0), commercial.bidAmount);
  assert.ok(commercial.bidAmount <= 6000);
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
