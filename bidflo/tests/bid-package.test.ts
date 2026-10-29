import assert from "node:assert/strict";
import test from "node:test";
import { recommendAttachments } from "../lib/bid-package";
import type { OpportunityInput } from "../lib/types";

const base: OpportunityInput = {
  externalKey: "upwork:verified",
  title: "Google Ads campaign build",
  description: "Set up Google Ads, conversion tracking, and lead generation for a bookkeeping firm.",
  clientName: "Client",
  budgetMin: 1500,
  budgetMax: 1500,
  budgetType: "fixed",
  currency: "USD",
  jobUrl: "https://www.upwork.com/jobs/~0123456789",
  requirements: ["Google Ads", "Conversion tracking"],
  sourceSubject: "Upwork job",
  sourceReceivedAt: new Date().toISOString(),
};

const rules = {
  approvedAttachments: [{
    id: "paid-media",
    name: "Paid Media Overview.pdf",
    href: "/api/attachments/atlasium-paid-media-fulfilment-overview",
    description: "Verified fulfilment overview",
    keywords: ["google ads", "meta ads"],
    verified: true,
  }],
};

test("recommends only verified, relevant, private Visez attachments", () => {
  const matches = recommendAttachments(base, rules);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "paid-media");
  assert.match(matches[0].reason, /google ads/i);

  assert.deepEqual(recommendAttachments({
    ...base, title: "CRM cleanup", description: "Clean HubSpot properties.", requirements: ["HubSpot field cleanup"],
  }, rules), []);
  assert.deepEqual(recommendAttachments(base, {
    approvedAttachments: [{ ...rules.approvedAttachments[0], verified: false }],
  }), []);
  assert.deepEqual(recommendAttachments(base, {
    approvedAttachments: [{ ...rules.approvedAttachments[0], href: "https://untrusted.example/file.pdf" }],
  }), []);
});

test("recommends an uploaded private proof document when its terms match", () => {
  const [match] = recommendAttachments(base, {
    approvedAttachments: [{
      ...rules.approvedAttachments[0],
      id: "f76e58e8-1b90-4f71-8dbf-74ef9c44d39e",
      href: "/api/proof-documents/f76e58e8-1b90-4f71-8dbf-74ef9c44d39e",
    }],
  });
  assert.equal(match?.name, "Paid Media Overview.pdf");
});
