import type { AtlasiumTenantIdentity, AtlasiumSsoEnv } from "./atlasium-sso";

type DataEnv = AtlasiumSsoEnv & { DB?: D1Database };
type TenantSummary = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
};

const OWNER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ids(identity: AtlasiumTenantIdentity) {
  if (!OWNER_UUID.test(identity.subject) || identity.subject !== identity.workspaceOwnerId) {
    throw new Error("This workspace identity is not authorized.");
  }
  return {
    workspaceId: "workspace_customer_" + identity.workspaceOwnerId.replace(/-/g, "").toLowerCase(),
    memberId: "user_atlasium_" + identity.subject.replace(/-/g, "").toLowerCase(),
  };
}
function dbOrThrow(env: DataEnv): D1Database {
  if (!env.DB) throw new Error("Customer workspace storage is not available.");
  return env.DB;
}

async function createWorkspaceIfMissing(env: DataEnv, identity: AtlasiumTenantIdentity) {
  const db = dbOrThrow(env);
  const { workspaceId, memberId } = ids(identity);
  const stamp = new Date().toISOString();

  // Tenant ID is derived from the verified Atlasium SSO ticket and signed session.
  // Neither HTTP header nor client input can select another customer's workspace.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)")
      .bind(workspaceId, "Your Atlasium workspace", stamp),
    db.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at) VALUES (?, NULL, ?, ?)")
      .bind(memberId, "Atlasium account", stamp),
    db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .bind(workspaceId, memberId, stamp),
  ]);
  const member = await db.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1",
  ).bind(workspaceId, memberId).first<{ role: string }>();
  if (member?.role !== "owner") throw new Error("Customer workspace membership could not be verified.");
  return { db, workspaceId, memberId };
}

function parseBrand(row: Record<string, unknown>): TenantSummary {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    slug: String(row.slug),
    status: String(row.status),
    timezone: String(row.timezone),
  };
}

export async function customerWorkspace(env: DataEnv, identity: AtlasiumTenantIdentity) {
  const { db, workspaceId } = await createWorkspaceIfMissing(env, identity);
  const list = await db.prepare(
    "SELECT id, workspace_id, name, slug, status, timezone FROM brands WHERE workspace_id = ? AND status != 'archived' ORDER BY created_at DESC LIMIT 100",
  ).bind(workspaceId).all<Record<string, unknown>>();
  return {
    workspace: { id: workspaceId, name: "Your Atlasium workspace", role: "owner" },
    brands: (list.results || []).map(parseBrand),
    channels: [],
    publishingEnabled: false,
    note: "Publishing stays disabled until individual channels and payment usage have been isolated.",
  };
}

/** Draft-only brand setup. Does not connect a social account or publish anything. */
export async function createCustomerBrand(
  env: DataEnv,
  identity: AtlasiumTenantIdentity,
  rawName: string,
) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Enter a brand name between 2 and 120 characters.");
  const { db, workspaceId, memberId } = await createWorkspaceIfMissing(env, identity);
  const count = await db.prepare(
    "SELECT COUNT(*) AS total FROM brands WHERE workspace_id = ? AND status != 'archived'",
  ).bind(workspaceId).first<{ total: number }>();
  if ((count?.total || 0) >= 3) throw new Error("This setup allows three draft brands. Activate an eligible plan for more.");
  const id = "brand_" + crypto.randomUUID();
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55) + "-" + id.slice(-6);
  const stamp = new Date().toISOString();

  await db.batch([
    db.prepare(
      "INSERT INTO brands (id, workspace_id, slug, name, timezone, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
    ).bind(id, workspaceId, slug, name, "America/Toronto", stamp, stamp),
    db.prepare(
      "INSERT INTO brand_profiles (brand_id) VALUES (?)",
    ).bind(id),
    db.prepare(
      "INSERT INTO audit_logs (id, workspace_id, brand_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, 'tenant_draft_brand_created', ?, ?)",
    ).bind("audit_" + crypto.randomUUID(), workspaceId, id, memberId, JSON.stringify({ published: false, channelCount: 0 }), stamp),
  ]);
  return { brand: { id, workspaceId, name, slug, status: "active", timezone: "America/Toronto" }, published: false };
}

/** Confirmed Atlasium entitlements. No shared upload keys are involved. */
export async function customerEntitlement(
  env: DataEnv,
  identity: AtlasiumTenantIdentity,
) {
  ids(identity);
  const secret = (env.ATLASIUM_ECHOFLOW_SHARED_SECRET || "").trim();
  if (secret.length < 48 || !env.ATLASIUM_CORE_API_URL) {
    return { subscribed: false, creditsRemaining: 0, canPublish: false };
  }
  try {
    const url = new URL("/v1/atlasium-echoflow/entitlement", env.ATLASIUM_CORE_API_URL);
    if (url.protocol !== "https:") throw new Error("Invalid internal billing URL");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Atlasium-EchoFlow-Secret": secret },
      body: JSON.stringify({ subject: identity.subject, workspaceOwnerId: identity.workspaceOwnerId }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { subscribed: false, creditsRemaining: 0, canPublish: false };
    const result = await response.json() as {
      data?: { workspaceOwnerId?: string; subscribed?: boolean; canPublish?: boolean; creditsRemaining?: number };
    };
    const grant = result.data;
    if (!grant || grant.workspaceOwnerId !== identity.workspaceOwnerId || grant.subscribed !== true ||
        !Number.isSafeInteger(grant.creditsRemaining) || (grant.creditsRemaining || 0) < 0) {
      return { subscribed: false, creditsRemaining: 0, canPublish: false };
    }
    return { subscribed: true, creditsRemaining: grant.creditsRemaining || 0, canPublish: grant.canPublish === true && (grant.creditsRemaining || 0) > 0 };
  } catch {
    // Never infer paid access from local cookies or a temporarily unreachable CRM.
    return { subscribed: false, creditsRemaining: 0, canPublish: false };
  }
}
