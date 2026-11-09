import { loadVisezCoreSummary, verifyCoreReadToken } from "@/lib/core-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Vary": "Authorization",
  };
}

export async function GET(request: Request) {
  const authorization = verifyCoreReadToken(
    request.headers.get("authorization"),
    process.env.ATLASIUM_CORE_READ_TOKEN,
  );
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.error },
      { status: authorization.status, headers: noStoreHeaders() },
    );
  }

  try {
    return Response.json(await loadVisezCoreSummary(), { headers: noStoreHeaders() });
  } catch (error) {
    console.error("Visez Core summary failed", error instanceof Error ? error.name : "Unknown");
    return Response.json(
      { error: "Core summary unavailable" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}
