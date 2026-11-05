import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type AtlasiumSsoEnv = {
  ATLASIUM_ECHOFLOW_SSO_ENABLED?: string;
  ATLASIUM_ECHOFLOW_OWNER_SUBJECT?: string;
  ATLASIUM_ECHOFLOW_SHARED_SECRET?: string;
  ATLASIUM_ECHOFLOW_SESSION_SECRET?: string;
  ATLASIUM_CORE_FRONTEND_URL?: string;
  ATLASIUM_CORE_API_URL?: string;
  ATLASIUM_ECHOFLOW_PUBLIC_URL?: string;
};
type Setup = { subject: string; sharedSecret: string; sessionSecret: string; frontend: URL; backend: URL; publicOrigin: string };
type Verified = { subject: string; nonce: string; workspaceId: string; emailVerified: true };
const OWNER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9_-]{40,128}$/;
const SESSION_AGE_SEC = 12 * 60 * 60;
const NONCE_AGE_SEC = 3 * 60;
const NONCE_COOKIE = "__Host-atlasium-echo-nonce";
const SESSION_COOKIE = "__Host-atlasium-echo-session";

function configured(env: AtlasiumSsoEnv, request: Request): Setup | null {
  if (env.ATLASIUM_ECHOFLOW_SSO_ENABLED !== "true") return null;
  const subject = (env.ATLASIUM_ECHOFLOW_OWNER_SUBJECT || "").trim().toLowerCase();
  const sharedSecret = (env.ATLASIUM_ECHOFLOW_SHARED_SECRET || "").trim();
  const sessionSecret = (env.ATLASIUM_ECHOFLOW_SESSION_SECRET || "").trim();
  if (!OWNER_UUID.test(subject) || sharedSecret.length < 48 || sessionSecret.length < 48 || sharedSecret === sessionSecret) return null;
  try {
    const frontend = new URL(env.ATLASIUM_CORE_FRONTEND_URL || "");
    const backend = new URL(env.ATLASIUM_CORE_API_URL || "");
    const publicSite = new URL(env.ATLASIUM_ECHOFLOW_PUBLIC_URL || "");
    const expected = new URL(request.url);
    for (const url of [frontend, backend, publicSite]) {
      if (url.protocol !== "https:" || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash) return null;
    }
    if (expected.protocol !== "https:" || expected.origin !== publicSite.origin) return null;
    return { subject, sharedSecret, sessionSecret, frontend, backend, publicOrigin: publicSite.origin };
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string {
  const raw = request.headers.get("Cookie") || "";
  const found = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
  if (!found) return "";
  try { return decodeURIComponent(found.slice(name.length + 1)); }
  catch { return ""; }
}
function hostCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearHostCookie(name: string): string {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
function equal(a: string, b: string) {
  if (!a || !b) return false;
  const one = Buffer.from(a), two = Buffer.from(b);
  return one.length === two.length && timingSafeEqual(one, two);
}
function mac(secret: string, message: string) {
  return createHmac("sha256", secret).update("atlasium-echoflow-session:v1:").update(message).digest("base64url");
}
function signSession(cfg: Setup, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: cfg.subject, exp: now + SESSION_AGE_SEC * 1000 }), "utf8").toString("base64url");
  return `${payload}.${mac(cfg.sessionSecret, payload)}`;
}
function verifiedSession(request: Request, cfg: Setup, now = Date.now()) {
  const parts = readCookie(request, SESSION_COOKIE).split(".");
  if (parts.length !== 2 || parts[0].length > 1024 || parts[1].length > 200 ||
      !equal(mac(cfg.sessionSecret, parts[0]), parts[1])) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { v?: number; sub?: string; exp?: number };
    return payload.v === 1 && payload.sub === cfg.subject && typeof payload.exp === "number" &&
      payload.exp > now && payload.exp <= now + SESSION_AGE_SEC * 1000;
  } catch { return false; }
}

