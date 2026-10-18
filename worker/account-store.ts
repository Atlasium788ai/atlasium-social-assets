import { OWNER_ID, WORKSPACE_ID } from "./brand-store";

type AccountEnv = {
  DB?: D1Database;
  UPLOAD_KEY?: string;
  AUTHORIZED_USER_EMAILS?: string;
};

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export type WorkspaceAccount = {
  authenticated: true;
  user: { id: string; email: string | null; displayName: string };
  workspace: { id: string; name: string; role: WorkspaceRole };
};

const value = (input: unknown) => String(input || "").trim();

function allowedEmails(env: AccountEnv) {
  return (env.AUTHORIZED_USER_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
}

function safeDisplayName(request: Request, email: string) {
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (encoded && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { return decodeURIComponent(encoded).slice(0, 120); }
    catch { /* Use the verified email below. */ }
  }
  return email;
}

function requestedIdentity(request: Request) {
  const id = value(request.headers.get("oai-authenticated-user-id"));
  const email = value(request.headers.get("oai-authenticated-user-email")).toLowerCase();
  if (!id || !email) return null;
  return { id, email, displayName: safeDisplayName(request, email) };
}

export async function resolveWorkspaceAccount(request: Request, env: AccountEnv): Promise<WorkspaceAccount | null> {
  const sharedKeyMatches = Boolean(env.UPLOAD_KEY && request.headers.get("X-Upload-Key") === env.UPLOAD_KEY);
  const identity = requestedIdentity(request);
  const allowlist = allowedEmails(env);
  if (!sharedKeyMatches && (!identity || !allowlist.includes(identity.email))) return null;

  const ownerEmail = allowlist[0] || null;
  const user = identity || { id: OWNER_ID, email: ownerEmail, displayName: "Atlasium owner" };
  const requestedRole: WorkspaceRole = user.email && user.email === ownerEmail ? "owner" : "editor";
  let role = requestedRole;

  if (env.DB) {
    const createdAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").bind(WORKSPACE_ID, "EchoFlow Social", createdAt),
      env.DB.prepare("INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name")
        .bind(user.id, user.email, user.displayName, createdAt),
      env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = CASE WHEN workspace_members.role = 'owner' THEN 'owner' ELSE excluded.role END")
        .bind(WORKSPACE_ID, user.id, requestedRole, createdAt),
    ]);
    const membership = await env.DB.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1")
      .bind(WORKSPACE_ID, user.id).first<Record<string, unknown>>();
    const storedRole = value(membership?.role);
    if (["owner", "admin", "editor", "viewer"].includes(storedRole)) role = storedRole as WorkspaceRole;
  }

  return { authenticated: true, user, workspace: { id: WORKSPACE_ID, name: "EchoFlow Social", role } };
}

export async function accountSnapshot(request: Request, env: AccountEnv) {
  const account = await resolveWorkspaceAccount(request, env);
  if (!account) return null;

  let members: Array<{ id: string; email: string | null; displayName: string; role: string }> = [];
  if (env.DB) {
    const result = await env.DB.prepare(`SELECT u.id, u.email, u.display_name AS displayName, m.role
      FROM workspace_members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.display_name`)
      .bind(account.workspace.id).all<Record<string, unknown>>();
    members = (result.results || []).map((row) => ({
      id: value(row.id),
      email: value(row.email) || null,
      displayName: value(row.displayName) || value(row.email) || "Team member",
      role: value(row.role) || "viewer",
    }));
  }

  return {
    ...account,
    members,
    permissions: {
      manageWorkspace: account.workspace.role === "owner" || account.workspace.role === "admin",
      createContent: account.workspace.role !== "viewer",
      scheduleContent: account.workspace.role !== "viewer",
      manageConnections: account.workspace.role === "owner" || account.workspace.role === "admin",
    },
    productAccess: ["ECHO", "FLOW", "AMPLIFY"],
  };
}
