import test from "node:test";
import assert from "node:assert/strict";
import { validUpworkJobUrl } from "../lib/manual-intake";

test("only real direct Upwork job URLs are accepted for manual capture", () => {
  assert.equal(
    validUpworkJobUrl("https://www.upwork.com/jobs/~012345678?source=search#details"),
    "https://www.upwork.com/jobs/~012345678",
  );
  assert.equal(
    validUpworkJobUrl("https://www.upwork.com/freelance-jobs/apply/CRM-Automation_~012345/?source=email"),
    "https://www.upwork.com/freelance-jobs/apply/CRM-Automation_~012345",
  );
  assert.equal(validUpworkJobUrl("https://www.upwork.com/nx/search/jobs/details/~012345"), "https://www.upwork.com/nx/search/jobs/details/~012345");
  assert.equal(validUpworkJobUrl("https://www.upwork.com/nx/search/jobs/?q=automation"), null);
  assert.equal(validUpworkJobUrl("https://upwork.com.evil.example/jobs/~0123"), null);
  assert.equal(validUpworkJobUrl("http://www.upwork.com/jobs/~0123"), null);
  assert.equal(validUpworkJobUrl("javascript:alert(1)"), null);
});
