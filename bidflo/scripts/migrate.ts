import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const migrationDir = resolve(process.cwd(), "db/migrations");

async function migrate() {
  try {
    await sql`
      create table if not exists bidflo_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    for (const name of (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort()) {
      const [existing] = await sql`select name from bidflo_migrations where name = ${name}`;
      if (existing) continue;
      const migration = await readFile(resolve(migrationDir, name), "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`insert into bidflo_migrations (name) values (${name})`;
      });
      console.log(`Applied ${name}`);
    }
  } finally {
    await sql.end();
  }
}

// Run without top-level await, so the TSX CommonJS runtime works in Render.
migrate().catch((error: unknown) => {
  console.error("BidFlo migration failed", error);
  process.exitCode = 1;
});
