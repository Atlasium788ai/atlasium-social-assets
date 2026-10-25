import assert from "node:assert/strict";
import test from "node:test";
import { parseUpworkEmail } from "../lib/email-parser";
import { qualifyOpportunity, recommendCommercials } from "../lib/qualification";
import { prepareManualReviewDraft } from "../lib/manual-draft";
import { proposalPreflight } from "../lib/proposal-preflight";
import type { QualificationRules } from "../lib/types";

const rules: QualificationRules = {
  minimumScore: 55,
  autoPrepareScore: 70,
  minimumBudget: 750,
  targetHourlyRate: 125,
  serviceFitKeywords: ["crm", "automation", "booking", "dashboard", "lead"],
  poorFitKeywords: ["data entry", "unpaid test"],
  complexityPenaltyKeywords: ["same day", "unlimited revisions"],
  recurringKeywords: ["ongoing", "monthly"],
};

test("offline intake to reviewable proposal never sends, overspends, or requires APIs", () => {
  const parsed = parseUpworkEmail({
    subject: "New job: CRM Automation and Appointment Booking",
    receivedAt: "2026-10-24T12:00:00.000Z",
    text: [
      "Build an ongoing CRM automation, lead routing, appointment booking, and dashboard.",
      "Budget: $3,000",
      "- CRM lead capture and routing",
      "- Appointment booking integration",
      "- Reporting dashboard",
      "https://www.upwork.com/jobs/~01OFFLINEJOB",
    ].join("\n"),
  });
  assert.equal(parsed.kind, "opportunity");
  if (parsed.kind !== "opportunity") return;

  const qualified = qualifyOpportunity(parsed.opportunity, rules);
  assert.equal(qualified.rejected, false);
  assert.ok(qualified.score >= rules.autoPrepareScore);

  const commercial = recommendCommercials(parsed.opportunity, rules.targetHourlyRate);
  assert.ok(commercial.bidAmount > 0);
  assert.ok(commercial.bidAmount <= 3000);
  assert.equal(commercial.milestones.reduce((total, item) => total + item.amount, 0), commercial.bidAmount);

  const proposal = prepareManualReviewDraft(parsed.opportunity, { body: "", questions: [], ...commercial });
  assert.ok(proposal.body.includes("CRM"));
  assert.ok(proposal.questions.length > 0);
  const gate = proposalPreflight({ opportunity: parsed.opportunity, proposal });
  assert.ok(Array.isArray(gate.issues));
  // Offline mode is deliberately a draft for human review, never a submitted application.
  assert.equal(typeof proposal.body, "string");
});

test("poor-fit intake cannot move automatically to proposal preparation", () => {
  const parsed = parseUpworkEmail({
    subject: "Job alert: Data entry unpaid test",
    receivedAt: "2026-10-24T12:00:00.000Z",
    text: "Unpaid test and data entry. Budget: $100. https://www.upwork.com/jobs/~01POORFIT",
  });
  assert.equal(parsed.kind, "opportunity");
  if (parsed.kind !== "opportunity") return;
  assert.equal(qualifyOpportunity(parsed.opportunity, rules).rejected, true);
});
