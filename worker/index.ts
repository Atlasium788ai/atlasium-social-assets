import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  UPLOADS: R2Bucket;
  UPLOAD_KEY: string;
  BUFFER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function authorized(request: Request, env: Env) {
  return Boolean(env.UPLOAD_KEY && request.headers.get("X-Upload-Key") === env.UPLOAD_KEY);
}

async function bufferRequest(env: Env, query: string, variables: Record<string, unknown> = {}) {
  if (!env.BUFFER_API_KEY) throw new Error("Buffer is not connected yet.");
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BUFFER_API_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  if (!response.ok || data.errors?.length) throw new Error(data.errors?.[0]?.message || "Buffer request failed.");
  return data.data || {};
}

async function getChannels(env: Env) {
  const account = await bufferRequest(env, `query Account { account { organizations { id name } } }`);
  const organizations = (account.account as { organizations?: Array<{ id: string; name: string }> })?.organizations || [];
  const lists = await Promise.all(organizations.map(async (organization) => {
    const data = await bufferRequest(env, `query Channels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name displayName service avatar isQueuePaused } }`, { organizationId: organization.id });
    return (data.channels as Array<Record<string, unknown>> || []).map((channel) => ({ ...channel, organizationName: organization.name }));
  }));
  return lists.flat();
}

async function refinePost(env: Env, caption: string, notes: string, service: string) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("Claude refinement is enabled, but Claude is not connected yet.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 1200,
      system: "You adapt finished social posts for a target platform. Preserve the original message, facts, voice, links, and intent. Do not rewrite unnecessarily. Return only the final post text with no commentary or quotation marks.",
      messages: [{ role: "user", content: `Target platform: ${service}\nOptional instructions: ${notes || "None"}\n\nFinished post:\n${caption}` }],
    }),
  });
  const data = await response.json() as { content?: Array<{ type: string; text?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "Claude refinement failed.");
  return data.content?.find((block) => block.type === "text")?.text?.trim() || caption;
}

async function createBufferPost(env: Env, input: { channelId: string; text: string; imageUrl: string; mode: string; dueAt?: string; aiAssisted: boolean }) {
  const data = await bufferRequest(env, `mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id dueAt status channelId } } ... on MutationError { message } } }`, {
    input: {
      text: input.text,
      channelId: input.channelId,
      schedulingType: "automatic",
      mode: input.mode,
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      assets: [{ image: { url: input.imageUrl } }],
      aiAssisted: input.aiAssisted,
      source: "atlasium-publish-bridge",
    },
  });
  const result = data.createPost as { __typename?: string; message?: string; post?: { id: string } };
  if (result?.__typename !== "PostActionSuccess") throw new Error(result?.message || "Buffer rejected the post.");
  return result.post;
}

async function upload(request: Request, env: Env) {
  if (!authorized(request, env)) {
    return json({ error: "This uploader link is not authorized." }, 401);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > 21 * 1024 * 1024) return json({ error: "Image is over the 20 MB limit." }, 413);

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return json({ error: "Choose an image to upload." }, 400);
  if (image.size > 20 * 1024 * 1024) return json({ error: "Image is over the 20 MB limit." }, 413);

  const extension = allowedTypes.get(image.type.toLowerCase());
  if (!extension) return json({ error: "Use a JPG, PNG, WebP, GIF or HEIC image." }, 415);

  const id = crypto.randomUUID();
  const key = `${new Date().toISOString().slice(0, 10)}/${id}.${extension}`;
  await env.UPLOADS.put(key, image.stream(), {
    httpMetadata: { contentType: image.type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { originalName: image.name.slice(0, 200) },
  });

  return json({ url: `${new URL(request.url).origin}/i/${key}` }, 201);
}

async function publish(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
  if (!env.BUFFER_API_KEY) return json({ error: "Buffer is not connected yet." }, 503);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 22 * 1024 * 1024) return json({ error: "Request is too large." }, 413);
  const form = await request.formData();
  const image = form.get("image");
  const caption = String(form.get("caption") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const refine = form.get("refine") === "true";
  const mode = String(form.get("mode") || "addToQueue");
  const dueAt = String(form.get("dueAt") || "") || undefined;
  let channelIds: string[] = [];
  try { channelIds = JSON.parse(String(form.get("channels") || "[]")); } catch { return json({ error: "Invalid channel selection." }, 400); }
  if (!(image instanceof File) || !caption || !channelIds.length) return json({ error: "Add an image, post text, and at least one channel." }, 400);
  if (!allowedTypes.has(image.type.toLowerCase()) || image.size > 20 * 1024 * 1024) return json({ error: "Use a supported image under 20 MB." }, 415);
  if (!["shareNow", "addToQueue", "customScheduled"].includes(mode)) return json({ error: "Invalid publishing time." }, 400);
  if (mode === "customScheduled" && (!dueAt || Number.isNaN(Date.parse(dueAt)) || Date.parse(dueAt) <= Date.now())) return json({ error: "Choose a future schedule time." }, 400);

  const available = await getChannels(env);
  const chosen = available.filter((channel) => channelIds.includes(String(channel.id)));
  if (chosen.length !== channelIds.length) return json({ error: "One or more Buffer channels are invalid." }, 400);

  const extension = allowedTypes.get(image.type.toLowerCase())!;
  const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  await env.UPLOADS.put(key, image.stream(), { httpMetadata: { contentType: image.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: image.name.slice(0, 200) } });
  const imageUrl = `${new URL(request.url).origin}/i/${key}`;

  const results = [];
  for (const channel of chosen) {
    const text = refine ? await refinePost(env, caption, notes, String(channel.service)) : caption;
    const post = await createBufferPost(env, { channelId: String(channel.id), text, imageUrl, mode, dueAt, aiAssisted: refine });
    results.push({ channel: channel.displayName || channel.name, service: channel.service, postId: post?.id });
  }
  const action = mode === "shareNow" ? "published" : mode === "customScheduled" ? "scheduled" : "added to the queue";
  return json({ message: `${results.length} post${results.length === 1 ? "" : "s"} ${action} successfully.`, imageUrl, results }, 201);
}

async function serveImage(request: Request, env: Env, key: string) {
  const object = await env.UPLOADS.get(key);
  if (!object) return new Response("Image not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/upload") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      return upload(request, env);
    }

    if (url.pathname === "/api/channels") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
      if (!env.BUFFER_API_KEY) return json({ configured: false, channels: [] });
      try { return json({ configured: true, channels: await getChannels(env) }); }
      catch (error) { return json({ configured: true, error: error instanceof Error ? error.message : "Could not load Buffer channels." }, 502); }
    }

    if (url.pathname === "/api/publish") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await publish(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Publishing failed." }, 502); }
    }

    if (url.pathname.startsWith("/i/") && (request.method === "GET" || request.method === "HEAD")) {
      return serveImage(request, env, decodeURIComponent(url.pathname.slice(3)));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
