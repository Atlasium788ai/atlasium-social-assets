import type { IconType } from "react-icons";
import { FaBluesky, FaFacebookF, FaGoogle, FaInstagram, FaLinkedinIn, FaPinterestP, FaSnapchat, FaThreads, FaTiktok, FaXTwitter, FaYoutube } from "react-icons/fa6";
import type { AmplifyConnectionStatus, AmplifyGoal, AmplifyProviderId } from "../types";

export type AmplifyProviderCapability = {
  providerId: AmplifyProviderId;
  displayName: string;
  Icon: IconType;
  companionIcons: readonly IconType[];
  surfaces: readonly string[];
  advertisingAvailable: boolean;
  appApprovalStatus: "pending" | "not_available";
  connectionStatus: AmplifyConnectionStatus;
  requiredPermissions: readonly string[];
  supportedGoals: readonly AmplifyGoal[];
  supportedCreativeFormats: readonly string[];
  supportedPlacements: readonly string[];
  supportedDestinations: readonly string[];
  supportedAudienceOptions: readonly string[];
  supportedBudgetTypes: readonly ("daily" | "lifetime")[];
  supportedSchedulingOptions: readonly string[];
  supportedTrackingTypes: readonly string[];
  organicPostPromotion: boolean;
  requiredAccountTypes: readonly string[];
  featureFlag: string;
  visible: boolean;
  oauthEnabled: false;
  liveSubmissionEnabled: false;
  unavailableReason: string;
};

const commonGoals: readonly AmplifyGoal[] = ["leads", "bookings", "calls_messages", "website_sales", "website_traffic", "awareness", "promote_post"];
const budgets = ["daily", "lifetime"] as const;

