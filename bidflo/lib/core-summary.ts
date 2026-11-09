import { createHash, timingSafeEqual } from "node:crypto";
import type { Sql } from "postgres";
import { db } from "./db";
import type { OpportunityStatus } from "./types";

export const VISEZ_CORE_SUMMARY_SCHEMA = "visez.internal.summary.v1" as const;
export const VISEZ_CORE_OPERATIONS_SCOPE = "atlasium_internal_ops" as const;
export const VISEZ_CORE_STATUSES = [
  "new",
  "rejected",
  "qualified",
  "proposal_ready",
  "approved",
  "ready_to_submit",
  "submission_processing",
  "submitted",
  "replied",
  "interviewed",
  "won",
  "nurture",
  "opted_out",
  "lost",
] as const satisfies readonly OpportunityStatus[];

type StatusCountRow = {
  status: unknown;
  count: unknown;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function verifyCoreReadToken(authorization: string | null, configuredToken: string | undefined) {
  const configured = configuredToken ?? "";
  if (configured.length < 32) return { ok: false as const, status: 503, error: "Core read access is not configured" };
  const supplied = authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? "";
  if (!supplied) return { ok: false as const, status: 401, error: "Core read token required" };
  if (!timingSafeEqual(digest(supplied), digest(configured))) {
    return { ok: false as const, status: 403, error: "Core read token invalid" };
  }
  return { ok: true as const };
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function buildVisezCoreSummary(rows: readonly StatusCountRow[], now = new Date()) {
  const statusCounts = Object.fromEntries(VISEZ_CORE_STATUSES.map((status) => [status, 0])) as Record<OpportunityStatus, number>;
  const seen = new Set<OpportunityStatus>();
  for (const row of rows) {
    const status = row?.status;
    const count = row?.count;
    if (typeof status !== "string" ||
        !VISEZ_CORE_STATUSES.includes(status as OpportunityStatus) ||
        seen.has(status as OpportunityStatus) ||
        !isCount(count)) {
      throw new Error("Invalid Visez status aggregate");
    }
    const typedStatus = status as OpportunityStatus;
    seen.add(typedStatus);
    statusCounts[typedStatus] = count;
  }
  const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  if (!isCount(total)) throw new Error("Unsafe Visez aggregate total");

  return {
    schema: VISEZ_CORE_SUMMARY_SCHEMA,
    operationsScopeId: VISEZ_CORE_OPERATIONS_SCOPE,
    checkedAt: now.toISOString(),
    statusCounts,
  };
}

export async function loadVisezCoreSummary(sql: Sql = db(), now = new Date()) {
  const rows = await sql<Array<{ status: string; count: number }>>`
    select status, count(*)::int as count
    from bidflo_opportunities
    group by status
  `;
  return buildVisezCoreSummary(rows, now);
}
