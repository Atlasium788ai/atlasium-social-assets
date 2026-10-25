type AIEnvironment = Record<string, string | undefined>;
type ModelListResponse = { data?: Array<{ id?: unknown }> };

export type AIProbeResult = {
  checkedAt: string;
  configured: boolean;
  endpoint: "model_catalog";
  httpStatus: number | null;
  providerReachable: boolean;
  selectedModel: string | null;
  modelListed: boolean | null;
  suggestedModels: string[];
  fault: "missing_config" | "unauthorized" | "forbidden" | "rate_limited" | "provider_error" | "model_unlisted" | "catalog_unavailable" | null;
};

/** Read-only, no-token-spend probe. Never logs URLs, tokens or provider error bodies. */
export async function diagnoseAiProvider(
  env: AIEnvironment = process.env,
  fetcher: typeof fetch = fetch,
): Promise<AIProbeResult> {
  const checkedAt = new Date().toISOString();
  const key = env.AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim() || null;
  const rawBase = env.AI_API_BASE_URL?.trim() || "https://api.openai.com/v1";
  const initial: AIProbeResult = {
    checkedAt, configured: Boolean(key && model), endpoint: "model_catalog",
    httpStatus: null, providerReachable: false, selectedModel: model,
    modelListed: null, suggestedModels: [], fault: null,
  };
  if (!key || !model) return { ...initial, fault: "missing_config" };
  let base: URL;
  try {
    base = new URL(rawBase.replace(/\/$/, "") + "/");
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("unsafe");
  } catch { return { ...initial, fault: "missing_config" }; }
  try {
    const response = await fetcher(new URL("models", base), {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const status = response.status;
    if (!response.ok) {
      return { ...initial, httpStatus: status, providerReachable: true,
        fault: status === 401 ? "unauthorized" : status === 403 ? "forbidden"
          : status === 429 ? "rate_limited" : status >= 500 ? "provider_error" : "catalog_unavailable" };
    }
    const payload = await response.json() as ModelListResponse;
    const models = Array.isArray(payload.data)
      ? payload.data.map(x => x.id).filter((x): x is string => typeof x === "string")
      : [];
    const suggestions = models
      .filter(id => /^(?:gpt-|o[134]-)/i.test(id) && !/audio|image|realtime|transcri|search|codex/i.test(id))
      .slice(0, 12);
    const listed = models.length > 0 ? models.includes(model) : null;
    return { ...initial, httpStatus: status, providerReachable: true,
      modelListed: listed, suggestedModels: suggestions,
      fault: listed === false ? "model_unlisted" : null };
  } catch {
    return { ...initial, fault: "provider_error" };
  }
}
