type BridgeEnvironment = {
  UPWORK_SUBMISSION_BRIDGE_ENABLED?: string;
  UPWORK_SUBMISSION_WEBHOOK_URL?: string;
  UPWORK_SUBMISSION_TOKEN?: string;
};

export type SubmissionBridgeResolution =
  | { mode: "manual"; reason: string }
  | { mode: "error"; error: string }
  | { mode: "enabled"; url: string; token: string };

function safeBridgeUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || !host.includes(".") || host === "localhost" || host.endsWith(".local")
      || host === "::1" || /^(?:127\.|10\.|169\.254\.|192\.168\.)/.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Resolve the deliberately opt-in submission bridge without exposing secrets. */
export function resolveSubmissionBridge(env: BridgeEnvironment, authDisabled: boolean): SubmissionBridgeResolution {
  if (env.UPWORK_SUBMISSION_BRIDGE_ENABLED !== "true") {
    return { mode: "manual", reason: "Automated submission is not enabled" };
  }
  if (authDisabled) return { mode: "manual", reason: "Automated submission is blocked while login is disabled" };
  const url = env.UPWORK_SUBMISSION_WEBHOOK_URL?.trim();
  const token = env.UPWORK_SUBMISSION_TOKEN?.trim();
  if (!url || !token) return { mode: "error", error: "Submission bridge is enabled but its URL or token is missing" };
  const safeUrl = safeBridgeUrl(url);
  if (!safeUrl) return { mode: "error", error: "Submission bridge URL must be a public HTTPS endpoint" };
  return { mode: "enabled", url: safeUrl, token };
}
