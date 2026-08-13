import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  UPLOADS: R2Bucket;
  UPLOAD_KEY: string;
  BUFFER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
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

type AgentPlan = {
  campaign: string;
  timing: "auto" | "now" | "queue" | "schedule";
  posts: Array<{ concept: string; caption: string; imagePrompt: string }>;
};

type TimingMode = "auto" | "now" | "queue" | "schedule";
type TimingPlan = { mode: TimingMode; label: string; start: string | null; end: string | null; weekdaysOnly: boolean; postsPerWeek: number | null; launchDay: number | null };

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

const dayNames: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")), weekday: dayNames[value("weekday").toLowerCase()], hour: Number(value("hour")), minute: Number(value("minute")) };
}

function validTimeZone(timeZone: string) {
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); return timeZone; } catch { return "America/Toronto"; }
}

function wallToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 2; attempt++) {
    const actual = localParts(new Date(guess), timeZone);
    const shown = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    guess += target - shown;
  }
  return new Date(guess);
}

function dateKey(date: Date, timeZone: string) {
  const part = localParts(date, timeZone);
  return `${part.year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}`;
}

function addLocalDays(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function localWeekday(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function parseTiming(prompt: string, requested: string, timeZone: string, now = new Date()): TimingPlan {
  const text = prompt.toLowerCase();
  const today = dateKey(now, timeZone);
  const todayDay = localWeekday(today);
  let mode: TimingMode = requested === "now" || requested === "queue" || requested === "schedule" ? requested : "auto";
  if (requested === "auto") {
    if (/\b(post|publish|share)\s+(it\s+)?now\b|\bimmediately\b/.test(text)) mode = "now";
    else if (/\b(buffer\s+)?queue\b/.test(text)) mode = "queue";
    else mode = "schedule";
  }
  const frequency = text.match(/\b(\d+)\s+posts?\s+per\s+week\b/);
  const postsPerWeek = frequency ? Math.max(1, Math.min(14, Number(frequency[1]))) : null;
  const launch = text.match(/\blaunch(?:es|ing)?(?:\s+on)?\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  const launchDay = launch ? dayNames[launch[1]] : null;
  let start = addLocalDays(today, 1);
  let end: string | null = null;
  let label = "Automatically spaced at sensible social posting times";
  if (/\bnext week\b/.test(text)) {
    const untilMonday = ((8 - todayDay) % 7) || 7; start = addLocalDays(today, untilMonday); end = addLocalDays(start, 6); label = "Next week";
  } else if (/\bthis week\b/.test(text)) {
    start = today; end = addLocalDays(today, (7 - todayDay) % 7); label = "This week";
  } else {
    const days = text.match(/\bover\s+the\s+next\s+(\d+)\s+days?\b|\bnext\s+(\d+)\s+days?\b/);
    if (days) { const count = Math.max(1, Math.min(90, Number(days[1] || days[2]))); start = today; end = addLocalDays(today, count - 1); label = `Over the next ${count} days`; }
  }
  if (launchDay !== null) {
    const distance = ((launchDay - todayDay + 7) % 7) || 7; start = addLocalDays(today, distance); end = start; label = `Launch ${launch?.[1]}`;
  }
  return { mode, label, start: mode === "schedule" ? start : null, end: mode === "schedule" ? end : null, weekdaysOnly: /\bevery weekday\b|\bweekdays?\b/.test(text), postsPerWeek, launchDay };
}

function buildSchedule(prompt: string, count: number, requested: string, timeZone: string, now = new Date()) {
  const zone = validTimeZone(timeZone);
  const timing = parseTiming(prompt, requested, zone, now);
  if (timing.mode !== "schedule") return { timing, times: Array(count).fill(null) as Array<string | null> };
  const candidates: string[] = [];
  let cursor = timing.start!;
  const hardEnd = timing.end || addLocalDays(cursor, timing.postsPerWeek ? Math.max(6, Math.ceil(count / timing.postsPerWeek) * 7 - 1) : Math.max(14, count * 3));
  while (cursor <= hardEnd && candidates.length < 120) {
    const weekday = localWeekday(cursor);
    if (!(timing.weekdaysOnly && (weekday === 0 || weekday === 6))) candidates.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  if (!candidates.length) candidates.push(timing.start!);
  const times: string[] = [];
  const hours = [10, 13, 16, 19];
  for (let index = 0; index < count; index++) {
    const position = count === 1 ? 0 : Math.round(index * (candidates.length - 1) / (count - 1));
    let key = candidates[position] || candidates[candidates.length - 1];
    if (timing.postsPerWeek) key = addLocalDays(timing.start!, Math.floor(index / timing.postsPerWeek) * 7 + (index % timing.postsPerWeek) * Math.max(1, Math.floor(5 / timing.postsPerWeek)));
    if (timing.weekdaysOnly) while ([0, 6].includes(localWeekday(key))) key = addLocalDays(key, 1);
    const [year, month, day] = key.split("-").map(Number);
    let scheduled = wallToUtc(year, month, day, hours[index % hours.length], (index * 13) % 47, zone);
    if (scheduled.getTime() < now.getTime() + 60 * 60 * 1000) scheduled = wallToUtc(year, month, day, Math.min(21, localParts(now, zone).hour + 2), (index * 13) % 47, zone);
    times.push(scheduled.toISOString());
  }
  return { timing, times };
}

function selectChannels(prompt: string, channels: Array<Record<string, unknown>>, requestedIds: string[]) {
  if (requestedIds.length) return channels.filter((channel) => requestedIds.includes(String(channel.id)));
  const text = prompt.toLowerCase();
  const services = ["instagram", "facebook", "linkedin", "twitter", "x"];
  const named = services.filter((service) => new RegExp(`\\b${service}\\b`, "i").test(text));
  const personal = /\b(i|me|my|mine|founder|personal|behind the scenes|lesson i|what i learned|my journey|my perspective)\b/.test(text);
  const linkedin = channels.filter((channel) => String(channel.service).toLowerCase() === "linkedin");
  const personalLinkedIn = linkedin.find((channel) => /blair|personal/i.test(`${channel.displayName || ""} ${channel.name || ""}`));
  const companyLinkedIn = linkedin.find((channel) => channel !== personalLinkedIn) || linkedin[0];
  const selected: Array<Record<string, unknown>> = [];
  const add = (channel: Record<string, unknown> | undefined) => { if (channel && !selected.includes(channel)) selected.push(channel); };
  const allowedServices = named.length ? named : ["linkedin", "instagram", "facebook"];
  for (const service of allowedServices) {
    if (service === "linkedin") add(personal ? personalLinkedIn || companyLinkedIn : companyLinkedIn);
    else add(channels.find((channel) => String(channel.service).toLowerCase() === (service === "x" ? "twitter" : service)));
  }
  return selected;
}

function routePosts(prompt: string, posts: AgentPlan["posts"], channels: Array<Record<string, unknown>>, manual: boolean) {
  if (!channels.length) return [];
  const personal = /\b(i|me|my|mine|founder|personal|lesson i|what i learned|my journey|my perspective)\b/i.test(prompt);
  const ranked = [...channels].sort((a, b) => {
    const score = (channel: Record<string, unknown>) => {
      const service = String(channel.service).toLowerCase();
      const name = `${channel.displayName || ""} ${channel.name || ""}`;
      if (service === "linkedin" && /blair|personal/i.test(name)) return personal ? 0 : 20;
      if (service === "linkedin") return 0;
      if (service === "instagram") return 1;
      if (service === "facebook") return 2;
      return 10;
    };
    return score(a) - score(b);
  });
  const usable = manual ? ranked : ranked.filter((channel) => String(channel.service).toLowerCase() !== "tiktok");
  return posts.map((post, index) => {
    const content = `${post.concept} ${post.caption}`.toLowerCase();
    let channel = usable[index % usable.length];
    if (!manual && posts.length < usable.length) {
      if (/visual|design|brand|image|look|creative/.test(content)) channel = usable.find((item) => String(item.service).toLowerCase() === "instagram") || channel;
      else if (/community|customer|conversation|local|audience/.test(content)) channel = usable.find((item) => String(item.service).toLowerCase() === "facebook") || channel;
      else if (/business|company|offer|strategy|work|professional/.test(content)) channel = usable.find((item) => String(item.service).toLowerCase() === "linkedin") || channel;
    }
    return { post, channel };
  });
}

function normalizedContent(text: string) {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function inferredPostType(text: string) {
  if (/\b(story|stories)\b/i.test(text)) return "story";
  if (/\breels?\b/i.test(text)) return "reel";
  return "post";
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

async function createBufferPost(env: Env, input: { channelId: string; service: string; text: string; imageUrl: string; mode: string; dueAt?: string; aiAssisted: boolean; typeHint?: string }) {
  const service = input.service.toLowerCase();
  const postType = inferredPostType(`${input.typeHint || ""} ${input.text}`);
  const metadata = service === "instagram"
    ? { instagram: { type: postType, shouldShareToFeed: postType !== "story", isAiGenerated: input.aiAssisted } }
    : service === "facebook"
      ? { facebook: { type: postType } }
      : service === "tiktok"
        ? { tiktok: { title: input.text.slice(0, 90), isAiGenerated: input.aiAssisted } }
        : undefined;
  const data = await bufferRequest(env, `mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id dueAt status channelId } } ... on MutationError { message } } }`, {
    input: {
      text: input.text,
      channelId: input.channelId,
      schedulingType: "automatic",
      mode: input.mode,
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      assets: [{ image: { url: input.imageUrl } }],
      ...(metadata ? { metadata } : {}),
      aiAssisted: input.aiAssisted,
      source: "atlasium-publish-bridge",
    },
  });
  const result = data.createPost as { __typename?: string; message?: string; post?: { id: string } };
  if (result?.__typename !== "PostActionSuccess") throw new Error(result?.message || "Buffer rejected the post.");
  return result.post;
}

function responseText(data: { output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }> }) {
  for (const item of data.output || []) for (const content of item.content || []) {
    if (content.type === "refusal") throw new Error(content.refusal || "OpenAI declined this request.");
    if (content.type === "output_text" && content.text) return content.text;
  }
  throw new Error("OpenAI returned no campaign plan.");
}

async function createPlan(env: Env, prompt: string, channelNames: string[], timingOverride: string): Promise<AgentPlan> {
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI connection required.");
  const schema = {
    type: "object", additionalProperties: false, required: ["campaign", "timing", "posts"],
    properties: {
      campaign: { type: "string" },
      timing: { type: "string", enum: ["auto", "now", "queue", "schedule"] },
      posts: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["concept", "caption", "imagePrompt"], properties: {
        concept: { type: "string" }, caption: { type: "string" }, imagePrompt: { type: "string" },
      } } },
    },
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_TEXT_MODEL || "gpt-5.6-luna",
      input: [
        { role: "system", content: "You are Atlasium's autonomous social campaign planner. Turn the request into 1-8 distinct posts. Preserve facts and intent; never invent offers, prices, dates, proof, or links. Write polished captions suitable for the named channels. Each image prompt must describe a premium, dark, modern Atlasium-style square social image, visually distinct, with no logos and minimal or no rendered text. Infer timing from the request: now only when explicitly immediate; queue when explicitly requested; schedule for stated date windows; otherwise auto. Return only the schema." },
        { role: "user", content: `Today is ${new Date().toISOString()}. Channels: ${channelNames.join(", ")}. UI timing preference: ${timingOverride}. Request: ${prompt}` },
      ],
      text: { format: { type: "json_schema", name: "atlasium_campaign", strict: true, schema } },
    }),
  });
  const data = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "OpenAI campaign planning failed.");
  const plan = JSON.parse(responseText(data)) as AgentPlan;
  if (["now", "queue", "schedule"].includes(timingOverride)) plan.timing = timingOverride as AgentPlan["timing"];
  return plan;
}

