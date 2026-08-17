import type { AmplifyDraft, AmplifyProviderId } from "../types";

export interface AmplifyAdvertisingAdapter {
  beginAuthorization(brandId: string): Promise<{ authorizationUrl: string }>;
  completeAuthorization(brandId: string, code: string, state: string): Promise<void>;
  listAdvertisingAccounts(brandId: string): Promise<readonly unknown[]>;
  listIdentities(brandId: string, accountId: string): Promise<readonly unknown[]>;
  listTrackingSources(brandId: string, accountId: string): Promise<readonly unknown[]>;
  validateCampaign(draft: AmplifyDraft): Promise<readonly string[]>;
  previewCampaignPayload(draft: AmplifyDraft): Promise<unknown>;
  submitCampaign(draft: AmplifyDraft, idempotencyKey: string): Promise<never>;
  fetchPlatformStatus(brandId: string, campaignId: string): Promise<unknown>;
  pauseCampaign(brandId: string, campaignId: string): Promise<never>;
  resumeCampaign(brandId: string, campaignId: string): Promise<never>;
  endCampaign(brandId: string, campaignId: string): Promise<never>;
  fetchReportingMetrics(brandId: string, campaignId: string): Promise<readonly unknown[]>;
}

export type AmplifyAdapterRegistry = Readonly<Partial<Record<AmplifyProviderId, AmplifyAdvertisingAdapter>>>;

export const amplifyAdvertisingAdapters: AmplifyAdapterRegistry = Object.freeze({});
