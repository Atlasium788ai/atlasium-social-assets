import assert from "node:assert/strict";
import test from "node:test";
import { getFollowUpState } from "../lib/follow-up";

const now = new Date("2026-10-24T12:00:00.000Z");
const rules = { firstReminderDays: 3, secondReminderDays: 7, staleAfterDays: 14 };

test("shows the next reminder before an opportunity is due", () => {
  const state = getFollowUpState("2026-10-22T12:00:00.000Z", rules, now);
  assert.equal(state.due, false);
  assert.equal(state.label, "Next reminder in 1d");
});

test("escalates first, second and stale follow-up states", () => {
  assert.equal(getFollowUpState("2026-10-21T12:00:00.000Z", rules, now).level, "first");
  assert.equal(getFollowUpState("2026-10-17T12:00:00.000Z", rules, now).level, "second");
  assert.equal(getFollowUpState("2026-10-10T12:00:00.000Z", rules, now).level, "stale");
});
