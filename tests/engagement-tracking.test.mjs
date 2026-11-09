import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadBuilder() {
  const source = await readFile(new URL("../app/flow/services/engagement-tracking.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript;charset=utf-8," + encodeURIComponent(js));
}

test("brand tracking links are secure and attribute source campaign and post", async () => {
  const { buildEngagementTrackingLink } = await loadBuilder();
  const url = new URL(buildEngagementTrackingLink({
    website: "https://builttoown.example/articles",
    platform: "linkedin",
    campaign: "Week-01",
    content: "owner-question",
    path: "/articles/example",
  }));
  assert.equal(url.origin, "https://builttoown.example");
  assert.equal(url.pathname, "/articles/example");
  assert.equal(url.searchParams.get("utm_source"), "linkedin");
  assert.equal(url.searchParams.get("utm_medium"), "organic_social");
  assert.equal(url.searchParams.get("utm_campaign"), "week-01");
  assert.equal(url.searchParams.get("utm_content"), "owner-question");
});
test("tracking builder rejects foreign redirect destinations and invalid site URLs", async () => {
  const { buildEngagementTrackingLink } = await loadBuilder();
  const valid = { website: "https://owner.example", platform: "facebook", campaign: "campaign" };
  for (const altered of [
    { website: "http://owner.example" },
    { website: "https://bad:secret@owner.example" },
    { website: "https://localhost" },
    { path: "//another-site.example" },
    { path: "/\\another-site.example" },
    { path: "https://another-site.example" },
    { path: "/product?redirect=https://bad.example" },
    { path: "/product#tag" },
    { campaign: "invalid campaign value!" },
    { platform: "email" },
  ]) {
    assert.throws(() => buildEngagementTrackingLink({ ...valid, ...altered }), undefined, JSON.stringify(altered));
  }
});
test("tracking builder does not claim to count clicks or conversions", async () => {
  const { buildEngagementTrackingLink } = await loadBuilder();
  const url = new URL(buildEngagementTrackingLink({
    website: "https://atlasium.ca", platform: "instagram", campaign: "consulting", path: "/"
  }));
  assert.equal(url.searchParams.get("utm_content"), null);
  assert.equal(url.searchParams.get("utm_medium"), "organic_social");
  assert.equal(url.hostname, "atlasium.ca");
});
