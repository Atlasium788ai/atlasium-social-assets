import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoredRequirements } from "../lib/job-requirements";

test("normalizes current requirement arrays", () => {
  assert.deepEqual(normalizeStoredRequirements(["CRM setup", "Lead routing"]), ["CRM setup", "Lead routing"]);
});

test("recovers legacy JSON strings and object values", () => {
  assert.deepEqual(
    normalizeStoredRequirements('{"0":"n8n workflows","1":"Multi-tenant dashboard"}'),
    ["n8n workflows", "Multi-tenant dashboard"],
  );
  assert.deepEqual(
    normalizeStoredRequirements({ requirements: ["API integration", "Long-term support"] }),
    ["API integration", "Long-term support"],
  );
});

test("ignores unsupported primitive values and removes duplicates", () => {
  assert.deepEqual(normalizeStoredRequirements(["CRM setup", 42, null, " CRM   setup "]), ["CRM setup"]);
});
