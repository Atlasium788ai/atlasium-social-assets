/**
 * Reduces cross-site browser request forgery during the temporary no-login
 * pilot. This is not authentication: a server-side caller can forge headers.
 */
export function isSameOriginMutation(request: Request): boolean {
  let target: URL;
  try { target = new URL(request.url); } catch { return false; }
  const supplied = request.headers.get("origin") ?? request.headers.get("referer");
  if (supplied) {
    try {
      const source = new URL(supplied);
      const expectedTls = target.hostname === "localhost" || target.hostname === "127.0.0.1"
        ? target.protocol
        : "https:";
      return source.host === target.host && source.protocol === expectedTls;
    } catch { return false; }
  }
  // Browser fetches send Sec-Fetch-Site. A missing header plus missing
  // Origin/Referer must NOT grant anonymous mutation access.
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export function mutationForbidden() {
  return Response.json({ error: "Request origin was not verified" }, { status: 403 });
}
