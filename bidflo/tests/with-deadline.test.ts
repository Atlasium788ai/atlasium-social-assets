import assert from "node:assert/strict";
import test from "node:test";
import { withDeadline } from "../lib/with-deadline";

test("auth deadline returns successful operations", async () => {
  assert.equal(await withDeadline(Promise.resolve("signed-in"), 50, "timeout"), "signed-in");
});

test("auth deadline releases the login UI after a stalled request", async () => {
  await assert.rejects(
    withDeadline(new Promise<never>(() => undefined), 5, "Sign-in took too long. Please try again."),
    /Sign-in took too long/,
  );
});
