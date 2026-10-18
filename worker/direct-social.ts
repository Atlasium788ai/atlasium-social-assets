/**
 * First-party social publishing. Credentials are supplied only through the
 * Cloudflare DIRECT_SOCIAL_CONNECTIONS secret; never sent to the browser.
 * No third-party scheduling or publishing intermediary is used.
 */
export type SocialDestination = {
  id: string;
  brandId: string;
  name: string;
  displayName: string;
  service: string;
  accountId: string;
  accessToken: string;
};

export type DirectSocialEnv = { DIRECT_SOCIAL_CONNECTIONS?: string };
export type DirectSocialInput = {
  brandId: string;
  channelId: string;
  service: string;
  text: string;
  mediaUrl: string;
  mediaType?: "image" | "video";
  surface: string;
  mode: string;
  dueAt?: string;
};

const GRAPH_VERSION = "v24.0";
const PLATFORM_TYPES = new Set(["facebook", "instagram"]);

function readConnections(env: DirectSocialEnv): SocialDestination[] {
  if (!env.DIRECT_SOCIAL_CONNECTIONS?.trim()) return [];
  let data: unknown;
  try { data = JSON.parse(env.DIRECT_SOCIAL_CONNECTIONS); }
  catch { throw new Error("Direct social connections are misconfigured."); }
  if (!Array.isArray(data)) throw new Error("Direct social connections must be a list.");
  const found = new Set<string>();
  return data.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid direct social connection.");
    const item = raw as Record<string, unknown>;
    const connection = {
      id: String(item.id || "").trim(),
      brandId: String(item.brandId || "").trim(),
      name: String(item.name || item.displayName || "").trim(),
      displayName: String(item.displayName || item.name || "").trim(),
      service: String(item.service || "").trim().toLowerCase(),
      accountId: String(item.accountId || "").trim(),
      accessToken: String(item.accessToken || "").trim(),
    };
    if (!connection.id || !connection.brandId || !connection.accountId || !connection.accessToken ||
        !PLATFORM_TYPES.has(connection.service) || !/^[0-9]+$/.test(connection.accountId) ||
        found.has(connection.id)) throw new Error("Direct social connections are incomplete or duplicated.");
    found.add(connection.id);
    return connection;
  });
}

export function listDirectSocialDestinations(env: DirectSocialEnv) {
  return readConnections(env).map(({ id, brandId, name, displayName, service }) =>
    ({ id, brandId, name, displayName, service }));
}

async function graphPost(path: string, token: string, values: Record<string, string>) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const result = await response.json() as { id?: string; post_id?: string; error?: { message?: string; code?: number } };
  if (!response.ok || result.error || !result.id) {
    // Never echo tokens, upstream request bodies, or provider URLs.
    throw new Error(`Direct platform publishing failed (HTTP ${response.status}, code ${result.error?.code || "unknown"}).`);
  }
  return result;
}

export async function publishDirectSocial(env: DirectSocialEnv, input: DirectSocialInput) {
  const account = readConnections(env).find((item) => item.id === input.channelId);
  if (!account || account.brandId !== input.brandId || account.service !== input.service.toLowerCase())
    throw new Error("This direct social connection is not assigned to the selected brand.");
  if (input.mode !== "shareNow" || input.dueAt)
    throw new Error("Direct scheduled publishing requires the first-party scheduler. Use Post now until it is enabled.");
  if (input.mediaType !== "image" || !/^https:\/\//i.test(input.mediaUrl))
    throw new Error("Direct publishing currently requires a publicly hosted HTTPS image.");
  if (input.surface !== "feed" && input.surface !== "post")
    throw new Error("This surface requires additional platform publishing permissions.");

  if (account.service === "facebook") {
    const result = await graphPost(`${account.accountId}/photos`, account.accessToken, {
      url: input.mediaUrl,
      caption: input.text,
      published: "true",
    });
    return { id: result.post_id || result.id!, channelId: account.id, status: "sent", dueAt: null };
  }

  if (account.service === "instagram") {
    const container = await graphPost(`${account.accountId}/media`, account.accessToken, {
      image_url: input.mediaUrl,
      caption: input.text,
    });
    // Containers may still be processing. Do not issue a publish request until ready.
    const statusResponse = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${container.id}?fields=status_code`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    const status = await statusResponse.json() as { status_code?: string };
    if (!statusResponse.ok || status.status_code !== "FINISHED")
      throw new Error("Instagram is still processing the media container. Nothing has been published.");
    const published = await graphPost(`${account.accountId}/media_publish`, account.accessToken, { creation_id: container.id! });
    return { id: published.id!, channelId: account.id, status: "sent", dueAt: null };
  }

  throw new Error("Direct publishing is not yet available for this platform.");
}
