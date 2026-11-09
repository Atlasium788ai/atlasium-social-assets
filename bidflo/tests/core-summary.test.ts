import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVisezCoreSummary,
  verifyCoreReadToken,
  VISEZ_CORE_OPERATIONS_SCOPE,
  VISEZ_CORE_STATUSES,
  VISEZ_CORE_SUMMARY_SCHEMA,
} from "../lib/core-summary";

test("the dedicated Core read token fails closed and does not accept an admin token", () => {
  const configured = "synthetic-visez-core-read-token-32-characters";
  assert.deepEqual(verifyCoreReadToken(null, undefined), {
    ok: false, status: 503, error: "Core read access is not configured",
  });
  assert.equal(verifyCoreReadToken("Bearer admin-session-token", configured).ok, false);
  assert.equal(verifyCoreReadToken(`Bearer ${configured}`, configured).ok, true);
  assert.equal(verifyCoreReadToken(`Basic ${configured}`, configured).ok, false);
});

test("Visez summary exposes only canonical status counts", () => {
  const summary = buildVisezCoreSummary([
    { status: "new", count: 3, client: "Private Client" },
    { status: "proposal_ready", count: 2, proposal: "Private draft" },
    { status: "submitted", count: 1 },
  ], new Date("2026-11-09T15:00:00.000Z"));

  assert.equal(summary.schema, VISEZ_CORE_SUMMARY_SCHEMA);
  assert.equal(summary.operationsScopeId, VISEZ_CORE_OPERATIONS_SCOPE);
  assert.equal(summary.checkedAt, "2026-11-09T15:00:00.000Z");
  assert.deepEqual(Object.keys(summary.statusCounts), VISEZ_CORE_STATUSES);
  assert.equal(summary.statusCounts.new, 3);
  assert.equal(summary.statusCounts.proposal_ready, 2);
  assert.equal(summary.statusCounts.submitted, 1);
  assert.equal(summary.statusCounts.won, 0);
  const output = JSON.stringify(summary);
  assert.equal(output.includes("Private Client"), false);
  assert.equal(output.includes("Private draft"), false);
});

test("unknown, duplicate, negative and overflowing status aggregates fail closed", () => {
  const invalid = [
    [{ status: "unknown", count: 1 }],
    [{ status: "new", count: 1 }, { status: "new", count: 2 }],
    [{ status: "qualified", count: -1 }],
    [{ status: "won", count: 1.5 }],
    [
      { status: "new", count: Number.MAX_SAFE_INTEGER },
      { status: "rejected", count: 1 },
    ],
  ];
  for (const rows of invalid) assert.throws(() => buildVisezCoreSummary(rows));
});
