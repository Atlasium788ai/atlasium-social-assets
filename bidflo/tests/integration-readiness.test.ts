import assert from "node:assert/strict";
import test from "node:test";
import { integrationReadiness } from "../lib/integration-readiness";

test("readiness identifies every missing connection without revealing secret values", () => {
  const result = integrationReadiness({ VISEZ_AUTH_DISABLED: "true", AI_API_KEY: "super-secret-value" });
  assert.equal(result.database.ready, false);
  assert.equal(result.ai.ready, false);
  assert.equal(result.slack.ready, false);
  assert.equal(result.upworkEmailIntake.ready, false);
  assert.equal(result.upworkSubmission.mode, "manual");
  assert.equal(result.authentication.ready, false);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);
});

test("readiness recognizes complete drafting, email intake, owner alert, and Slack configuration", () => {
  const result = integrationReadiness({
    DATABASE_URL: "postgres://secret", AI_API_KEY: "secret", AI_MODEL: "gpt-5-mini", AI_API_BASE_URL: "https://api.openai.com/v1",
    RESEND_API_KEY: "secret", RESEND_WEBHOOK_SECRET: "secret", UPWORK_ALLOWED_SENDERS: "upwork@example.com",
    VISEZ_OWNER_EMAIL: "owner@example.com", VISEZ_EMAIL_FROM: "Visez <alerts@example.com>",
    SLACK_BOT_TOKEN: "xoxb-secret", SLACK_DESTINATION_ID: "U12345678",
    NEON_AUTH_BASE_URL: "https://auth.example.com", NEON_AUTH_COOKIE_SECRET: "secret", VISEZ_AUTH_DISABLED: "false",
  });
  assert.equal(result.database.ready, true);
  assert.equal(result.ai.ready, true);
  assert.equal(result.upworkEmailIntake.ready, true);
  assert.equal(result.ownerEmail.ready, true);
  assert.equal(result.slack.ready, true);
  assert.equal(result.authentication.ready, true);
  assert.equal(result.upworkSubmission.mode, "manual");
});
