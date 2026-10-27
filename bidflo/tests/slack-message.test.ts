import assert from "node:assert/strict";
import test from "node:test";
import { formatSlackAlert, slackEscape } from "../lib/slack-message";

const uuid = "277bd1b5-8666-4472-9b02-34c7abed87e5";

test("Slack alerts point to the correct private Visez opportunity", () => {
  const alert = formatSlackAlert({
    kind: "proposal_ready", title: "CRM integration", opportunityId: uuid, score: 90, amount: 2300,
  }, "https://atlasium-visez.onrender.com");
  assert.match(alert, /Proposal needs review/);
  assert.match(alert, /Fit score: 90\/100/);
  assert.match(alert, /US\$2,300/);
  assert.match(alert, new RegExp(uuid));
  assert.match(alert, /No proposals or replies were sent automatically/);
});

test("Slack alerts accept the verified legacy Render origin without changing Visez branding", () => {
  const alert = formatSlackAlert({ kind: "proposal_ready", title: "Genesys routing", opportunityId: uuid },
    "https://atlasium-bidflo.onrender.com");
  assert.match(alert, new RegExp(`https://atlasium-bidflo\\.onrender\\.com/opportunities/${uuid}`));
  assert.match(alert, /Visez/);
});

test("client reply links stay inside Upwork", () => {
  const alert = formatSlackAlert({
    kind: "client_reply", title: "Automation", opportunityId: uuid,
    clientRoomUrl: "https://www.upwork.com/ab/messages/rooms/1234?tracking=email",
  }, "https://atlasium-visez.onrender.com");
  assert.match(alert, /Open Upwork conversation/);
  assert.doesNotMatch(alert, /tracking=email/);
  const malicious = formatSlackAlert({
    kind: "client_reply", title: "Automation",
    clientRoomUrl: "https://upwork.com.evil.example/ab/messages/rooms/1234",
  }, "https://atlasium-visez.onrender.com");
  assert.doesNotMatch(malicious, /Open Upwork conversation/);
});

test("untrusted project titles cannot trigger Slack mentions or markup", () => {
  const text = slackEscape("<!channel> & CRM\n <script>");
  assert.equal(text, "&lt;!channel&gt; &amp; CRM &lt;script&gt;");
  const alert = formatSlackAlert({ kind: "qualified", title: "<!here> New @everyone job" },
    "https://atlasium-visez.onrender.com");
  assert.doesNotMatch(alert, /<!here>|<!channel>/);
});

test("client message details and offsite URLs are never copied into Slack", () => {
  const text = formatSlackAlert({
    kind: "client_reply", title: "Integrate workflows", opportunityId: uuid,
  }, "https://evil.example");
  assert.doesNotMatch(text, /evil.example/);
  assert.doesNotMatch(text, /https:\/\//);
});
