import assert from "node:assert/strict";
import test from "node:test";
import { slackDeliveryConfigured } from "../lib/slack-alerts";

test("Slack delivery enables only a complete bot destination or an authentic Slack webhook", () => {
  const original = {
    token: process.env.SLACK_BOT_TOKEN, destination: process.env.SLACK_DESTINATION_ID, webhook: process.env.SLACK_WEBHOOK_URL,
  };
  try {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_DESTINATION_ID;
    process.env.SLACK_WEBHOOK_URL = "https://evil.example/services/T/B/X";
    assert.equal(slackDeliveryConfigured(), false);

    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T00000000/B00000000/secret";
    assert.equal(slackDeliveryConfigured(), true);

    delete process.env.SLACK_WEBHOOK_URL;
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_DESTINATION_ID = "U12345678";
    assert.equal(slackDeliveryConfigured(), true);

    process.env.SLACK_DESTINATION_ID = "Blair";
    assert.equal(slackDeliveryConfigured(), false);
  } finally {
    if (original.token === undefined) delete process.env.SLACK_BOT_TOKEN; else process.env.SLACK_BOT_TOKEN = original.token;
    if (original.destination === undefined) delete process.env.SLACK_DESTINATION_ID; else process.env.SLACK_DESTINATION_ID = original.destination;
    if (original.webhook === undefined) delete process.env.SLACK_WEBHOOK_URL; else process.env.SLACK_WEBHOOK_URL = original.webhook;
  }
});
