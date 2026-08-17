export type FlowBrand = { id: string; name: string; logoUrl?: string; timezone: string };

type WorkspaceResponse = { brands?: FlowBrand[]; error?: string };

export async function loadFlowBrands(accessKey: string, signal?: AbortSignal): Promise<FlowBrand[]> {
  const response = await fetch("/api/workspace", { headers: { "X-Upload-Key": accessKey }, signal });
  const data = await response.json() as WorkspaceResponse;
  if (!response.ok) throw new Error(data.error || "Could not load this FLOW workspace.");
  return (data.brands || []).map((brand) => ({ id: brand.id, name: brand.name, logoUrl: brand.logoUrl, timezone: brand.timezone }));
}