async function generateAndHostImage(request: Request, env: Env, prompt: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.OPENAI_IMAGE_MODEL || "gpt-image-2", prompt, size: "1024x1024", quality: "medium", output_format: "png" }),
  });
  const data = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
  if (!response.ok || !data.data?.[0]?.b64_json) throw new Error(data.error?.message || "OpenAI image generation failed.");
  const binary = Uint8Array.from(atob(data.data[0].b64_json), (character) => character.charCodeAt(0));
  const key = `${new Date().toISOString().slice(0, 10)}/ai-${crypto.randomUUID()}.png`;
  await env.UPLOADS.put(key, binary, { httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: "atlasium-ai-generated.png" } });
  return `${new URL(request.url).origin}/i/${key}`;
}

async function runAgent(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
  if (!env.BUFFER_API_KEY) return json({ error: "Buffer is not connected yet." }, 503);
  if (!env.OPENAI_API_KEY) return json({ error: "OpenAI connection required." }, 503);
  const body = await request.json() as { prompt?: string; channels?: string[]; timing?: string; timeZone?: string };
  const prompt = String(body.prompt || "").trim();
  if (!prompt || prompt.length > 4000) return json({ error: "Enter a clear prompt under 4,000 characters." }, 400);
  const available = await getChannels(env);
  const requestedIds = Array.isArray(body.channels) ? body.channels : [];
  const chosen = selectChannels(prompt, available, requestedIds);
  if (!chosen.length || (requestedIds.length && chosen.length !== requestedIds.length)) return json({ error: "Choose at least one valid Buffer channel." }, 400);
  const timing = ["auto", "now", "queue", "schedule"].includes(String(body.timing)) ? String(body.timing) : "auto";
  const plan = await createPlan(env, prompt, chosen.map((channel) => `${channel.service}: ${channel.displayName || channel.name}`), timing);
  const imageUrls = await Promise.all(plan.posts.map((post) => generateAndHostImage(request, env, post.imagePrompt)));
  const schedule = buildSchedule(prompt, plan.posts.length, timing, String(body.timeZone || "America/Toronto"));
  const assignments = routePosts(prompt, plan.posts, chosen, requestedIds.length > 0);
  const results: Array<Record<string, unknown>> = [];
  const submitted = new Set<string>();
  for (let postIndex = 0; postIndex < assignments.length; postIndex++) {
    const { post, channel } = assignments[postIndex];
    const mode = schedule.timing.mode === "now" ? "shareNow" : schedule.timing.mode === "queue" ? "addToQueue" : "customScheduled";
    const dueAt = mode === "customScheduled" ? schedule.times[postIndex]! : undefined;
    const fingerprint = `${normalizedContent(post.caption)}|${dueAt ? dueAt.slice(0, 16) : mode}`;
    if (submitted.has(fingerprint)) continue;
    submitted.add(fingerprint);
    const created = await createBufferPost(env, { channelId: String(channel.id), service: String(channel.service), text: post.caption, imageUrl: imageUrls[postIndex], mode, dueAt, aiAssisted: true, typeHint: `${prompt} ${post.concept}` });
    results.push({ concept: post.concept, caption: post.caption, imageUrl: imageUrls[postIndex], channel: channel.displayName || channel.name, service: channel.service, postId: created?.id, status: mode === "shareNow" ? "Publishing now" : mode === "addToQueue" ? "Added to queue" : "Scheduled", dueAt });
  }
  const usedChannels = new Set(results.map((result) => String(result.channel)));
  return json({ message: `${results.length} post${results.length === 1 ? "" : "s"} created and sent across ${usedChannels.size} channel${usedChannels.size === 1 ? "" : "s"}.`, campaign: plan.campaign, postsCreated: results.length, channels: usedChannels.size, schedule: schedule.timing, results }, 201);
}