const privateHeaders = { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

/** No secrets or customer identifiers are returned to the public landing screen. */
export function atlasiumOwnerBridgeAvailable(request: Request, env: AtlasiumSsoEnv) {
  return configured(env, request) !== null;
}

export function hasAtlasiumOwnerSession(request: Request, env: AtlasiumSsoEnv): boolean {
  const cfg = configured(env, request);
  return !!cfg && verifiedSession(request, cfg);
}

export function atlasiumOwnerActor(request: Request, env: AtlasiumSsoEnv): string | null {
  const cfg = configured(env, request);
  return cfg && verifiedSession(request, cfg) ? `atlasium:${cfg.subject}` : null;
}

async function exchange(cfg: Setup, ticket: string): Promise<Verified | null> {
  const url = new URL("/v1/atlasium-echoflow/exchange", cfg.backend);
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Atlasium-EchoFlow-Secret": cfg.sharedSecret },
    body: JSON.stringify({ ticket }), cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) return null;
  const envelope = await response.json() as { data?: Partial<Verified> };
  const data = envelope.data;
  if (data?.subject !== cfg.subject || data?.workspaceId !== cfg.subject ||
      data?.emailVerified !== true || typeof data.nonce !== "string" || !B64.test(data.nonce)) return null;
  return data as Verified;
}

/**
 * A single existing Atlasium owner can enter the CURRENT EchoFlow workspace.
 * Other customers intentionally cannot access this workspace until per-tenant
 * D1 workspace isolation and billing entitlements have been implemented.
 */
export async function handleAtlasiumSso(request: Request, env: AtlasiumSsoEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/auth/atlasium/")) return new Response("Not found", { status: 404 });
  const cfg = configured(env, request);
  if (!cfg) return new Response("Atlasium EchoFlow sign-in is not configured.", { status: 503, headers: privateHeaders });

  if (url.pathname === "/auth/atlasium/start" && request.method === "GET") {
    const nonce = randomBytes(36).toString("base64url");
    const target = new URL("/core/echoflow/continue", cfg.frontend);
    target.searchParams.set("nonce", nonce);
    const headers = new Headers({ ...privateHeaders, Location: target.toString() });
    headers.append("Set-Cookie", hostCookie(NONCE_COOKIE, nonce, NONCE_AGE_SEC));
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === "/auth/atlasium/finish" && request.method === "GET") {
    const code = url.searchParams.get("ticket") || "";
    const state = readCookie(request, NONCE_COOKIE);
    const headers = new Headers(privateHeaders);
    headers.append("Set-Cookie", clearHostCookie(NONCE_COOKIE));
    if (!B64.test(code) || !B64.test(state)) {
      return new Response("The sign-in link is invalid or expired. Return to Atlasium Core.", { status: 400, headers });
    }
    try {
      const identity = await exchange(cfg, code);
      if (!identity || !equal(identity.nonce, state)) {
        return new Response("Atlasium account verification failed.", { status: 403, headers });
      }
      headers.set("Location", new URL("/echo", cfg.publicOrigin).toString());
      headers.append("Set-Cookie", hostCookie(SESSION_COOKIE, signSession(cfg), SESSION_AGE_SEC));
      return new Response(null, { status: 303, headers });
    } catch {
      return new Response("Sign-in could not be verified. Return to Atlasium Core.", { status: 401, headers });
    }
  }

  if (url.pathname === "/auth/atlasium/logout" && (request.method === "GET" || request.method === "POST")) {
    const headers = new Headers(privateHeaders);
    if (request.method === "GET") headers.set("Location", new URL("/echo", cfg.publicOrigin).toString());
    headers.append("Set-Cookie", clearHostCookie(SESSION_COOKIE));
    headers.append("Set-Cookie", clearHostCookie(NONCE_COOKIE));
    return new Response(null, { status: request.method === "POST" ? 204 : 303, headers });
  }
  return new Response("Method not allowed", { status: 405, headers: privateHeaders });
}
