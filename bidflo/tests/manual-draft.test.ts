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

test("paragraph-only job import preserves detailed scope without inventing requirements", async () => {
  const { extractManualRequirements } = await import("../lib/job-requirements");
  const brief = "A marketing agency needs a CRM sales pipeline and lead qualification funnel, appointment booking and calendar scheduling, automated reminders and follow-ups, LinkedIn outreach tracking, a dashboard showing booked calls, plus three live training sessions and written documentation.";
  const requirements = extractManualRequirements(brief);
  assert.ok(requirements.some((value) => /CRM/.test(value)));
  assert.ok(requirements.some((value) => /qualification/.test(value)));
  assert.ok(requirements.some((value) => /booking/.test(value)));
  assert.ok(requirements.some((value) => /LinkedIn/.test(value)));
  assert.ok(requirements.some((value) => /dashboard/.test(value)));
  assert.ok(requirements.some((value) => /Training/.test(value)));
  assert.equal(requirements.some((value) => /React and Node/.test(value)), false);
});

test("a job with exact opening and short-proposal instructions uses 5 focused sentences and honest proof placeholders", () => {
  const description = "Start your proposal with the words 'Cat in the Hat'. In 3 to 5 sentences explain your approach. Share a similar project you've completed. Confirm fixed price and ability to deliver within 30 days. CRM lead qualification funnel with calendar booking, reminders, LinkedIn leads, dashboard, and training.";
  const opportunity: OpportunityInput = {
    externalKey: "~022111975504986782027",
    title: "Lead qualification funnel CRM training",
    description,
    jobUrl: "https://www.upwork.com/jobs/~022111975504986782027",
    requirements: [],
    sourceSubject: "Manual Upwork job import",
    sourceReceivedAt: "2026-10-24T12:00:00.000Z",
  };
  const commercials: ProposalDraft = {
    body: "", questions: [], bidAmount: 1850, timeline: "2–4 weeks",
    milestones: [{name:"Build",amount:1850,deliverable:"Working CRM"}],
  };
  const draft = prepareManualReviewDraft(opportunity, commercials);
  assert.ok(draft.body.startsWith("Cat in the Hat"));
  assert.match(draft.body, /lead qualification/i);
  assert.match(draft.body, /reminders/i);
  assert.match(draft.body, /dashboard/i);
  assert.match(draft.body, /CRM/i);
  assert.match(draft.body, /\$1,850/);
  assert.match(draft.body, /Insert one genuine similar project/);
  assert.match(draft.body, /confirm ability to deliver within 30 days/);
});

test("hourly fallback states the rate without misrepresenting it as fixed price", () => {
  const opportunity: OpportunityInput = {
    externalKey: "~hourly-draft",
    title: "CRM automation support",
    description: "Build and test CRM lead routing, booking, and reporting with a documented weekly handoff.",
    budgetMin: 100,
    budgetMax: 150,
    budgetType: "hourly",
    currency: "USD",
    jobUrl: "https://www.upwork.com/jobs/~hourly-draft",
    requirements: ["CRM lead routing", "Calendar booking"],
    sourceSubject: "New job",
    sourceReceivedAt: "2026-10-24T12:00:00.000Z",
  };
  const commercials: ProposalDraft = {
    body: "", questions: [], bidAmount: 125, timeline: "2–4 weeks for initial delivery",
    milestones: [{ name: "Hourly delivery rate", amount: 125, deliverable: "Implementation and testing" }],
  };
  const draft = prepareManualReviewDraft(opportunity, commercials);
  assert.match(draft.body, /\$125 per hour/i);
  assert.match(draft.body, /2–4 weeks for initial delivery/i);
  assert.doesNotMatch(draft.body, /fixed-price/i);
});
