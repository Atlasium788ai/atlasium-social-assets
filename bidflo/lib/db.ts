import postgres, { type Sql } from "postgres";

let client: Sql | null = null;

export function db(): Sql {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  if (!client) {
    client = postgres(databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return client;
}

export async function audit(
  actor: string,
  action: string,
  entityType: string,
  entityId?: string,
  detail: Record<string, unknown> = {},
) {
  const sql = db();
  await sql`
    insert into bidflo_audit_logs (actor, action, entity_type, entity_id, detail)
    values (${actor}, ${action}, ${entityType}, ${entityId ?? null}, ${sql.json(detail as postgres.JSONValue)})
  `;
}

export async function closeDb() {
  if (client) await client.end();
  client = null;
}
