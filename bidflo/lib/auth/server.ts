import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";

export function getAuth() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret) throw new Error("Neon Auth is not configured");
  return createNeonAuth({ baseUrl, cookies: { secret } });
}

function allowedEmails() {
  return new Set(
    (process.env.BIDFLO_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAuthDisabled() {
  return process.env.BIDFLO_AUTH_DISABLED === "true";
}

/** Verified account and allowlist access. Never bypass for API calls or private data. */
export async function getAuthenticatedAdminSession() {
  try {
    const { data } = await getAuth().getSession();
    const email = data?.user?.email?.toLowerCase();
    if (!email || !allowedEmails().has(email)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Temporary public browsing remains possible, but it does not grant write access. */
export async function getAdminSession() {
  if (isAuthDisabled()) {
    return { user: { email: process.env.BIDFLO_OWNER_EMAIL ?? "info@atlasium788.ca", name: "Visez Preview" } };
  }
  return getAuthenticatedAdminSession();
}

export async function requireAdminSession() {
  const session = await getAuthenticatedAdminSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export function unauthorizedResponse() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
