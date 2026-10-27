import type { FlowPlatformId } from "./flow-connection-service";

export type FlowBrand = { id: string; name: string; logoUrl?: string; timezone: string };

export type FlowChannel = {
  id: string;
  brandId: string;
  providerId: FlowPlatformId;
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

export type FlowAvailableAccount = {
  id: string;
  name?: string;
  displayName?: string;
  service: string;
  assignedBrandId: string | null;
  assignedBrandName: string | null;
};

export type FlowWorkspaceData = {
  brand: FlowBrand;
  channels: FlowChannel[];
  availableAccounts?: FlowAvailableAccount[];
  publishingConnectionStatus?: "connected" | "not_configured" | "unavailable";
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

export async function saveFlowAccountAssignments(accessKey: string, brandId: string, channelIds: string[]) {
  const response = await fetch("/api/flow/channels/assign", {
    method: "POST",
    headers: { "X-Upload-Key": accessKey, "Content-Type": "application/json", "X-Brand-ID": brandId },
    body: JSON.stringify({ brandId, channelIds }),
  });
  const data = await response.json() as { error?: string; assignedChannels?: string[] };
  if (!response.ok) throw new Error(data.error || "Could not save this brand's social accounts.");
  return data;
}
