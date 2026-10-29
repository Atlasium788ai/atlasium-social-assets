import assert from "node:assert/strict";
import test from "node:test";
import { deriveProofKeywords, safeProofFilename, validateProofPdf } from "../lib/proof-library";

test("accepts a real PDF signature and rejects a renamed non-PDF", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nexample");
  assert.equal(validateProofPdf({ name: "Case Study.pdf", size: pdf.length, bytes: pdf }), null);
  const fake = new TextEncoder().encode("<html>not a PDF</html>");
  assert.match(validateProofPdf({ name: "Case Study.pdf", size: fake.length, bytes: fake }) ?? "", /not a valid PDF/i);
});

test("derives useful matching terms while preserving supplied phrases", () => {
  const keywords = deriveProofKeywords("Atlasium Paid Media Overview.pdf", "Google Ads lead generation", "PPC, conversion tracking");
  assert.ok(keywords.includes("ppc"));
  assert.ok(keywords.includes("conversion tracking"));
  assert.ok(keywords.includes("google ads"));
  assert.ok(keywords.includes("lead generation"));
});

test("sanitizes proof filenames used in download headers", () => {
  assert.equal(safeProofFilename("proof\r\n\".pdf"), "proof---.pdf");
});
