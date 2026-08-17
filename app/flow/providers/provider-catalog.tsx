import type { IconType } from "react-icons";
import { FaBluesky, FaFacebookF, FaGoogle, FaInstagram, FaLinkedinIn, FaPinterestP, FaSnapchat, FaThreads, FaTiktok, FaXTwitter, FaYoutube } from "react-icons/fa6";
import type { FlowConnectionStatus, FlowPlatformId, FlowProviderAuthorization } from "../services/flow-connection-service";

export type FlowProviderTile = FlowProviderAuthorization & {
  name: string;
  status: FlowConnectionStatus;
  Icon: IconType;
};

export const FLOW_PROVIDER_TILES: readonly FlowProviderTile[] = Object.freeze([
  { providerId: "facebook", name: "Facebook", status: "approval_pending", authorizationEnabled: false, featureFlag: "flow_facebook", scopes: [], pkce: "when_supported", Icon: FaFacebookF },
  { providerId: "instagram", name: "Instagram", status: "approval_pending", authorizationEnabled: false, featureFlag: "flow_instagram", scopes: [], pkce: "when_supported", Icon: FaInstagram },
  { providerId: "linkedin", name: "LinkedIn", status: "approval_pending", authorizationEnabled: false, featureFlag: "flow_linkedin", scopes: [], pkce: "when_supported", Icon: FaLinkedinIn },
  { providerId: "tiktok", name: "TikTok", status: "approval_pending", authorizationEnabled: false, featureFlag: "flow_tiktok", scopes: [], pkce: "when_supported", Icon: FaTiktok },
  { providerId: "youtube", name: "YouTube", status: "coming_soon", authorizationEnabled: false, featureFlag: "flow_youtube", scopes: [], pkce: "when_supported", Icon: FaYoutube },
  { providerId: "x", name: "X", status: "coming_soon", authorizationEnabled: false, featureFlag: "flow_x", scopes: [], pkce: "when_supported", Icon: FaXTwitter },
  { providerId: "threads", name: "Threads", status: "coming_soon", authorizationEnabled: false, featureFlag: "flow_threads", scopes: [], pkce: "when_supported", Icon: FaThreads },
  { providerId: "pinterest", name: "Pinterest", status: "coming_soon", authorizationEnabled: false, featureFlag: "flow_pinterest", scopes: [], pkce: "when_supported", Icon: FaPinterestP },
  { providerId: "google_business", name: "Google Business Profile", status: "coming_soon", authorizationEnabled: false, featureFlag: "flow_google_business", scopes: [], pkce: "when_supported", Icon: FaGoogle },
  { providerId: "bluesky", name: "Bluesky", status: "coming_soon", authorizationEnabled: false, featureFlag: "flow_bluesky", scopes: [], pkce: "when_supported", Icon: FaBluesky },
  { providerId: "snapchat", name: "Snapchat", status: "coming_soon", authorizationEnabled: false, featureFlag: "flow_snapchat", scopes: [], pkce: "when_supported", Icon: FaSnapchat },
]);

export const FLOW_STATUS_LABELS: Record<FlowConnectionStatus, string> = {
  connect: "Connect",
  connected: "Connected",
  approval_pending: "Approval Pending",
  coming_soon: "Coming Soon",
  reconnect: "Reconnect",
  needs_attention: "Needs Attention",
  unavailable: "Unavailable",
};

export function getFlowProvider(providerId: FlowPlatformId) {
  return FLOW_PROVIDER_TILES.find((provider) => provider.providerId === providerId);
}
