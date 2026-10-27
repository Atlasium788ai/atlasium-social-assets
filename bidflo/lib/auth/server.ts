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
    (process.env.VISEZ_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAuthDisabled() {
  return process.env.VISEZ_AUTH_DISABLED === "true";
}

function internalTestSession() {
  return { user: { email: process.env.VISEZ_OWNER_EMAIL ?? "info@atlasium788.ca", name: "Visez Operator" } };
}

/** Verified account and allowlist access, except for the explicit internal no-login test mode. */
export async function getAuthenticatedAdminSession() {
  if (isAuthDisabled()) return internalTestSession();
  try {
    const { data } = await getAuth().getSession();
    const email = data?.user?.email?.toLowerCase();
    if (!email || !allowedEmails().has(email)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Temporary no-login operator access remains available only when explicitly configured. */
export async function getAdminSession() {
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
