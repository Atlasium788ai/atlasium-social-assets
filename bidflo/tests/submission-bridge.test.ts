import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubmissionBridge } from "../lib/submission-bridge";

test("submission bridge remains manual unless separately enabled with login active", () => {
  const configured = { UPWORK_SUBMISSION_BRIDGE_ENABLED: "false", UPWORK_SUBMISSION_WEBHOOK_URL: "https://bridge.example.com/upwork", UPWORK_SUBMISSION_TOKEN: "secret" };
  assert.equal(resolveSubmissionBridge(configured, false).mode, "manual");
  assert.equal(resolveSubmissionBridge({ ...configured, UPWORK_SUBMISSION_BRIDGE_ENABLED: "true" }, true).mode, "manual");
});

test("enabled bridge reports missing or unsafe configuration clearly", () => {
  assert.deepEqual(resolveSubmissionBridge({ UPWORK_SUBMISSION_BRIDGE_ENABLED: "true" }, false), {
    mode: "error", error: "Submission bridge is enabled but its URL or token is missing",
  });
  assert.equal(resolveSubmissionBridge({
    UPWORK_SUBMISSION_BRIDGE_ENABLED: "true", UPWORK_SUBMISSION_WEBHOOK_URL: "http://localhost:3000/submit", UPWORK_SUBMISSION_TOKEN: "secret",
  }, false).mode, "error");
  assert.equal(resolveSubmissionBridge({
    UPWORK_SUBMISSION_BRIDGE_ENABLED: "true", UPWORK_SUBMISSION_WEBHOOK_URL: "https://192.168.1.4/submit", UPWORK_SUBMISSION_TOKEN: "secret",
  }, false).mode, "error");
});

test("enabled bridge accepts only a public HTTPS endpoint and returns its token internally", () => {
  assert.deepEqual(resolveSubmissionBridge({
    UPWORK_SUBMISSION_BRIDGE_ENABLED: "true", UPWORK_SUBMISSION_WEBHOOK_URL: "https://bridge.atlasium.com/upwork", UPWORK_SUBMISSION_TOKEN: "secret",
  }, false), { mode: "enabled", url: "https://bridge.atlasium.com/upwork", token: "secret" });
});
