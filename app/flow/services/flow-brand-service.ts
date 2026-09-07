export type FlowBrand = { id: string; name: string; logoUrl?: string; timezone: string };

export type FlowChannel = {
  id: string;
  brandId: string;
  providerId: "facebook" | "instagram" | "linkedin" | "tiktok";
  providerChannelId: string;
  accountName: string;
  accountType: string;
  status: "connected" | "needs_attention";
};

export type FlowPublishJob = {
  id: string;
  campaignId: string;
  postId: string;
  destinationId: string;
  scheduledTime: string;
  provider: string;
  providerPostId: string;
  status: string;
  error: string;
  concept: string;
  service: string;
  accountName: string;
  providerStatus: string;
  publicUrl: string;
  deliveryError: string;
  checkedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type FlowWorkspaceData = {
  brand: FlowBrand;
  channels: FlowChannel[];
  jobs: FlowPublishJob[];
  reconciliation: { checked: number; sent: number; failed: number; pending: number };
  refreshError?: string;
};

type WorkspaceResponse = { brands?: FlowBrand[]; error?: string };

export async function loadFlowBrands(accessKey: string, signal?: AbortSignal): Promise<FlowBrand[]> {
  const response = await fetch("/api/workspace", { headers: { "X-Upload-Key": accessKey }, signal });
  const data = await response.json() as WorkspaceResponse;
  if (!response.ok) throw new Error(data.error || "Could not load this FLOW workspace.");
  return (data.brands || []).map((brand) => ({ id: brand.id, name: brand.name, logoUrl: brand.logoUrl, timezone: brand.timezone }));
}

export async function loadFlowWorkspace(accessKey: string, brandId: string, signal?: AbortSignal): Promise<FlowWorkspaceData> {
  const response = await fetch("/api/flow/workspace", { headers: { "X-Upload-Key": accessKey, "X-Brand-ID": brandId }, signal });
  const data = await response.json() as FlowWorkspaceData & { error?: string };
  if (!response.ok) throw new Error(data.error || "Could not load this FLOW workspace.");
  return data;
}
