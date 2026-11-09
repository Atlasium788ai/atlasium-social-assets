/** Brand-owned tracking links for organic social content.
 * Only decorates links to the selected brand's own configured HTTPS website.
 * It does not count or assert actual visits, contacts, conversions or sales.
 */
export const engagementSources = ["instagram", "facebook", "linkedin", "threads", "tiktok", "youtube", "x"] as const;
export type EngagementSource = typeof engagementSources[number];

export type EngagementTrafficInput = {
  website: string;
  platform: EngagementSource;
  campaign: string;
  content?: string;
  path?: string;
};

function slug(value: string, label: string, allowEmpty = false) {
  const result = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (allowEmpty && !result) return "";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(result))
    throw new Error(`Enter a short ${label} with letters, numbers, hyphens or underscores.`);
  return result;
}

export function buildEngagementTrackingLink(input: EngagementTrafficInput): string {
  let base: URL;
  try { base = new URL(input.website.trim()); }
  catch { throw new Error("Set the brand's website to an HTTPS URL in EchoFlow first."); }
  if (base.protocol !== "https:" || base.username || base.password || !base.hostname.includes(".")
    || ["localhost", "127.0.0.1"].includes(base.hostname.toLowerCase()))
    throw new Error("Use an HTTPS public domain owned by the selected brand.");
  if (!engagementSources.includes(input.platform)) throw new Error("Unsupported social platform.");
  const path = (input.path || "").trim();
  if (path && (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")
    || path.includes("?") || path.includes("#") || /[\u0000-\u001f]/.test(path)))
    throw new Error("Use only a path such as /article-name, not another website.");
  // Fixed domain guarantee prevents accidentally sharing a competitor/client URL.
  const target = new URL(path || base.pathname || "/", base.origin);
  if (target.origin !== base.origin) throw new Error("The tracking link must use the brand's own website.");
  target.searchParams.set("utm_source", input.platform);
  target.searchParams.set("utm_medium", "organic_social");
  target.searchParams.set("utm_campaign", slug(input.campaign, "campaign name"));
  const content = slug(input.content || "", "post identifier", true);
  if (content) target.searchParams.set("utm_content", content);
  return target.toString();
}
