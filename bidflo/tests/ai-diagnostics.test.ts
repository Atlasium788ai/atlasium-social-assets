import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseAiProvider } from "../lib/ai-diagnostics";

const env = { AI_API_KEY: "private-test-secret", AI_MODEL: "gpt-5-mini" };

test("AI diagnostic classifies forbidden credentials without printing secret", async () => {
  let method = "";
  const fetcher = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    method = init?.method ?? "";
    return new Response("Forbidden: private-token-value", { status: 403 });
  }) as typeof fetch;
  const result = await diagnoseAiProvider(env, fetcher);
  assert.equal(method, "GET");
  assert.equal(result.httpStatus, 403);
  assert.equal(result.fault, "forbidden");
  assert.equal(JSON.stringify(result).includes("private-test-secret"), false);
  assert.equal(JSON.stringify(result).includes("private-token-value"), false);
});

test("AI diagnostic can distinguish unlisted model from an unusable key", async () => {
  const fetcher = (async () => Response.json({ data: [
    { id: "gpt-4o-mini" }, { id: "gpt-5-mini" }, { id: "text-embedding-3-small" },
  ] })) as typeof fetch;
  const result = await diagnoseAiProvider({ ...env, AI_MODEL: "unlisted-model" }, fetcher);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.modelListed, false);
  assert.equal(result.fault, "model_unlisted");
  assert.deepEqual(result.suggestedModels, ["gpt-4o-mini", "gpt-5-mini"]);
});

test("AI diagnostic refuses insecure base URLs without making network requests", async () => {
  const fetcher = (async () => { throw new Error("No request should be made"); }) as typeof fetch;
  const result = await diagnoseAiProvider({ ...env, AI_API_BASE_URL: "http://insecure.internal/v1" }, fetcher);
  assert.equal(result.configured, true);
  assert.equal(result.fault, "missing_config");
  assert.equal(result.httpStatus, null);
});

test("AI diagnostics honors an existing OPENAI_API_KEY environment variable", async () => {
  let tokenHeader = "";
  const fetcher = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    tokenHeader = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    return Response.json({ data: [{ id: "gpt-5-mini" }] });
  }) as typeof fetch;
  const result = await diagnoseAiProvider(
    { AI_API_KEY: "", OPENAI_API_KEY: "alias-test-key", AI_MODEL: "gpt-5-mini" },
    fetcher,
  );
  assert.equal(tokenHeader, "Bearer alias-test-key");
  assert.equal(result.configured, true);
  assert.equal(result.fault, null);
  assert.equal(JSON.stringify(result).includes("alias-test-key"), false);
});
