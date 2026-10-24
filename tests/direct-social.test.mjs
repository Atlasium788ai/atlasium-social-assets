import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function directModule() {
  const source = await readFile(new URL("../worker/direct-social.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}#${Date.now()}`);
}

const facebook = { id: "page-a", brandId: "brand-a", service: "facebook", displayName: "Brand A Page", accountId: "123456", accessToken: "secret-a" };
const instagram = { id: "ig-a", brandId: "brand-a", service: "instagram", displayName: "Brand A IG", accountId: "7891011", accessToken: "secret-b" };
const env = { DIRECT_SOCIAL_CONNECTIONS: JSON.stringify([facebook, instagram]) };
const post = { brandId: "brand-a", channelId: "page-a", service: "facebook", text: "New product news", mediaUrl: "https://media.example/image.png", mediaType: "image", surface: "feed", mode: "shareNow" };

test("only non-sensitive destination metadata goes to the browser", async () => {
  const { listDirectSocialDestinations } = await directModule();
  const channels = listDirectSocialDestinations(env);
  assert.equal(channels.length, 2);
  assert.equal(channels[0].brandId, "brand-a");
  assert.doesNotMatch(JSON.stringify(channels), /secret-a|secret-b|accessToken|accountId/);
  assert.deepEqual(listDirectSocialDestinations({}), []);
});

test("rejects cross-brand publishing before contacting any platform", async () => {
  const { publishDirectSocial } = await directModule();
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("should never call external platform"); };
  try {
    await assert.rejects(publishDirectSocial(env, { ...post, brandId: "brand-b" }), /not assigned/);
    await assert.rejects(publishDirectSocial(env, { ...post, channelId: "unknown" }), /not assigned/);
    await assert.rejects(publishDirectSocial(env, { ...post, service: "instagram" }), /not assigned/);
    await assert.rejects(publishDirectSocial(env, { ...post, mode: "customScheduled", dueAt: "2027-01-01T00:00:00Z" }), /first-party scheduler/);
    await assert.rejects(publishDirectSocial(env, { ...post, surface: "story" }), /permissions/);
    await assert.rejects(publishDirectSocial(env, { ...post, mediaUrl: "http://localhost/photo.png" }), /HTTPS image/);
  } finally { globalThis.fetch = previous; }
});

test("publishes a Facebook Page photo directly without an intermediary", async () => {
  const { publishDirectSocial } = await directModule();
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init.method, token: init.headers.Authorization, params: new URLSearchParams(init.body) });
    return Response.json({ id: "photo-1", post_id: "123456_99" });
  };
  try {
    const result = await publishDirectSocial(env, post);
    assert.deepEqual(result, { id: "123456_99", channelId: "page-a", status: "sent", dueAt: null });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/123456\/photos$/);
    assert.equal(requests[0].params.get("url"), post.mediaUrl);
    assert.equal(requests[0].params.get("message"), post.text);
    assert.match(requests[0].url, /\/v26\.0\//);
    assert.equal(requests[0].token, "Bearer secret-a");
  } finally { globalThis.fetch = previous; }
});

test("Instagram image publishing creates and verifies a media container before publish", async () => {
  const { publishDirectSocial } = await directModule();
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method || "GET" });
    if (String(url).endsWith("/media")) return Response.json({ id: "container-1" });
    if (String(url).includes("fields=status_code")) return Response.json({ status_code: "FINISHED" });
    if (String(url).endsWith("/media_publish")) return Response.json({ id: "posted-1" });
    throw new Error("Unknown API call");
  };
  try {
    const result = await publishDirectSocial(env, { ...post, channelId: "ig-a", service: "instagram" });
    assert.equal(result.id, "posted-1");
    assert.equal(requests.length, 3);
    assert.match(requests[0].url, /\/media$/);
    assert.match(requests[2].url, /\/media_publish$/);
  } finally { globalThis.fetch = previous; }
});

test("Instagram cannot falsely claim success when its media is still processing", async () => {
  const { publishDirectSocial } = await directModule();
  const previous = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return String(url).endsWith("/media") ? Response.json({ id: "container-1" }) : Response.json({ status_code: "IN_PROGRESS" });
  };
  try {
    await assert.rejects(publishDirectSocial(env, { ...post, channelId: "ig-a", service: "instagram" }), /No publication was confirmed/);
    assert.equal(urls.length, 5);
    assert.equal(urls.filter((url) => url.includes("media_publish")).length, 0);
  } finally { globalThis.fetch = previous; }
});

test("Instagram waits for a ready image container before publishing once", async () => {
  const { publishDirectSocial } = await directModule();
  const previous = globalThis.fetch;
  let checks = 0, published = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/media")) return Response.json({ id: "container-2" });
    if (String(url).includes("fields=status_code")) return Response.json({ status_code: ++checks === 1 ? "IN_PROGRESS" : "FINISHED" });
    if (String(url).endsWith("/media_publish")) { published++; return Response.json({ id: "instagram-post-2" }); }
    throw new Error("Unknown platform request");
  };
  try {
    const result = await publishDirectSocial(env, { ...post, channelId: "ig-a", service: "instagram" });
    assert.equal(checks, 2);
    assert.equal(published, 1);
    assert.equal(result.id, "instagram-post-2");
  } finally { globalThis.fetch = previous; }
});

test("no configured channels or malformed connection storage never initiate Buffer calls", async () => {
  const { publishDirectSocial, listDirectSocialDestinations } = await directModule();
  assert.deepEqual(listDirectSocialDestinations({}), []);
  assert.throws(() => listDirectSocialDestinations({ DIRECT_SOCIAL_CONNECTIONS: "not-json" }), /misconfigured/);
  assert.throws(() => listDirectSocialDestinations({ DIRECT_SOCIAL_CONNECTIONS: JSON.stringify([{...facebook, accountId: "bad"}]) }), /incomplete/);
  await assert.rejects(publishDirectSocial({}, post), /not assigned/);
});
