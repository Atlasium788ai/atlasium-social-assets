/** Validate first-party browser requests even when hosting rewrites the internal URL. */
export function isSameOriginMutation(request: Request): boolean {
  let internal: URL;
  try { internal = new URL(request.url); } catch { return false; }

  // The public app URL is the authoritative external origin behind Render's proxy.
  const publicOrigin = (() => {
    const configured = process.env.VISEZ_URL?.trim();
    if (!configured) return null;
    try {
      const url = new URL(configured);
      return url.protocol === "https:" ? url.origin : null;
    } catch { return null; }
  })();

  const firstParty = new Set<string>();
  if (publicOrigin) firstParty.add(publicOrigin);
  else {
    // Local development or standalone deployments without VISEZ_URL.
    if (internal.protocol === "https:" ||
        (internal.protocol === "http:" && ["localhost", "127.0.0.1"].includes(internal.hostname))) {
      firstParty.add(internal.origin);
    }
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
      request.headers.get("host")?.trim();
    if (host && /^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)) {
      const scheme = ["localhost", "127.0.0.1"].some((local) => host === local || host.startsWith(local + ":"))
        ? "http:" : "https:";
      firstParty.add(`${scheme}//${host}`);
    }
  }

  const originHeader = request.headers.get("origin");
  const referrer = request.headers.get("referer");
  if (originHeader || referrer) {
    try {
      const source = new URL(originHeader || referrer!);
      if (!firstParty.has(source.origin)) return false;
      return request.headers.get("sec-fetch-site") !== "cross-site";
    } catch { return false; }
  }
  // Still require real browser provenance when neither Origin nor Referer exists.
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export function mutationForbidden() {
  return Response.json({ error: "Request origin was not verified" }, { status: 403 });
}
