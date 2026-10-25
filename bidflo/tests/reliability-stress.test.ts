import assert from "node:assert/strict";
import test from "node:test";
import { canApproveProposal, canConfirmManualSubmission, canEditProposal, canRescore, canSetStage, type OpportunityStage } from "../lib/pipeline-guards";
import { retryPolicy } from "../lib/retry-policy";

const stages: OpportunityStage[] = [
  "new", "rejected", "qualified", "proposal_ready", "approved", "ready_to_submit",
  "submission_processing", "submitted", "replied", "interviewed", "nurture", "won", "opted_out", "lost",
];

test("stress: every pipeline-state pair follows the explicit forward-only transition matrix", () => {
  const allowed = new Set([
    "submitted>replied", "submitted>interviewed", "submitted>won", "submitted>nurture",
    "replied>interviewed", "replied>won", "replied>nurture",
    "interviewed>won", "interviewed>nurture",
    "nurture>replied", "nurture>interviewed", "nurture>won",
  ]);
  for (let round = 0; round < 100; round++) {
    for (const current of stages) {
      for (const next of stages) assert.equal(canSetStage(current, next), allowed.has(`${current}>${next}`));
    }
  }
});

test("only intended review states can mutate proposals or enter submission handoff", () => {
  for (const stage of stages) {
    assert.equal(canApproveProposal(stage), stage === "proposal_ready");
    assert.equal(canEditProposal(stage), stage === "proposal_ready" || stage === "approved");
    assert.equal(canRescore(stage), ["new", "rejected", "qualified", "proposal_ready"].includes(stage));
    assert.equal(canConfirmManualSubmission(stage), stage === "ready_to_submit");
  }
});

test("inbound and Slack retries back off, cap, and terminate deterministically", () => {
  assert.deepEqual(retryPolicy(1, { maxAttempts: 5, maxDelayMinutes: 60 }), { exhausted: false, delayMinutes: 2 });
  assert.deepEqual(retryPolicy(4, { maxAttempts: 5, maxDelayMinutes: 60 }), { exhausted: false, delayMinutes: 16 });
  assert.deepEqual(retryPolicy(5, { maxAttempts: 5, maxDelayMinutes: 60 }), { exhausted: true, delayMinutes: 32 });
  assert.deepEqual(retryPolicy(8, { maxAttempts: 8, maxDelayMinutes: 120 }), { exhausted: true, delayMinutes: 120 });
  assert.deepEqual(retryPolicy(500, { maxAttempts: 8, maxDelayMinutes: 120 }), { exhausted: true, delayMinutes: 120 });
});
