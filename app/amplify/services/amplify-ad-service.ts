import type { AmplifyCreativeSource, AmplifyDraft, AmplifyDraftPayload, AmplifyDryTestResult, AmplifyWorkspaceData } from "../types";

type ApiError = { error?: string };

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

function headers(accessKey: string, brandId: string, json = false) {
  return { "X-Upload-Key": accessKey, "X-Brand-ID": brandId, ...(json ? { "Content-Type": "application/json" } : {}) };
}

export async function loadAmplifyWorkspace(accessKey: string, brandId: string, signal?: AbortSignal) {
  const response = await fetch("/api/amplify/workspace", { headers: headers(accessKey, brandId), signal });
  return readJson<AmplifyWorkspaceData>(response, "Could not load this AMPLIFY workspace.");
}

export async function prepareAmplifyDraft(accessKey: string, brandId: string, input: Omit<AmplifyDraftPayload, "campaignName" | "variations" | "explicitConfirmation">) {
  const response = await fetch("/api/amplify/drafts", { method: "POST", headers: headers(accessKey, brandId, true), body: JSON.stringify({ ...input, brandId }) });
  return (await readJson<{ draft: AmplifyDraft }>(response, "Could not prepare this advertising draft.")).draft;
}

export async function updateAmplifyDraft(accessKey: string, brandId: string, draftId: string, payload: Partial<AmplifyDraftPayload>) {
  const response = await fetch(`/api/amplify/drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", headers: headers(accessKey, brandId, true), body: JSON.stringify({ brandId, payload }) });
  return (await readJson<{ draft: AmplifyDraft }>(response, "Could not update this advertising draft.")).draft;
}

export async function uploadAmplifyCreative(accessKey: string, brandId: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/amplify/assets", { method: "POST", headers: headers(accessKey, brandId), body: form });
  return (await readJson<{ asset: AmplifyCreativeSource }>(response, "Could not upload this creative.")).asset;
}

export async function runAmplifyDryTest(accessKey: string, brandId: string, draftId: string, idempotencyKey: string, confirmed: boolean) {
  const response = await fetch("/api/amplify/dry-test", { method: "POST", headers: headers(accessKey, brandId, true), body: JSON.stringify({ brandId, draftId, idempotencyKey, confirmed }) });
  return (await readJson<{ result: AmplifyDryTestResult }>(response, "The AMPLIFY dry test failed.")).result;
}

export async function attemptLiveAmplifySubmission(accessKey: string, brandId: string, draftId: string) {
  const response = await fetch("/api/amplify/launch", { method: "POST", headers: headers(accessKey, brandId, true), body: JSON.stringify({ brandId, draftId }) });
  return readJson<never>(response, "Live advertising submission is disabled.");
}
