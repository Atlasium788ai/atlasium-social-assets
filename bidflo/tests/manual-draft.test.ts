import assert from "node:assert/strict";
import test from "node:test";
import { prepareManualReviewDraft } from "../lib/manual-draft";
import type { OpportunityInput, ProposalDraft } from "../lib/types";

test("fallback draft is grounded in the job and keeps commercial milestones", () => {
  const opportunity: OpportunityInput = {
    externalKey: "~012345",
    title: "Revenue automation dashboard",
    description: "A focused automation MVP",
    jobUrl: "https://www.upwork.com/jobs/~012345",
    requirements: ["React and Node.js", "CRM data integration"],
    sourceSubject: "New job",
    sourceReceivedAt: "2026-10-23T12:00:00.000Z",
  };
  const commercials: ProposalDraft = {
    body: "", questions: [], bidAmount: 9200, timeline: "4-8 weeks",
    milestones: [{ name: "Core implementation", amount: 9200, deliverable: "Working MVP" }],
  };
  const draft = prepareManualReviewDraft(opportunity, commercials);
  assert.match(draft.body, /Revenue automation dashboard/);
  assert.match(draft.body, /CRM data integration/);
  assert.match(draft.body, /React and Node.js/);
  assert.match(draft.body, /\$9,200/);
  assert.match(draft.body, /Core implementation/);
  assert.doesNotMatch(draft.body, /in the area of systems integration/);
  assert.equal(draft.bidAmount, 9200);
  assert.equal(draft.milestones[0].amount, 9200);
  assert.ok(draft.questions.length >= 2);
  assert.ok(draft.questions.some((question) => /CRM/.test(question)));
});
