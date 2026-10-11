import test from "node:test";
import assert from "node:assert/strict";
import { ATLASIUM_OPERATING_BRIEF } from "../src/operating_context.js";

test("live revenue access failures override historical snapshots", () => {
  const brief=ATLASIUM_OPERATING_BRIEF;
  const latest=brief.indexOf("CURRENT REVENUE CONNECTION FACTS (LIVE CHECKS, OCTOBER 10 2026");
  const history=brief.indexOf("HISTORICAL OPERATING STATE SNAPSHOT, OCTOBER 4 2026");
  assert.ok(latest>=0 && history>latest,"live current facts precede retained history");
  assert.match(brief,/reeviq_leads\(limit=1\) check returned HTTP 400/);
  assert.match(brief,/requires a valid workspace-scoped identity/);
  assert.match(brief,/Do not invent a workspace ID/);
  assert.match(brief,/API access is blocked by HTTP 402/i);
  assert.match(brief,/Microsoft Graph, SMTP or Outlook credentials/);
  assert.match(brief,/zero currently connected sending mailboxes/);
  assert.match(brief,/Resend listed the company domain with a FAILED verification status/);
  assert.match(brief,/CURRENT LIVE ACCESS IS BLOCKED BY HTTP 400/);
  assert.match(brief,/CURRENT LIVE API ACCESS IS BLOCKED BY HTTP 402/);
  assert.match(brief,/current unread count is UNKNOWN/);
  assert.match(brief,/neither old data nor a plan is evidence of successful outreach/);
});

test("historical campaign and inventory remain context, not live authorization",()=>{
  const brief=ATLASIUM_OPERATING_BRIEF;
  assert.match(brief,/HISTORICAL OCT 4 ReeVIQ read: 3,866 leads were once retrievable/);
  assert.match(brief,/HISTORICAL OCT 4 Instantly pilot/);
  assert.match(brief,/real live tool receipts always override older claims/);
  assert.match(brief,/Keep all outreach non-sending until actual endpoint access/);
});
