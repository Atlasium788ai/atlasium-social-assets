import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveProposal, canConfirmManualSubmission, canEditProposal,
  canRescore, canSetStage,
} from "../lib/pipeline-guards";
import { isSameOriginMutation } from "../lib/security";

test("cannot approve, edit, or rescore active and closed opportunities", () => {
  assert.equal(canApproveProposal("proposal_ready"), true);
  assert.equal(canApproveProposal("submitted"), false);
  assert.equal(canApproveProposal("won"), false);
  assert.equal(canEditProposal("approved"), true);
  assert.equal(canEditProposal("ready_to_submit"), false);
  assert.equal(canRescore("proposal_ready"), true);
  assert.equal(canRescore("interviewed"), false);
  assert.equal(canRescore("submission_processing"), false);
  assert.equal(canEditProposal("submission_processing"), false);
  assert.equal(canConfirmManualSubmission("ready_to_submit"), true);
  assert.equal(canConfirmManualSubmission("proposal_ready"), false);
});

test("pipeline stage advances, never silently regresses", () => {
  assert.equal(canSetStage("submitted", "replied"), true);
  assert.equal(canSetStage("submitted", "interviewed"), true);
  assert.equal(canSetStage("replied", "won"), true);
  assert.equal(canSetStage("interviewed", "won"), true);
  assert.equal(canSetStage("won", "replied"), false);
  assert.equal(canSetStage("proposal_ready", "won"), false);
  assert.equal(canSetStage("approved", "submitted"), false);
  assert.equal(canSetStage("submitted", "submitted"), false);
});

test("sensitive writes require a same-origin browser request", () => {
  const url = "https://atlasium-bidflo.onrender.com/api/opportunities/some-id";
  assert.equal(isSameOriginMutation(new Request(url, { headers: {
    origin: "https://atlasium-bidflo.onrender.com",
  } })), true);
  assert.equal(isSameOriginMutation(new Request(url, { headers: {
    referer: "https://atlasium-bidflo.onrender.com/find",
  } })), true);
  assert.equal(isSameOriginMutation(new Request(url, { headers: {
    "sec-fetch-site": "same-origin",
  } })), true);
  assert.equal(isSameOriginMutation(new Request(url, { headers: {
    origin: "https://upwork.com",
  } })), false);
  assert.equal(isSameOriginMutation(new Request(url, { headers: {
    origin: "http://atlasium-bidflo.onrender.com",
  } })), false);
  assert.equal(isSameOriginMutation(new Request(url)), false);
});
