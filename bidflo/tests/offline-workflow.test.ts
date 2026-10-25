import assert from "node:assert/strict";
import test from "node:test";
import { parseUpworkEmail } from "../lib/email-parser";
import { prepareManualReviewDraft } from "../lib/manual-draft";
import { proposalPreflight } from "../lib/proposal-preflight";
import { qualifyOpportunity, recommendCommercials } from "../lib/qualification";
import type { OpportunityInput, QualificationRules } from "../lib/types";

const rules: QualificationRules = {
  minimumScore: 55,
  autoPrepareScore: 70,
  minimumBudget: 750,
  targetHourlyRate: 125,
  serviceFitKeywords: ["automation", "crm", "dashboard", "next.js", "node.js"],
  poorFitKeywords: ["data entry", "commission only"],
  complexityPenaltyKeywords: ["same day", "unlimited revisions"],
  recurringKeywords: ["ongoing", "monthly", "maintenance"],
};

function parsedOpportunity(subject: string, text: string) {
  const parsed = parseUpworkEmail({ subject, text, receivedAt: "2026-10-24T12:00:00.000Z" });
  assert.equal(parsed.kind, "opportunity");
  if (parsed.kind !== "opportunity") throw new Error("Expected opportunity");
  return parsed.opportunity;
}

test("offline notification-to-review workflow deduplicates, qualifies, prices, drafts, and quality-checks", () => {
  const good = parsedOpportunity(
    "New job: CRM automation and reporting dashboard",
    `CRM automation and reporting dashboard
Budget: $2,500
- CRM lead routing
- Calendar booking integration
- Reporting dashboard
Build and test the workflow, document the handoff, and support an ongoing monthly maintenance phase.
https://www.upwork.com/jobs/~01ENDTOEND`,
  );
  const duplicate = parsedOpportunity(
    "Reminder: CRM automation and reporting dashboard",
    `Budget: $2,500
Build and test the CRM automation and reporting dashboard with a documented handoff.
https://www.upwork.com/jobs/~01endtoend?source=second-alert`,
  );
  const poor = parsedOpportunity(
    "New job: Bulk data entry",
    `Budget: $100
Perform bulk data entry from scanned receipts with a same-day unpaid sample and no automation scope.
https://www.upwork.com/jobs/~01POORFIT`,
  );

  const unique = new Map([good, duplicate, poor].map((item) => [item.externalKey, item]));
  assert.equal(unique.size, 2);

  const goodResult = qualifyOpportunity(good, rules);
  const poorResult = qualifyOpportunity(poor, rules);
  assert.equal(goodResult.rejected, false);
  assert.ok(goodResult.score >= rules.autoPrepareScore);
  assert.equal(poorResult.rejected, true);

  const commercials = recommendCommercials(good, rules.targetHourlyRate);
  const proposal = prepareManualReviewDraft(good, { body: "", questions: [], ...commercials });
  const preflight = proposalPreflight({ opportunity: good, proposal, proposalRules: { maxWords: 350 } });
  assert.equal(preflight.ok, true, preflight.issues.join("; "));
  assert.ok(proposal.questions.some((question) => /CRM|calendar|result/i.test(question)));
  assert.ok(proposal.bidAmount <= Number(good.budgetMax));
  assert.match(proposal.body, /CRM lead routing/i);
  assert.match(proposal.body, /calendar booking/i);
  assert.match(proposal.body, /reporting dashboard/i);
});

test("hourly offline workflow respects the client ceiling through proposal review", () => {
  const hourly: OpportunityInput = {
    externalKey: "~01hourlyflow",
    title: "Ongoing Node.js automation support",
    description: "Build, test, and document an ongoing Node.js automation workflow with CRM routing and calendar booking.",
    requirements: ["Node.js automation", "CRM routing", "Calendar booking"],
    budgetMin: 125,
    budgetMax: 150,
    budgetType: "hourly",
    currency: "USD",
    jobUrl: "https://www.upwork.com/jobs/~01hourlyflow",
    sourceSubject: "New job",
    sourceReceivedAt: "2026-10-24T12:00:00.000Z",
  };
  assert.equal(qualifyOpportunity(hourly, rules).rejected, false);
  const commercials = recommendCommercials(hourly, rules.targetHourlyRate);
  const proposal = prepareManualReviewDraft(hourly, { body: "", questions: [], ...commercials });
  assert.equal(commercials.bidAmount, 125);
  assert.equal(proposalPreflight({ opportunity: hourly, proposal }).ok, true);
  assert.match(proposal.body, /\$125 per hour/i);
});