async function previewSchedule(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
  const body = await request.json() as { prompt?: string; count?: number; timing?: string; timeZone?: string; channels?: Array<Record<string, unknown>>; selected?: string[]; samplePosts?: AgentPlan["posts"] };
  const prompt = String(body.prompt || "");
  const count = Math.max(1, Math.min(50, Number(body.count) || 1));
  const zone = validTimeZone(String(body.timeZone || "America/Toronto"));
  const schedule = buildSchedule(prompt, count, String(body.timing || "auto"), zone);
  const channels = Array.isArray(body.channels) ? body.channels : [];
  const selectedIds = Array.isArray(body.selected) ? body.selected : [];
  const chosen = selectChannels(prompt, channels, selectedIds);
  const samplePosts = Array.isArray(body.samplePosts) ? body.samplePosts.slice(0, count) : [];
  const assignments = routePosts(prompt, samplePosts, chosen, selectedIds.length > 0).map(({ post, channel }, index) => ({ concept: post.concept, caption: post.caption, channel: channel.displayName || channel.name, service: channel.service, dueAt: schedule.times[index] }));
  return json({ ...schedule, timeZone: zone, channels: chosen, assignments });
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
  let mode = String(form.get("mode") || "addToQueue");
  let dueAt = String(form.get("dueAt") || "") || undefined;
  let channelIds: string[] = [];
  try { channelIds = JSON.parse(String(form.get("channels") || "[]")); } catch { return json({ error: "Invalid channel selection." }, 400); }
  if (!(image instanceof File) || !caption || !channelIds.length) return json({ error: "Add an image, post text, and at least one channel." }, 400);
  if (!allowedTypes.has(image.type.toLowerCase()) || image.size > 20 * 1024 * 1024) return json({ error: "Use a supported image under 20 MB." }, 415);
  if (!["shareNow", "addToQueue", "customScheduled", "smartSchedule"].includes(mode)) return json({ error: "Invalid publishing time." }, 400);
  if (mode === "smartSchedule") { mode = "customScheduled"; dueAt = buildSchedule(caption, 1, "auto", String(form.get("timeZone") || "America/Toronto")).times[0] || undefined; }
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
    const post = await createBufferPost(env, { channelId: String(channel.id), service: String(channel.service), text, imageUrl, mode, dueAt, aiAssisted: refine, typeHint: notes });
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

    if (url.pathname === "/api/agent") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await runAgent(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Campaign creation failed." }, 502); }
    }

    if (url.pathname === "/api/preview-schedule") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await previewSchedule(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not build schedule." }, 400); }
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