export const AMPLIFY_PROVIDER_CAPABILITIES: readonly AmplifyProviderCapability[] = Object.freeze([
  { providerId: "meta", displayName: "Meta Ads", Icon: FaFacebookF, companionIcons: [FaInstagram, FaThreads], surfaces: ["Facebook", "Instagram", "Threads when officially available"], advertisingAvailable: true, appApprovalStatus: "pending", connectionStatus: "approval_pending", requiredPermissions: ["Advertising account access", "Page and identity access"], supportedGoals: commonGoals, supportedCreativeFormats: ["Single image", "Video", "Reels", "Stories", "Carousel", "Lead form", "Catalogue"], supportedPlacements: ["Feed", "Stories", "Reels", "Audience Network when supported"], supportedDestinations: ["Website", "Lead form", "Messages", "App", "Existing post"], supportedAudienceOptions: ["Location", "Interests", "Custom audience", "Retargeting"], supportedBudgetTypes: budgets, supportedSchedulingOptions: ["Start and end", "Time zone"], supportedTrackingTypes: ["Meta Pixel or Dataset"], organicPostPromotion: true, requiredAccountTypes: ["Meta business", "Advertising account", "Page or identity"], featureFlag: "amplify_meta", visible: true, oauthEnabled: false, liveSubmissionEnabled: false, unavailableReason: "EchoFlow application approval is pending. No advertising permission is active." },
  { providerId: "google_ads", displayName: "Google Ads", Icon: FaGoogle, companionIcons: [FaYoutube], surfaces: ["Search", "Display", "YouTube", "Maps and local placements"], advertisingAvailable: true, appApprovalStatus: "pending", connectionStatus: "approval_pending", requiredPermissions: ["Google Ads account access", "Business assets when selected"], supportedGoals: ["leads", "bookings", "calls_messages", "website_sales", "website_traffic", "awareness"], supportedCreativeFormats: ["Search text", "Responsive display", "Video", "Performance Max assets", "Shopping assets"], supportedPlacements: ["Search", "Display", "YouTube", "Maps where supported"], supportedDestinations: ["Website", "Landing page", "Phone", "App"], supportedAudienceOptions: ["Location", "Keywords", "Audience segments", "Customer lists"], supportedBudgetTypes: budgets, supportedSchedulingOptions: ["Start and end", "Ad schedule", "Time zone"], supportedTrackingTypes: ["Google conversion action", "Google Tag"], organicPostPromotion: false, requiredAccountTypes: ["Google Ads account"], featureFlag: "amplify_google_ads", visible: true, oauthEnabled: false, liveSubmissionEnabled: false, unavailableReason: "Google Ads authorization and application review are not enabled." },
  { providerId: "linkedin", displayName: "LinkedIn Ads", Icon: FaLinkedinIn, companionIcons: [], surfaces: ["LinkedIn"], advertisingAvailable: true, appApprovalStatus: "pending", connectionStatus: "approval_pending", requiredPermissions: ["Advertising account access", "Organization access"], supportedGoals: ["leads", "bookings", "website_sales", "website_traffic", "awareness", "promote_post"], supportedCreativeFormats: ["Single image", "Video", "Carousel", "Document", "Lead form", "Sponsored content"], supportedPlacements: ["Feed", "Messaging when approved"], supportedDestinations: ["Website", "Lead form", "Existing company post"], supportedAudienceOptions: ["Location", "Professional criteria", "Matched audiences"], supportedBudgetTypes: budgets, supportedSchedulingOptions: ["Start and end", "Time zone"], supportedTrackingTypes: ["LinkedIn Insight Tag"], organicPostPromotion: true, requiredAccountTypes: ["Campaign Manager account", "Company Page where required"], featureFlag: "amplify_linkedin", visible: true, oauthEnabled: false, liveSubmissionEnabled: false, unavailableReason: "LinkedIn advertising application approval is pending." },
  { providerId: "tiktok", displayName: "TikTok Ads", Icon: FaTiktok, companionIcons: [], surfaces: ["TikTok"], advertisingAvailable: true, appApprovalStatus: "pending", connectionStatus: "approval_pending", requiredPermissions: ["TikTok Ads account access", "Identity access for Spark Ads"], supportedGoals: ["leads", "website_sales", "website_traffic", "awareness", "promote_post"], supportedCreativeFormats: ["In-feed video", "Spark Ad", "Lead form", "Catalogue"], supportedPlacements: ["In-feed"], supportedDestinations: ["Website", "Lead form", "Existing eligible post"], supportedAudienceOptions: ["Location", "Interests", "Custom audience"], supportedBudgetTypes: budgets, supportedSchedulingOptions: ["Start and end", "Time zone"], supportedTrackingTypes: ["TikTok Pixel"], organicPostPromotion: true, requiredAccountTypes: ["TikTok Ads Manager account"], featureFlag: "amplify_tiktok", visible: true, oauthEnabled: false, liveSubmissionEnabled: false, unavailableReason: "TikTok advertising application approval is pending." },
  { providerId: "x", displayName: "X Ads", Icon: FaXTwitter, companionIcons: [], surfaces: ["X"], advertisingAvailable: true, appApprovalStatus: "pending", connectionStatus: "approval_pending", requiredPermissions: ["Advertising account access"], supportedGoals: ["website_sales", "website_traffic", "awareness", "promote_post"], supportedCreativeFormats: ["Text", "Image", "Video", "Vertical video", "Carousel"], supportedPlacements: ["Timeline", "Video placements when supported"], supportedDestinations: ["Website", "Existing eligible post"], supportedAudienceOptions: ["Location", "Interests", "Custom audience"], supportedBudgetTypes: budgets, supportedSchedulingOptions: ["Start and end", "Time zone"], supportedTrackingTypes: ["X Pixel"], organicPostPromotion: true, requiredAccountTypes: ["X Ads account"], featureFlag: "amplify_x", visible: true, oauthEnabled: false, liveSubmissionEnabled: false, unavailableReason: "X advertising access is not approved or enabled." },
  { providerId: "pinterest", displayName: "Pinterest Ads", Icon: FaPinterestP, companionIcons: [], surfaces: ["Pinterest"], advertisingAvailable: true, appApprovalStatus: "pending", connectionStatus: "approval_pending", requiredPermissions: ["Advertising account access"], supportedGoals: ["leads", "website_sales", "website_traffic", "awareness", "promote_post"], supportedCreativeFormats: ["Standard image", "Video", "Carousel", "Collection", "Shopping", "Lead ad"], supportedPlacements: ["Home feed", "Search", "Related Pins"], supportedDestinations: ["Website", "Lead form", "Eligible Pin"], supportedAudienceOptions: ["Location", "Interests", "Keywords", "Customer lists"], supportedBudgetTypes: budgets, supportedSchedulingOptions: ["Start and end", "Time zone"], supportedTrackingTypes: ["Pinterest Tag"], organicPostPromotion: true, requiredAccountTypes: ["Pinterest business and advertising account"], featureFlag: "amplify_pinterest", visible: true, oauthEnabled: false, liveSubmissionEnabled: false, unavailableReason: "Pinterest advertising access is not approved or enabled." },
  { providerId: "snapchat", displayName: "Snapchat Ads", Icon: FaSnapchat, companionIcons: [], surfaces: ["Snapchat"], advertisingAvailable: true, appApprovalStatus: "pending", connectionStatus: "approval_pending", requiredPermissions: ["Advertising account access", "Public Profile access when required"], supportedGoals: ["leads", "website_sales", "website_traffic", "awareness"], supportedCreativeFormats: ["Single image", "Video", "Story", "Collection"], supportedPlacements: ["Stories", "Spotlight where supported"], supportedDestinations: ["Website", "App"], supportedAudienceOptions: ["Location", "Interests", "Custom audience"], supportedBudgetTypes: budgets, supportedSchedulingOptions: ["Start and end", "Time zone"], supportedTrackingTypes: ["Snap Pixel"], organicPostPromotion: false, requiredAccountTypes: ["Snap Ads account"], featureFlag: "amplify_snapchat", visible: true, oauthEnabled: false, liveSubmissionEnabled: false, unavailableReason: "Snap advertising access is not approved or enabled." },
  { providerId: "bluesky", displayName: "Bluesky", Icon: FaBluesky, companionIcons: [], surfaces: ["Bluesky"], advertisingAvailable: false, appApprovalStatus: "not_available", connectionStatus: "not_available", requiredPermissions: [], supportedGoals: [], supportedCreativeFormats: [], supportedPlacements: [], supportedDestinations: [], supportedAudienceOptions: [], supportedBudgetTypes: [], supportedSchedulingOptions: [], supportedTrackingTypes: [], organicPostPromotion: false, requiredAccountTypes: [], featureFlag: "amplify_bluesky", visible: true, oauthEnabled: false, liveSubmissionEnabled: false, unavailableReason: "Bluesky does not currently offer a supported advertising product for EchoFlow to connect." },
]);

export const AMPLIFY_CONNECTION_LABELS: Record<AmplifyConnectionStatus, string> = {
  approval_pending: "Approval Pending",
  ready_to_connect: "Ready to Connect",
  advertising_permission_required: "Advertising Permission Required",
  connected: "Connected",
  reconnect_required: "Reconnect Required",
  needs_attention: "Needs Attention",
  not_available: "Not Available",
  coming_later: "Coming Later",
  mock_connection: "Mock Connection",
};

export function amplifyProvider(providerId: AmplifyProviderId) {
  return AMPLIFY_PROVIDER_CAPABILITIES.find((provider) => provider.providerId === providerId);
}
