export type AmplifyProviderId = "meta" | "google_ads" | "linkedin" | "tiktok" | "x" | "pinterest" | "snapchat" | "bluesky";
export type AmplifyConnectionStatus = "approval_pending" | "ready_to_connect" | "advertising_permission_required" | "connected" | "reconnect_required" | "needs_attention" | "not_available" | "coming_later" | "mock_connection";
export type AmplifyGoal = "leads" | "bookings" | "calls_messages" | "website_sales" | "website_traffic" | "awareness" | "promote_post";
export type AmplifyBudgetType = "daily" | "lifetime";
export type AmplifyCampaignStatus = "draft" | "ready_for_review" | "dry_test_passed" | "submission_pending" | "submitted_to_platform" | "under_platform_review" | "approved" | "scheduled" | "active" | "paused" | "rejected" | "completed" | "failed";

export type AmplifyBrand = {
  id: string;
  name: string;
  logoUrl?: string;
  timezone: string;
  industry?: string;
  location?: string;
  mainOffers?: string;
  targetAudience?: string;
  primaryCta?: string;
};

export type AmplifyCreativeSource = {
  id: string;
  brandId: string;
  sourceType: "echo_asset" | "flow_post" | "brand_asset" | "uploaded_image" | "uploaded_video" | "motion_asset" | "organic_post";
  label: string;
  mediaType: "image" | "video" | "post";
  url?: string;
  detail?: string;
  originalId?: string;
};

export type AmplifyAudience = {
  location: string;
  summary: string;
  ageMin: number;
  ageMax: number;
  interests: string;
  restrictedCategory: "none" | "housing" | "employment" | "credit" | "financial_services" | "politics";
};

export type AmplifySchedule = {
  startAt: string;
  endAt: string;
  timezone: string;
};

export type AmplifyBudget = {
  type: AmplifyBudgetType;
  amount: number;
  currency: "CAD" | "USD" | "GBP" | "EUR" | "AUD";
  maximumSpend: number;
};

export type AmplifyVariation = {
  providerId: AmplifyProviderId;
  headline: string;
  body: string;
  callToAction: string;
  placement: string;
  format: string;
  mediaSourceId: string;
  manuallyEdited?: boolean;
};

export type AmplifyDraftPayload = {
  prompt: string;
  campaignName: string;
  offer: string;
  goal: AmplifyGoal;
  destinationType: "website" | "landing_page" | "lead_form" | "booking_page" | "phone" | "messages" | "app" | "existing_post";
  destination: string;
  callToAction: string;
  creativeSource: AmplifyCreativeSource;
  audience: AmplifyAudience;
  providerIds: AmplifyProviderId[];
  budget: AmplifyBudget;
  schedule: AmplifySchedule;
  trackingSourceId?: string;
  variations: AmplifyVariation[];
  explicitConfirmation: boolean;
};

export type AmplifyDraft = {
  id: string;
  brandId: string;
  name: string;
  status: AmplifyCampaignStatus;
  prompt: string;
  payload: AmplifyDraftPayload;
  revision: number;
  createdAt: string;
  updatedAt: string;
  platformStatuses: Array<{ providerId: AmplifyProviderId; status: AmplifyCampaignStatus; detail: string }>;
};

export type AmplifyFeatureFlags = {
  interfaceEnabled: boolean;
  dryRunEnabled: boolean;
  liveSubmissionEnabled: boolean;
};

export type AmplifyWorkspaceData = {
  brands: AmplifyBrand[];
  activeBrand: AmplifyBrand;
  creativeSources: AmplifyCreativeSource[];
  drafts: AmplifyDraft[];
  featureFlags: AmplifyFeatureFlags;
};

export type AmplifyDryTestResult = {
  id: string;
  draftId: string;
  brandId: string;
  status: "dry_test_passed" | "validation_failed";
  validationStatus: "Basic Validation Passed" | "Requires Compliance Review" | "Validation Failed";
  checks: Array<{ label: string; status: "passed" | "failed" | "review"; detail: string }>;
  duplicate: boolean;
  createdAt: string;
};
