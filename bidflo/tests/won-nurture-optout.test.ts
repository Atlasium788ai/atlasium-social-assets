import assert from "node:assert/strict";
import test from "node:test";
import { canSetStage } from "../lib/pipeline-guards";
import { isExplicitClientStopRequest } from "../lib/client-opt-out";

test("no operator-controlled Lost or opt-out transitions", () => {
  assert.equal(canSetStage("submitted", "lost"), false);
  assert.equal(canSetStage("replied", "opted_out"), false);
  assert.equal(canSetStage("interviewed", "nurture"), true);
  assert.equal(canSetStage("submitted", "won"), true);
  assert.equal(canSetStage("nurture", "won"), true);
  assert.equal(canSetStage("nurture", "replied"), true);
  assert.equal(canSetStage("won", "nurture"), false);
});
test("only explicit client stop replies count as opt-out", () => {
  assert.equal(isExplicitClientStopRequest("STOP"), true);
  assert.equal(isExplicitClientStopRequest("Please stop contacting me."), true);
  assert.equal(isExplicitClientStopRequest("Message:\nSTOP\nView on Upwork"), true);
  assert.equal(isExplicitClientStopRequest("Not now, follow up next quarter."), false);
  assert.equal(isExplicitClientStopRequest("I haven't replied for six weeks."), false);
  assert.equal(isExplicitClientStopRequest("Hi, I might need help next month.\n\nUnsubscribe"), false);
  assert.equal(isExplicitClientStopRequest("Click unsubscribe at the bottom of this platform notification"), false);
  assert.equal(isExplicitClientStopRequest("Please send more updates"), false);
});
