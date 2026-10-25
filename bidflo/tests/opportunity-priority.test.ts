import assert from "node:assert/strict";
import test from "node:test";
import { prioritizeOpportunities } from "../lib/opportunity-priority";
import type { OpportunityRow, OpportunityStatus } from "../lib/types";

function row(id: string, status: OpportunityStatus, score: number, budget = 1_000, due = false) {
  return {
    id, status, score, budget_max: String(budget), updated_at: "2026-10-24T12:00:00.000Z",
    follow_up_state: { ageDays: 3, due, level: due ? "first" : "upcoming", label: due ? "Follow up due" : "Upcoming" },
  } as OpportunityRow;
}

test("review-ready opportunities are shown before merely qualified jobs", () => {
  const items = [row("qualified", "qualified", 99), row("ready", "proposal_ready", 75), row("rejected", "rejected", 100)];
  assert.deepEqual(prioritizeOpportunities(items, "find").map((item) => item.id), ["ready", "qualified", "rejected"]);
});

test("same-stage opportunities sort by fit and then budget without mutating input", () => {
  const items = [row("low", "proposal_ready", 80, 5_000), row("high", "proposal_ready", 90, 1_000), row("tie", "proposal_ready", 80, 8_000)];
  const original = items.map((item) => item.id);
  assert.deepEqual(prioritizeOpportunities(items, "bid").map((item) => item.id), ["high", "tie", "low"]);
  assert.deepEqual(items.map((item) => item.id), original);
});

test("client replies and due follow-ups outrank passive submitted bids", () => {
  const items = [row("submitted", "submitted", 95), row("reply", "replied", 70), row("due", "replied", 60, 1_000, true)];
  assert.deepEqual(prioritizeOpportunities(items, "follow").map((item) => item.id), ["due", "reply", "submitted"]);
});
