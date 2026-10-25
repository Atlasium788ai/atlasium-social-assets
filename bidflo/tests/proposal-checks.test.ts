import assert from "node:assert/strict";
import test from "node:test";
import { getProposalChecks } from "../lib/proposal-checks";

test("three-check proposal gate passes a grounded review-ready draft", () => {
  const checks = getProposalChecks({
    score: 88,
    bidAmount: 1800,
    budgetMax: 2000,
    timeline: "2–3 weeks",
    proposalStatus: "ready",
    humanJudgmentRequired: false,
    approvalIssues: [],
  });
  assert.equal(checks.length, 3);
  assert.deepEqual(checks.map((check) => check.state), ["pass", "pass", "pass"]);
});

test("three-check proposal gate clearly calls out commercial and quality review", () => {
  const checks = getProposalChecks({
    score: 82,
    bidAmount: 2500,
    budgetMax: 2000,
    timeline: "",
    proposalStatus: "needs_review",
    humanJudgmentRequired: true,
    approvalIssues: ["Missing client requirement"],
  });
  assert.deepEqual(checks.map((check) => check.state), ["pass", "review", "review"]);
  assert.match(checks[2].detail, /1 issue/);
});
