import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  ATLASIUM_BRAND_ID,
  OWNER_ID,
  WORKSPACE_ID,
  archiveBrand,
  audit,
  campaignOwner,
  createBrand,
  ensureBrandSystem,
  finishPublishJob,
  flowWorkspaceSnapshot,
  indexCampaign,
  pendingDeliveryJobs,
  recordDelivery,
  requireBrand,
  reservePublishJob,
  saveDraft,
  syncAtlasiumChannels,
  updateBrand,
  workspaceSnapshot,
  type BrandContext,
  type BrandProfileInput,
  type BufferDestination,
} from "./brand-store";
import {
  createAmplifyDraft,
  loadAmplifyWorkspace,
  runAmplifyDryTest,
  updateAmplifyDraft,
  uploadAmplifyAsset,
} from "./amplify-store";
import {
  createEchoContentDraft,
  deleteEchoContentDraft,
  duplicateEchoContentDraft,
  generateEchoFeaturedImage,
  loadEchoContentWorkspace,
  repurposeEchoContentDraft,
  reviseEchoContentSection,
  undoEchoContentRevision,
  updateEchoContentDraft,
} from "./content-store";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  UPLOADS: R2Bucket;
  UPLOAD_KEY: string;
  BUFFER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
  OPENAI_VIDEO_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  TEST_NOW?: string;
  AMPLIFY_ENABLED?: string;
  AMPLIFY_DRY_RUN_ENABLED?: string;
  AMPLIFY_LIVE_SUBMISSION_ENABLED?: string;
  IMAGES?: {
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
  posts: Array<{
    concept: string;
    caption: string;
    imagePrompt: string;
    personalLinkedInCaption?: string;
    companyLinkedInCaption?: string;
    instagramCaption?: string;
    facebookCaption?: string;
    tiktokCaption?: string;
  }>;
};

type MediaType = "image" | "video";
type SurfaceMode = "main" | "story" | "main_and_story";
type PublicationSurface = "feed" | "story" | "reel" | "post" | "video" | "pin" | "short";
type PlannedPost = AgentPlan["posts"][number] & {
  id: string;
  itemIndex: number;
  mediaType: MediaType;
  motionStyle: string | null;
  motionPrompt: string | null;
  duration: number | null;
  aspectRatio: string;
  imageUrl?: string;
  storyImageUrl?: string;
  storyMediaError?: string;
  hostedMediaUrl?: string;
  motionError?: string;
};
type BufferPost = { id: string; dueAt?: string | null; status?: string | null; channelId: string };
type BufferPostStatus = BufferPost & { sentAt?: string | null; externalLink?: string | null; error?: { message?: string; supportUrl?: string | null } | null };
type MotionState = "queued" | "rendering" | "completed" | "hosting" | "scheduling" | "scheduled" | "failed";
type MotionJobStatus = { status: "queued" | "rendering" | "completed" | "failed"; error?: string };
interface MotionProvider {
  providerName: string;
  modelName: string;
  createJob(prompt: string, duration: number): Promise<{ id: string; status: MotionJobStatus["status"] }>;
  getJobStatus(id: string): Promise<MotionJobStatus>;
  downloadResult(id: string): Promise<Uint8Array>;
  handleWebhook(_request: Request): Promise<never>;
}
type CampaignResult = Record<string, unknown> & { id: string; itemId: string; status: string; channelId: string; service: string; caption: string; surface: PublicationSurface; surfaceId: string; surfaceLabel: string; requestedDueAt?: string | null; mediaType?: MediaType; imageUrl?: string; hostedMediaUrl?: string };
type CampaignRecord = { id: string; workspaceId: string; brandId: string; createdAt: string; updatedAt: string; prompt: string; timeZone: string; message: string; schedule: { timing: TimingPlan; times: Array<string | null> }; items: Array<PlannedPost & { state: MotionState; videoJobId?: string; retryCount: number; providerName?: string; modelName?: string }>; results: CampaignResult[] };

type TimingMode = "auto" | "now" | "queue" | "schedule";
type TimingPlan = { mode: TimingMode; label: string; start: string | null; end: string | null; weekdaysOnly: boolean; postsPerWeek: number | null; launchDay: number | null };

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface PublishingProvider {
  id: string;
  name: string;
  listDestinations(): Promise<BufferDestination[]>;
  createPost(input: { channelId: string; service: string; text: string; mediaUrl: string; mediaType?: MediaType; surface: PublicationSurface; mode: string; dueAt?: string; aiAssisted: boolean }): Promise<BufferPost>;
  getPostStatus(id: string): Promise<BufferPostStatus>;
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

function statusFor(error: unknown, fallback: number) {
  const message = error instanceof Error ? error.message : "";
  return /different brand|do not have access|brand is unavailable/i.test(message) ? 403 : fallback;
}

function authorized(request: Request, env: Env) {
  return Boolean(env.UPLOAD_KEY && request.headers.get("X-Upload-Key") === env.UPLOAD_KEY);
}

function actorId(request: Request) {
  return request.headers.get("oai-authenticated-user-id")?.trim() || OWNER_ID;
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

async function getBufferChannels(env: Env): Promise<BufferDestination[]> {
  const account = await bufferRequest(env, `query Account { account { organizations { id name } } }`);
  const organizations = (account.account as { organizations?: Array<{ id: string; name: string }> })?.organizations || [];
  const lists = await Promise.all(organizations.map(async (organization) => {
    const data = await bufferRequest(env, `query Channels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name displayName service avatar isQueuePaused } }`, { organizationId: organization.id });
    return (data.channels as BufferDestination[] || []).map((channel) => ({ ...channel, organizationName: organization.name }));
  }));
  return lists.flat();
}

async function getBufferPostStatus(env: Env, id: string): Promise<BufferPostStatus> {
  const data = await bufferRequest(env, `query PostStatus($input: PostInput!) { post(input: $input) { id channelId status dueAt sentAt externalLink error { message supportUrl } } }`, { input: { id } });
  return data.post as BufferPostStatus;
}

async function getBufferPostStatuses(env: Env, ids: string[]): Promise<BufferPostStatus[]> {
  const results: BufferPostStatus[] = [];
  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = ids.slice(offset, offset + 10);
    const definitions = batch.map((_, index) => `$input${index}: PostInput!`).join(", ");
    const selections = batch.map((_, index) => `post${index}: post(input: $input${index}) { id channelId status dueAt sentAt externalLink error { message supportUrl } }`).join("\n");
    const variables = Object.fromEntries(batch.map((id, index) => [`input${index}`, { id }]));
    try {
      const data = await bufferRequest(env, `query PostStatuses(${definitions}) { ${selections} }`, variables);
      for (let index = 0; index < batch.length; index++) {
        const current = data[`post${index}`] as BufferPostStatus | undefined;
        if (current) results.push(current);
      }
    } catch {
      const fallback = await Promise.allSettled(batch.map((id) => getBufferPostStatus(env, id)));
      for (const item of fallback) if (item.status === "fulfilled") results.push(item.value);
    }
  }
  return results;
}

async function reconcileDeliveries(request: Request, env: Env, brandId: string) {
  if (!env.DB || !env.BUFFER_API_KEY) return { checked: 0, sent: 0, failed: 0, pending: 0 };
  const jobs = await pendingDeliveryJobs(env, brandId, 50);
  if (!jobs.length) return { checked: 0, sent: 0, failed: 0, pending: 0 };
  const byProviderPostId = new Map(jobs.map((job) => [job.providerPostId, job]));
  const statuses = await getBufferPostStatuses(env, jobs.map((job) => job.providerPostId));
  let sent = 0;
  let failed = 0;
  await Promise.all(statuses.map(async (current) => {
    const job = byProviderPostId.get(current.id);
    if (!job) return;
    const deliveryError = current.status === "error" ? current.error?.message || "Buffer could not publish this post." : null;
    if (current.status === "sent") { sent += 1; await finishPublishJob(env, job.id, "sent", current.id, null); }
    if (current.status === "error") { failed += 1; await finishPublishJob(env, job.id, "failed", current.id, deliveryError); }
    await recordDelivery(env, { publishJobId: job.id, brandId, providerStatus: current.status || null, publicUrl: current.externalLink || null, error: deliveryError });
  }));
  const summary = { checked: statuses.length, sent, failed, pending: Math.max(0, statuses.length - sent - failed) };
  await audit(env, brandId, "delivery_reconciliation_completed", summary, actorId(request));
  return summary;
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

const monthNumbers: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function clockParts(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) throw new Error(`Could not understand scheduled time “${value}”.`);
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 1 || hour > 12 || minute > 59) throw new Error(`Invalid scheduled time “${value}”.`);
  if (match[3].toLowerCase() === "pm" && hour !== 12) hour += 12;
  if (match[3].toLowerCase() === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function explicitSchedule(prompt: string, timeZone: string) {
  const slots: Date[] = [];
  const time = "(\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?))";
  const range = new RegExp(`\\b(${Object.keys(monthNumbers).join("|")})\\s+(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2}),?\\s*(\\d{4})\\s*(?::|at)?\\s*${time}(?:\\s*(?:and|&)\\s*${time})?`, "gi");
  for (const match of prompt.matchAll(range)) {
    const month = monthNumbers[match[1].toLowerCase()];
    const startDay = Number(match[2]);
    const endDay = Number(match[3]);
    const year = Number(match[4]);
    const clocks = [match[5], match[6]].filter(Boolean).map((value) => clockParts(value.replace(/\./g, "")));
    if (endDay < startDay || endDay - startDay > 90) throw new Error("The requested schedule date range is invalid.");
    for (let day = startDay; day <= endDay; day++) for (const clock of clocks) slots.push(wallToUtc(year, month, day, clock.hour, clock.minute, timeZone));
  }
  const single = new RegExp(`\\b(${Object.keys(monthNumbers).join("|")})\\s+(\\d{1,2}),?\\s*(\\d{4})\\s*(?::|at)?\\s*${time}`, "gi");
  for (const match of prompt.matchAll(single)) {
    const month = monthNumbers[match[1].toLowerCase()];
    const clock = clockParts(match[4].replace(/\./g, ""));
    slots.push(wallToUtc(Number(match[3]), month, Number(match[2]), clock.hour, clock.minute, timeZone));
  }
  return [...new Map(slots.map((slot) => [slot.toISOString(), slot])).values()].sort((a, b) => a.getTime() - b.getTime());
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
    mode = "schedule";
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
  const explicit = explicitSchedule(prompt, zone);
  if (explicit.length) {
    if (explicit.length < count) throw new Error(`The prompt defines ${explicit.length} exact posting time${explicit.length === 1 ? "" : "s"}, but ${count} posts were created. No posts were submitted.`);
    const selected = explicit.slice(0, count);
    if (selected.some((slot) => slot.getTime() <= now.getTime())) throw new Error("One or more requested posting times are in the past. No posts were submitted or moved.");
    return { timing: { ...timing, label: "Exact times from prompt", start: dateKey(selected[0], zone), end: dateKey(selected[selected.length - 1], zone) }, times: selected.map((slot) => slot.toISOString()) };
  }
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
    while (scheduled.getTime() < now.getTime() + 60 * 60 * 1000) {
      key = addLocalDays(key, 1);
      const next = key.split("-").map(Number);
      scheduled = wallToUtc(next[0], next[1], next[2], hours[index % hours.length], (index * 13) % 47, zone);
    }
    times.push(scheduled.toISOString());
  }
  return { timing, times };
}

function selectChannels(prompt: string, channels: Array<Record<string, unknown>>, requestedIds: string[], brandId = ATLASIUM_BRAND_ID) {
  if (requestedIds.length) return channels.filter((channel) => requestedIds.includes(String(channel.id)));
  if (brandId !== ATLASIUM_BRAND_ID) return channels;
  const linkedin = channels.filter((channel) => String(channel.service).toLowerCase() === "linkedin");
  const personalLinkedIn = linkedin.find((channel) => /blair|personal/i.test(`${channel.displayName || ""} ${channel.name || ""}`));
  const companyLinkedIn = linkedin.find((channel) => channel !== personalLinkedIn) || linkedin[0];
  const selected: Array<Record<string, unknown>> = [];
  const add = (channel: Record<string, unknown> | undefined) => { if (channel && !selected.includes(channel)) selected.push(channel); };
  add(personalLinkedIn);
  add(companyLinkedIn);
  add(channels.find((channel) => String(channel.service).toLowerCase() === "tiktok"));
  add(channels.find((channel) => String(channel.service).toLowerCase() === "instagram"));
  add(channels.find((channel) => String(channel.service).toLowerCase() === "facebook"));
  return selected;
}

function isPersonalLinkedIn(channel: Record<string, unknown>) {
  return String(channel.service).toLowerCase() === "linkedin" && /blair|personal/i.test(`${channel.displayName || ""} ${channel.name || ""}`);
}

function captionForChannel(post: AgentPlan["posts"][number], channel: Record<string, unknown>) {
  const service = String(channel.service).toLowerCase();
  if (service === "linkedin") return isPersonalLinkedIn(channel) ? post.personalLinkedInCaption || post.caption : post.companyLinkedInCaption || post.caption;
  if (service === "instagram") return post.instagramCaption || post.caption;
  if (service === "facebook") return post.facebookCaption || post.caption;
  if (service === "tiktok") return post.tiktokCaption || post.caption;
  return post.caption;
}

function routePosts(_prompt: string, posts: AgentPlan["posts"], channels: Array<Record<string, unknown>>, manual: boolean, brandId = ATLASIUM_BRAND_ID) {
  if (!channels.length) return [];
  if (manual) return posts.flatMap((post) => channels.map((channel) => ({ post, channel, caption: captionForChannel(post, channel) })));
  if (brandId !== ATLASIUM_BRAND_ID) {
    const linkedIn = channels.find((channel) => String(channel.service).toLowerCase() === "linkedin");
    const instagram = channels.find((channel) => String(channel.service).toLowerCase() === "instagram");
    const facebook = channels.find((channel) => String(channel.service).toLowerCase() === "facebook");
    const tiktok = channels.find((channel) => String(channel.service).toLowerCase() === "tiktok");
    return posts.flatMap((post, index) => {
      const compatible = (post as PlannedPost).mediaType === "video" ? channels : channels.filter((channel) => String(channel.service).toLowerCase() !== "tiktok");
      const primary = compatible[index % Math.max(1, compatible.length)];
      const destinations = [primary, linkedIn, index % 2 === 0 ? instagram : facebook, (post as PlannedPost).mediaType === "video" ? tiktok : null].filter(Boolean) as Array<Record<string, unknown>>;
      return [...new Map(destinations.map((channel) => [String(channel.id), channel])).values()].map((channel) => ({ post, channel, caption: captionForChannel(post, channel) }));
    });
  }
  const personal = channels.find(isPersonalLinkedIn);
  const company = channels.find((channel) => String(channel.service).toLowerCase() === "linkedin" && !isPersonalLinkedIn(channel));
  const tiktok = channels.find((channel) => String(channel.service).toLowerCase() === "tiktok");
  const instagram = channels.find((channel) => String(channel.service).toLowerCase() === "instagram");
  const facebook = channels.find((channel) => String(channel.service).toLowerCase() === "facebook");
  return posts.flatMap((post, index) => {
    const destinations = [personal, company, tiktok, index % 2 === 0 ? instagram : facebook].filter(Boolean) as Array<Record<string, unknown>>;
    return [...new Map(destinations.map((channel) => [String(channel.id), channel])).values()].map((channel) => ({ post, channel, caption: captionForChannel(post, channel) }));
  });
}

const motionStyles = ["slow cinematic push-in", "gentle horizontal camera drift", "layered parallax", "soft light sweep", "controlled particles and data movement", "animated lines and pathways"];

function motionCount(prompt: string, count: number) {
  const text = prompt.toLowerCase();
  if (/\b(all[- ]static|static only|no motion)\b/.test(text)) return 0;
  const numbered = text.match(/\b(\d+)\s+(?:motion|animated|video)\s+posts?\b/);
  if (numbered) return Math.min(count, Number(numbered[1]));
  const percent = text.match(/\b(\d{1,3})\s*%\s+(?:motion|animated|video)\b/);
  if (percent) return Math.min(count, Math.round(count * Math.min(100, Number(percent[1])) / 100));
  if (/\b(all|every)\s+(?:post|item)s?\s+(?:with\s+)?(?:motion|animated|video)\b/.test(text)) return count;
  return count < 3 ? (/\bsome motion\b/.test(text) ? 1 : 0) : Math.max(1, Math.round(count / 3));
}

function addMotionPlan(prompt: string, posts: PlannedPost[], brand: BrandContext) {
  const count = motionCount(prompt, posts.length);
  const selected = new Set<number>();
  for (let index = 0; index < count; index++) selected.add(Math.min(posts.length - 1, Math.floor(index * posts.length / Math.max(1, count))));
  return posts.map((post, index) => {
    if (!selected.has(index)) return post;
    const style = motionStyles[index % motionStyles.length];
    return { ...post, mediaType: "video" as const, motionStyle: style, motionPrompt: `Preserve the source composition and ${brand.name} visual identity. Add only ${style}. ${brand.visualStyle || "Premium, modern and clean"}. No new claims, logos, wild movement, camera shake, or generic AI effects.`, duration: 4, aspectRatio: "9:16" };
  });
}

function normalizedContent(text: string) {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function storyService(service: string) {
  return ["instagram", "facebook"].includes(service.toLowerCase());
}

function surfaceModeFor(prompt: string, requested?: string, manual = false): SurfaceMode {
  if (manual && ["main", "story", "main_and_story"].includes(String(requested))) return requested as SurfaceMode;
  if (/\b(?:story|stories)\s*[- ]?only\b|\bonly\s+(?:an?\s+)?(?:instagram\s+|facebook\s+)?(?:story|stories)\b/i.test(prompt)) return "story";
  if (/\b(?:main|feed|profile)\s+(?:post\s+)?only\b|\bno\s+(?:story|stories)\b/i.test(prompt)) return "main";
  return "main_and_story";
}

function mainSurface(service: string, mediaType: MediaType, typeHint = ""): PublicationSurface {
  const normalized = service.toLowerCase();
  if (normalized === "instagram" || normalized === "facebook") return mediaType === "video" || /\breels?\b/i.test(typeHint) ? "reel" : "feed";
  if (normalized === "tiktok") return "video";
  if (normalized === "pinterest") return "pin";
  if (normalized === "youtube") return /\bshorts?\b/i.test(typeHint) ? "short" : "video";
  return "post";
}

function surfaceName(service: string, surface: PublicationSurface) {
  const platform = service.charAt(0).toUpperCase() + service.slice(1).toLowerCase();
  const label = surface === "feed" ? (service.toLowerCase() === "facebook" ? "Post" : "Feed") : surface === "reel" ? "Reel" : surface === "story" ? "Story" : surface === "pin" ? "Pin" : surface === "short" ? "Short" : surface === "video" ? "Video Post" : "Post";
  return `${platform} ${label}`;
}

function expandSurfaceAssignments<T extends { post: AgentPlan["posts"][number]; channel: Record<string, unknown>; caption: string }>(assignments: T[], mode: SurfaceMode, typeHint = "") {
  return assignments.flatMap((assignment) => {
    const service = String(assignment.channel.service).toLowerCase();
    const mediaType = (assignment.post as PlannedPost).mediaType || "image";
    const main = mainSurface(service, mediaType, typeHint);
    const surfaces: PublicationSurface[] = storyService(service)
      ? [...(mode === "story" ? [] : [main]), ...(mode === "main" ? [] : ["story" as const])]
      : [main];
    return surfaces.map((surface) => ({ ...assignment, surface, surfaceId: `${service}:${surface}`, surfaceLabel: surfaceName(service, surface) }));
  });
}

function surfaceMedia(post: PlannedPost, surface: PublicationSurface) {
  if (post.mediaType === "video" && post.hostedMediaUrl?.endsWith(".mp4")) return post.hostedMediaUrl;
  return surface === "story" ? post.storyImageUrl : post.hostedMediaUrl || post.imageUrl;
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

async function createBufferPost(env: Env, input: { channelId: string; service: string; text: string; mediaUrl: string; mediaType?: MediaType; surface: PublicationSurface; mode: string; dueAt?: string; aiAssisted: boolean }): Promise<BufferPost> {
  const service = input.service.toLowerCase();
  const postType = input.surface === "story" ? "story" : input.surface === "reel" ? "reel" : "post";
  const metadata = service === "instagram"
    ? { instagram: { type: postType, shouldShareToFeed: input.surface !== "story", isAiGenerated: input.aiAssisted } }
    : service === "facebook"
      ? { facebook: { type: postType } }
      : service === "tiktok"
        ? { tiktok: input.mediaType === "video" ? { isAiGenerated: input.aiAssisted } : { title: input.text.slice(0, 90) } }
        : undefined;
  const data = await bufferRequest(env, `mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id dueAt status channelId } } ... on MutationError { message } } }`, {
    input: {
      text: input.text,
      channelId: input.channelId,
      schedulingType: "automatic",
      mode: input.mode,
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      assets: [input.mediaType === "video" ? { video: { url: input.mediaUrl, metadata: { thumbnailOffset: 1000 } } } : { image: { url: input.mediaUrl } }],
      ...(metadata ? { metadata } : {}),
      aiAssisted: input.aiAssisted,
      source: "echoflow-social",
    },
  });
  const result = data.createPost as { __typename?: string; message?: string; post?: BufferPost };
  if (result?.__typename !== "PostActionSuccess") throw new Error(result?.message || "Buffer rejected the post.");
  if (!result.post?.id || !result.post.channelId) throw new Error("Buffer did not confirm the created post and channel.");
  if (result.post.channelId !== input.channelId) throw new Error("Buffer confirmed the post on a different channel than requested.");
  if (input.mode === "customScheduled") {
    if (!input.dueAt || !result.post.dueAt) throw new Error("Buffer did not confirm the requested scheduled time.");
    if (Math.abs(Date.parse(result.post.dueAt) - Date.parse(input.dueAt)) > 1000) throw new Error("Buffer confirmed a different scheduled time than requested.");
  }
  return result.post;
}

function publishingProvider(env: Env): PublishingProvider {
  return {
    id: "buffer",
    name: "Buffer",
    listDestinations: () => getBufferChannels(env),
    createPost: (input) => createBufferPost(env, input),
    getPostStatus: (id) => getBufferPostStatus(env, id),
  };
}

function responseText(data: { output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }> }) {
  for (const item of data.output || []) for (const content of item.content || []) {
    if (content.type === "refusal") throw new Error(content.refusal || "OpenAI declined this request.");
    if (content.type === "output_text" && content.text) return content.text;
  }
  throw new Error("OpenAI returned no campaign plan.");
}

async function createPlan(env: Env, prompt: string, channelNames: string[], timingOverride: string, brand: BrandContext): Promise<AgentPlan> {
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI connection required.");
  const schema = {
    type: "object", additionalProperties: false, required: ["campaign", "timing", "posts"],
    properties: {
      campaign: { type: "string" },
      timing: { type: "string", enum: ["auto", "now", "queue", "schedule"] },
      posts: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["concept", "caption", "imagePrompt", "personalLinkedInCaption", "companyLinkedInCaption", "instagramCaption", "facebookCaption", "tiktokCaption"], properties: {
        concept: { type: "string" }, caption: { type: "string" }, imagePrompt: { type: "string" },
        personalLinkedInCaption: { type: "string" }, companyLinkedInCaption: { type: "string" }, instagramCaption: { type: "string" }, facebookCaption: { type: "string" }, tiktokCaption: { type: "string" },
      } } },
    },
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_TEXT_MODEL || "gpt-5.6-luna",
      input: [
        { role: "system", content: `You are EchoFlow Social's campaign planner for the brand ${brand.name}. Turn the request into 1-20 distinct campaign items, using the exact requested count when stated. Preserve facts and intent; never invent offers, prices, dates, proof, links, personal experiences, founder stories, or claims. Adapt every caption for the connected platform while keeping the underlying message consistent. ${brand.id === ATLASIUM_BRAND_ID ? "For Blair Ryan Barton's professional LinkedIn, write a genuine founder perspective without inventing first-person experience. Also produce a separate Atlasium company LinkedIn version." : "Do not use Atlasium, Blair Ryan Barton, or another brand's identity unless the request explicitly quotes it as subject matter."} Brand profile: What it does: ${brand.whatItDoes || "Not supplied"}. Audience: ${brand.targetAudience || "Not supplied"}. Offers: ${brand.mainOffers || "Not supplied"}. CTA: ${brand.primaryCta || "Not supplied"}. Tone: ${brand.tone || "clear and professional"}. Use: ${brand.wordsUse || "No special terms"}. Avoid: ${brand.wordsAvoid || "No special terms"}. Instructions: ${brand.instructions || "None"}. Each image prompt must describe a portrait-friendly social image consistent with this visual direction: ${brand.visualStyle || "premium, modern and clean"}. Do not add unapproved logos and keep rendered text minimal or absent. Infer timing from the request: now only when explicitly immediate; queue only when explicitly requested; schedule for stated date windows; otherwise auto. Return only the schema.` },
        { role: "user", content: `Today is ${new Date().toISOString()}. Brand: ${brand.name}. Channels: ${channelNames.join(", ")}. UI timing preference: ${timingOverride}. Request: ${prompt}` },
      ],
      text: { format: { type: "json_schema", name: "echoflow_campaign", strict: true, schema } },
    }),
  });
  const data = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "OpenAI campaign planning failed.");
  const plan = JSON.parse(responseText(data)) as AgentPlan;
  if (["now", "queue", "schedule"].includes(timingOverride)) plan.timing = timingOverride as AgentPlan["timing"];
  return plan;
}

async function imageVariant(env: Env, binary: Uint8Array, width: number, height: number) {
  if (!env.IMAGES) return binary;
  try {
    const body = new Response(binary.slice().buffer as ArrayBuffer).body;
    if (!body) return binary;
    const transformed = await env.IMAGES.input(body).transform({ width, height, fit: "cover", gravity: "center" }).output({ format: "image/png", quality: 95 });
    const response = transformed.response();
    if (!response.ok) return binary;
    return new Uint8Array(await response.arrayBuffer());
  } catch { return binary; }
}

async function storeGeneratedImage(request: Request, env: Env, binary: Uint8Array, brandId: string, variant: "feed" | "story") {
  const key = `brands/${brandId}/${new Date().toISOString().slice(0, 10)}/ai-${crypto.randomUUID()}-${variant}.png`;
  await env.UPLOADS.put(key, binary, { httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: `echoflow-ai-${variant}.png`, brandId, surface: variant } });
  return `${new URL(request.url).origin}/i/${key}`;
}

async function generateAndHostImages(request: Request, env: Env, prompt: string, brandId = ATLASIUM_BRAND_ID, includeStory = false) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.OPENAI_IMAGE_MODEL || "gpt-image-2", prompt: `${prompt}. Compose a portrait master with the central subject and any essential details inside a safe area suitable for both a 4:5 feed crop and a 9:16 Story crop.`, size: "1024x1536", quality: "medium", output_format: "png" }),
  });
  const data = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
  if (!response.ok || !data.data?.[0]?.b64_json) throw new Error(data.error?.message || "OpenAI image generation failed.");
  const binary = Uint8Array.from(atob(data.data[0].b64_json), (character) => character.charCodeAt(0));
  const imageUrl = await storeGeneratedImage(request, env, await imageVariant(env, binary, 1080, 1350), brandId, "feed");
  if (!includeStory) return { imageUrl };
  try {
    const storyImageUrl = await storeGeneratedImage(request, env, await imageVariant(env, binary, 1080, 1920), brandId, "story");
    return { imageUrl, storyImageUrl };
  } catch (error) {
    return { imageUrl, storyMediaError: `Story media formatting failed: ${error instanceof Error ? error.message : "the vertical asset could not be stored"}` };
  }
}

async function generateAndHostImage(request: Request, env: Env, prompt: string, brandId = ATLASIUM_BRAND_ID) {
  return (await generateAndHostImages(request, env, prompt, brandId, false)).imageUrl;
}

function playableMp4(bytes: Uint8Array) {
  return bytes.length > 16 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
}

function motionProvider(env: Env): MotionProvider {
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI connection required for motion generation.");
  const providerName = "openai";
  const modelName = env.OPENAI_VIDEO_MODEL || "sora-2";
  return {
    providerName,
    modelName,
    async createJob(prompt, duration) {
    const form = new FormData();
      form.set("model", modelName);
      form.set("prompt", prompt);
    form.set("seconds", String(duration));
    form.set("size", "720x1280");
    const response = await fetch("https://api.openai.com/v1/videos", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
      const job = await response.json() as { id?: string; status?: string; error?: { message?: string } };
      if (!response.ok || !job.id) throw new Error(job.error?.message || "OpenAI motion generation could not start.");
      return { id: job.id, status: job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : job.status === "in_progress" ? "rendering" : "queued" };
    },
    async getJobStatus(id) {
      const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
      const job = await response.json() as { status?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(job.error?.message || "Could not check motion generation status.");
      return { status: job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : job.status === "in_progress" ? "rendering" : "queued", error: job.error?.message };
    },
    async downloadResult(id) {
      const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(id)}/content`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
      if (!response.ok) throw new Error("Could not download the generated motion video.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!playableMp4(bytes)) throw new Error("OpenAI returned an invalid MP4 video.");
      return bytes;
    },
    async handleWebhook() { throw new Error("OpenAI video webhooks are not configured; authenticated polling is active."); },
  };
}

async function hostMotion(request: Request, env: Env, bytes: Uint8Array, brandId = ATLASIUM_BRAND_ID) {
  const key = `brands/${brandId}/${new Date().toISOString().slice(0, 10)}/motion-${crypto.randomUUID()}.mp4`;
  await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: "video/mp4", cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: "echoflow-motion.mp4", brandId } });
  const url = `${new URL(request.url).origin}/i/${key}`;
  if (typeof env.UPLOADS.get === "function") {
    const stored = await env.UPLOADS.get(key);
    const headers = new Headers();
    stored?.writeHttpMetadata(headers);
    if (!stored || !/^video\/mp4/i.test(headers.get("content-type") || "")) throw new Error("Hosted motion video could not be verified in media storage.");
  }
  return url;
}

const campaignKey = (id: string, brandId = ATLASIUM_BRAND_ID) => brandId === ATLASIUM_BRAND_ID ? `.atlasium-campaigns/${id}.json` : `.echoflow-campaigns/${brandId}/${id}.json`;
async function saveCampaign(env: Env, campaign: CampaignRecord) {
  campaign.updatedAt = new Date().toISOString();
  const key = campaignKey(campaign.id, campaign.brandId);
  await env.UPLOADS.put(key, new TextEncoder().encode(JSON.stringify(campaign)), { httpMetadata: { contentType: "application/json", cacheControl: "no-store" }, customMetadata: { brandId: campaign.brandId, workspaceId: campaign.workspaceId } });
  await indexCampaign(env, campaign, key);
}
async function loadCampaign(env: Env, id: string, requestedBrandId?: string | null) {
  const indexedBrandId = await campaignOwner(env, id);
  const brandId = indexedBrandId || requestedBrandId || ATLASIUM_BRAND_ID;
  const object = await env.UPLOADS.get(campaignKey(id, brandId));
  if (!object) return null;
  const campaign = await new Response(object.body).json() as CampaignRecord;
  campaign.brandId ||= brandId;
  campaign.workspaceId ||= WORKSPACE_ID;
  return campaign;
}

async function motionPreview(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
  const body = await request.json() as { prompt?: string; brandId?: string };
  const brand = await requireBrand(env, body.brandId);
  const prompt = String(body.prompt || `${brand.visualStyle || "Premium"} ${brand.name} visual with subtle cinematic motion`).slice(0, 1000);
  const imageUrl = await generateAndHostImage(request, env, prompt, brand.id);
  const provider = motionProvider(env);
  const job = await provider.createJob(`Add a slow cinematic push-in and soft light sweep. ${prompt}`, 4);
  const id = crypto.randomUUID();
  const item: CampaignRecord["items"][number] = { id: `${id}-01`, itemIndex: 0, concept: "Motion preview", caption: "", imagePrompt: prompt, mediaType: "video", motionStyle: "slow cinematic push-in", motionPrompt: `Add a slow cinematic push-in and soft light sweep. ${prompt}`, duration: 4, aspectRatio: "9:16", imageUrl, hostedMediaUrl: undefined, state: job.status, videoJobId: job.id, retryCount: 0, providerName: provider.providerName, modelName: provider.modelName };
  const campaign: CampaignRecord = { id, workspaceId: WORKSPACE_ID, brandId: brand.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), prompt, timeZone: brand.timezone, message: "PROCESSING MOTION", schedule: { timing: { mode: "auto", label: "Media-only proof", start: null, end: null, weekdaysOnly: false, postsPerWeek: null, launchDay: null }, times: [null] }, items: [item], results: [] };
  await saveCampaign(env, campaign);
  return json({ campaignId: id, mediaType: "video", duration: 4, aspectRatio: "9:16", imageUrl, videoJobId: job.id, status: job.status, providerName: provider.providerName, modelName: provider.modelName }, 202);
}

async function runAgent(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
  if (!env.BUFFER_API_KEY) return json({ error: "Buffer is not connected yet." }, 503);
  if (!env.OPENAI_API_KEY) return json({ error: "OpenAI connection required." }, 503);
  const body = await request.json() as { prompt?: string; channels?: string[]; timing?: string; timeZone?: string; selectedDueAt?: string; selectedLocalTime?: string; brandId?: string; surfaceMode?: string; surfaceModeManual?: boolean };
  const prompt = String(body.prompt || "").trim();
  if (!prompt || prompt.length > 4000) return json({ error: "Enter a clear prompt under 4,000 characters." }, 400);
  const publisher = publishingProvider(env);
  const connected = await publisher.listDestinations();
  await ensureBrandSystem(env);
  const requestedBrandId = String(body.brandId || ATLASIUM_BRAND_ID);
  if (requestedBrandId === ATLASIUM_BRAND_ID) await syncAtlasiumChannels(env, connected);
  const brand = await requireBrand(env, requestedBrandId);
  const assignedIds = new Set(brand.channelIds.length ? brand.channelIds : connected.map((channel) => channel.id));
  const available = connected.filter((channel) => assignedIds.has(channel.id));
  const requestedIds = Array.isArray(body.channels) ? body.channels : [];
  const chosen = selectChannels(prompt, available, requestedIds, brand.id);
  if (!chosen.length || (requestedIds.length && chosen.length !== requestedIds.length)) return json({ error: "Choose at least one social destination assigned to this brand." }, 400);
  const surfaceMode = surfaceModeFor(prompt, body.surfaceMode, body.surfaceModeManual === true);
  const includeStoryMedia = surfaceMode !== "main" && chosen.some((channel) => storyService(String(channel.service)));
  const timing = ["auto", "now", "queue", "schedule"].includes(String(body.timing)) ? String(body.timing) : "auto";
  const plan = await createPlan(env, prompt, chosen.map((channel) => `${channel.service}: ${channel.displayName || channel.name}`), timing, brand);
  const scheduleNow = env.TEST_NOW && !Number.isNaN(Date.parse(env.TEST_NOW)) ? new Date(env.TEST_NOW) : new Date();
  const timeZone = validTimeZone(brand.timezone || String(body.timeZone || "America/Toronto"));
  let schedule = buildSchedule(prompt, plan.posts.length, timing, timeZone, scheduleNow);
  if (body.selectedDueAt || body.selectedLocalTime) {
    const local = body.selectedLocalTime?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    const selected = local ? wallToUtc(Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]), Number(local[5]), timeZone) : new Date(body.selectedDueAt!);
    if (Number.isNaN(selected.getTime()) || selected.getTime() <= scheduleNow.getTime()) return json({ error: "The selected schedule time is invalid or already past. No posts were submitted." }, 400);
    schedule = { timing: { ...schedule.timing, mode: "schedule", label: "Exact time selected in the UI", start: dateKey(selected, timeZone), end: dateKey(selected, timeZone) }, times: Array(plan.posts.length).fill(selected.toISOString()) };
  }
  const runId = crypto.randomUUID();
  let posts: PlannedPost[] = plan.posts.map((post, index) => ({ ...post, id: `${runId}-${String(index + 1).padStart(2, "0")}`, itemIndex: index, mediaType: "image", motionStyle: null, motionPrompt: null, duration: null, aspectRatio: "4:5" }));
  posts = addMotionPlan(prompt, posts, brand);
  const provider = motionProvider(env);
  posts = await Promise.all(posts.map(async (post) => {
    const imagePromise = generateAndHostImages(request, env, post.imagePrompt, brand.id, includeStoryMedia);
    const jobPromise = post.mediaType === "video" ? provider.createJob(post.motionPrompt!, post.duration || 4).then((job) => ({ job })).catch((error) => ({ error })) : Promise.resolve(null);
    const [images, motion] = await Promise.all([imagePromise, jobPromise]);
    const prepared = { ...post, ...images, hostedMediaUrl: images.imageUrl } as PlannedPost & { videoJobId?: string; state?: MotionState; retryCount?: number; providerName?: string; modelName?: string };
    if (motion && "job" in motion) {
      Object.assign(prepared, { videoJobId: motion.job.id, state: motion.job.status, retryCount: 0, providerName: provider.providerName, modelName: provider.modelName });
      if (motion.job.status === "completed") prepared.hostedMediaUrl = await hostMotion(request, env, await provider.downloadResult(motion.job.id), brand.id);
    } else if (motion && "error" in motion) {
      prepared.mediaType = "image"; prepared.motionError = motion.error instanceof Error ? motion.error.message : "Motion generation failed; a static image was used.";
    }
    return prepared;
  }));
  const assignments = expandSurfaceAssignments(routePosts(prompt, posts, chosen, requestedIds.length > 0, brand.id), surfaceMode, prompt);
  const results: Array<Record<string, unknown>> = [];
  const submitted = new Set<string>();
  for (const assignment of assignments) {
    const { post, channel, caption, surface, surfaceId, surfaceLabel } = assignment;
    const stablePost = post as PlannedPost;
    const mode = schedule.timing.mode === "now" ? "shareNow" : schedule.timing.mode === "queue" ? "addToQueue" : "customScheduled";
    const requestedDueAt = mode === "customScheduled" ? schedule.times[stablePost.itemIndex]! : undefined;
    const fingerprint = `${String(channel.id)}|${surfaceId}|${normalizedContent(caption)}|${requestedDueAt ? requestedDueAt.slice(0, 16) : mode}`;
    if (submitted.has(fingerprint)) continue;
    submitted.add(fingerprint);
    const submissionId = `${stablePost.id}:${String(channel.id)}:${surface}`;
    const mediaUrl = surfaceMedia(stablePost, surface);
    if (surface === "story" && stablePost.mediaType === "image" && (!mediaUrl || stablePost.storyMediaError)) {
      results.push({ id: submissionId, workspaceId: WORKSPACE_ID, brandId: brand.id, itemId: stablePost.id, itemIndex: stablePost.itemIndex, concept: post.concept, caption, imageUrl: stablePost.imageUrl, mediaType: stablePost.mediaType, hostedMediaUrl: null, channelId: String(channel.id), channel: channel.displayName || channel.name, service: channel.service, surface, surfaceId, surfaceLabel, status: "FAILED", bufferStatus: null, requestedDueAt: requestedDueAt || null, dueAt: null, timeZone, error: `${stablePost.storyMediaError || "Story media could not be prepared."} Main publication was preserved.` });
      continue;
    }
    const pendingMotion = stablePost.mediaType === "video" && !stablePost.hostedMediaUrl?.endsWith(".mp4");
    if (pendingMotion) {
      results.push({ id: submissionId, workspaceId: WORKSPACE_ID, brandId: brand.id, itemId: stablePost.id, itemIndex: stablePost.itemIndex, concept: post.concept, caption, imageUrl: surface === "story" ? stablePost.storyImageUrl || stablePost.imageUrl : stablePost.imageUrl, mediaType: "video", motionStyle: stablePost.motionStyle, motionPrompt: stablePost.motionPrompt, duration: stablePost.duration, aspectRatio: stablePost.aspectRatio, hostedMediaUrl: null, channelId: String(channel.id), channel: channel.displayName || channel.name, service: String(channel.service), surface, surfaceId, surfaceLabel, status: "PROCESSING MOTION", bufferStatus: null, requestedDueAt: requestedDueAt || null, dueAt: null, timeZone });
      continue;
    }
    const reserved = await reservePublishJob(env, { id: submissionId, brandId: brand.id, campaignId: runId, postId: stablePost.id, destinationId: `${String(channel.id)}#${surfaceId}`, scheduledTime: requestedDueAt || mode, provider: publisher.id });
    if (!reserved) {
      results.push({ id: submissionId, workspaceId: WORKSPACE_ID, brandId: brand.id, itemId: stablePost.id, itemIndex: stablePost.itemIndex, concept: post.concept, caption, imageUrl: mediaUrl || stablePost.imageUrl, mediaType: stablePost.mediaType, hostedMediaUrl: mediaUrl, channelId: String(channel.id), channel: channel.displayName || channel.name, service: channel.service, surface, surfaceId, surfaceLabel, status: "DUPLICATE PREVENTED", bufferStatus: null, requestedDueAt: requestedDueAt || null, dueAt: null, timeZone });
      continue;
    }
    try {
      const created = await publisher.createPost({ channelId: String(channel.id), service: String(channel.service), text: caption, mediaUrl: mediaUrl!, mediaType: stablePost.mediaType, surface, mode, dueAt: requestedDueAt || undefined, aiAssisted: true });
      await finishPublishJob(env, submissionId, "confirmed", created.id, null);
      const confirmedChannel = available.find((item) => String(item.id) === created.channelId);
      results.push({ id: submissionId, workspaceId: WORKSPACE_ID, brandId: brand.id, itemId: stablePost.id, itemIndex: stablePost.itemIndex, concept: post.concept, caption, imageUrl: mediaUrl || stablePost.imageUrl, mediaType: stablePost.mediaType, motionStyle: stablePost.motionStyle, motionPrompt: stablePost.motionPrompt, duration: stablePost.duration, aspectRatio: surface === "story" ? "9:16" : stablePost.aspectRatio, hostedMediaUrl: mediaUrl, motionError: stablePost.motionError || null, channelId: created.channelId, channel: confirmedChannel?.displayName || confirmedChannel?.name || channel.displayName || channel.name, service: confirmedChannel?.service || channel.service, surface, surfaceId, surfaceLabel, postId: created.id, status: mode === "shareNow" ? "PUBLISHING" : mode === "addToQueue" ? "QUEUED" : "SCHEDULED", bufferStatus: created.status || null, requestedDueAt: requestedDueAt || null, dueAt: created.dueAt || null, timeZone });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Buffer rejected this post.";
      await finishPublishJob(env, submissionId, "failed", null, message);
      results.push({ id: submissionId, workspaceId: WORKSPACE_ID, brandId: brand.id, itemId: stablePost.id, itemIndex: stablePost.itemIndex, concept: post.concept, caption, imageUrl: mediaUrl || stablePost.imageUrl, mediaType: stablePost.mediaType, motionStyle: stablePost.motionStyle, motionPrompt: stablePost.motionPrompt, duration: stablePost.duration, aspectRatio: surface === "story" ? "9:16" : stablePost.aspectRatio, hostedMediaUrl: mediaUrl, motionError: stablePost.motionError || null, channelId: String(channel.id), channel: channel.displayName || channel.name, service: channel.service, surface, surfaceId, surfaceLabel, status: "FAILED", bufferStatus: null, requestedDueAt: requestedDueAt || null, dueAt: null, timeZone, error: message });
    }
  }
  const usedChannels = new Set(results.map((result) => String(result.channel)));
  const failed = results.filter((result) => result.status === "FAILED").length;
  const pending = results.filter((result) => result.status === "PROCESSING MOTION").length;
  const message = pending ? `PROCESSING MOTION — ${pending} destination${pending === 1 ? "" : "s"} will be sent to Buffer only after the MP4 is hosted.` : failed ? `${plan.posts.length} campaign item${plan.posts.length === 1 ? "" : "s"}; ${results.length - failed} destination submission${results.length - failed === 1 ? "" : "s"} confirmed and ${failed} failed.` : `${plan.posts.length} campaign item${plan.posts.length === 1 ? "" : "s"} created with ${results.length} confirmed destination submission${results.length === 1 ? "" : "s"} across ${usedChannels.size} channels.`;
  const campaign: CampaignRecord = { id: runId, workspaceId: WORKSPACE_ID, brandId: brand.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), prompt, timeZone, message, schedule, items: posts.map((post) => ({ ...post, state: ((post as PlannedPost & { state?: MotionState }).state || (post.mediaType === "video" ? "rendering" : "scheduled")) as MotionState, retryCount: (post as PlannedPost & { retryCount?: number }).retryCount || 0 })), results: results as CampaignResult[] };
  await saveCampaign(env, campaign);
  await audit(env, brand.id, "social_campaign_submitted", { campaignId: runId, campaignItems: plan.posts.length, destinationSubmissions: results.length, failed, pending, timing: schedule.timing.mode }, actorId(request));
  return json({ campaignId: runId, brandId: brand.id, message, campaign: plan.campaign, campaignItems: plan.posts.length, destinationSubmissions: results.length, postsCreated: results.length - failed - pending, channels: usedChannels.size, schedule: schedule.timing, results }, pending ? 202 : failed ? 207 : 201);
}

async function processCampaign(request: Request, env: Env, id: string) {
  if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
  const requestedBrandId = request.headers.get("X-Brand-ID") || new URL(request.url).searchParams.get("brandId") || ATLASIUM_BRAND_ID;
  const brand = await requireBrand(env, requestedBrandId);
  const campaign = await loadCampaign(env, id, brand.id);
  if (!campaign) return json({ error: "Campaign not found." }, 404);
  if (campaign.brandId !== brand.id) return json({ error: "This campaign belongs to a different brand." }, 403);
  const provider = motionProvider(env);
  const publisher = publishingProvider(env);
  const now = env.TEST_NOW && !Number.isNaN(Date.parse(env.TEST_NOW)) ? new Date(env.TEST_NOW) : new Date();
  // Recover media-only proofs rejected by the former same-origin HEAD check
  // without starting or charging for another video render.
  if (!campaign.results.length) for (const item of campaign.items.filter((candidate) => candidate.videoJobId && candidate.motionError?.includes("Hosted motion video could not be verified publicly"))) {
    item.hostedMediaUrl = await hostMotion(request, env, await provider.downloadResult(item.videoJobId!), campaign.brandId);
    item.mediaType = "video"; item.motionError = undefined; item.state = "scheduled";
  }
  for (const item of campaign.items.filter((candidate) => candidate.mediaType === "video" && ["queued", "rendering"].includes(candidate.state))) {
    let status: MotionJobStatus;
    try { status = await provider.getJobStatus(item.videoJobId!); }
    catch (error) { status = { status: "failed", error: error instanceof Error ? error.message : "Motion status check failed." }; }
    if (status.status === "queued" || status.status === "rendering") { item.state = status.status; continue; }
    if (status.status === "failed") {
      if (item.retryCount < 2) {
        item.retryCount += 1;
        try { const retry = await provider.createJob(item.motionPrompt!, item.duration || 4); item.videoJobId = retry.id; item.state = retry.status; }
        catch (error) { item.state = "failed"; item.motionError = error instanceof Error ? error.message : "Motion retry failed."; }
        continue;
      }
      item.mediaType = "image";
      item.hostedMediaUrl = item.imageUrl;
      item.motionError = `MOTION FAILED — STATIC FALLBACK USED${status.error ? `: ${status.error}` : ""}`;
      item.state = "scheduling";
    } else {
      item.state = "completed";
      await saveCampaign(env, campaign);
      item.state = "hosting";
      await saveCampaign(env, campaign);
      try { item.hostedMediaUrl = await hostMotion(request, env, await provider.downloadResult(item.videoJobId!), campaign.brandId); item.state = "scheduling"; }
      catch (error) { item.mediaType = "image"; item.hostedMediaUrl = item.imageUrl; item.state = "scheduling"; item.motionError = `MOTION FAILED — STATIC FALLBACK USED: ${error instanceof Error ? error.message : "Motion hosting failed."}`; }
    }
  }
  await saveCampaign(env, campaign);

  for (const item of campaign.items.filter((candidate) => ["scheduling", "completed"].includes(candidate.state))) {
    const destinations = campaign.results.filter((result) => result.itemId === item.id && result.status === "PROCESSING MOTION");
    for (const result of destinations) {
      const surface = result.surface || mainSurface(result.service, item.mediaType, campaign.prompt);
      result.surface = surface;
      result.surfaceId ||= `${result.service.toLowerCase()}:${surface}`;
      result.surfaceLabel ||= surfaceName(result.service, surface);
      const dueAt = result.requestedDueAt ? String(result.requestedDueAt) : undefined;
      const mode = campaign.schedule.timing.mode === "now" ? "shareNow" : campaign.schedule.timing.mode === "queue" ? "addToQueue" : "customScheduled";
      if (mode === "customScheduled" && (!dueAt || Date.parse(dueAt) <= now.getTime())) {
        result.status = "FAILED"; result.error = "Requested schedule passed before motion rendering completed. Nothing was moved or republished."; continue;
      }
      result.status = "SCHEDULING";
      await saveCampaign(env, campaign);
      const reserved = await reservePublishJob(env, { id: result.id, brandId: campaign.brandId, campaignId: campaign.id, postId: item.id, destinationId: `${result.channelId}#${result.surfaceId}`, scheduledTime: dueAt || mode, provider: publisher.id });
      if (!reserved) { result.status = "DUPLICATE PREVENTED"; result.error = "An identical publishing job already exists; no second submission was made."; await saveCampaign(env, campaign); continue; }
      try {
        const mediaUrl = surfaceMedia(item, surface);
        if (!mediaUrl) throw new Error(`${result.surfaceLabel} media is unavailable.`);
        const created = await publisher.createPost({ channelId: result.channelId, service: result.service, text: result.caption, mediaUrl, mediaType: item.mediaType, surface, mode, dueAt, aiAssisted: true });
        await finishPublishJob(env, result.id, "confirmed", created.id, null);
        Object.assign(result, { imageUrl: surface === "story" ? item.storyImageUrl || item.imageUrl : item.imageUrl, mediaType: item.mediaType, hostedMediaUrl: mediaUrl, motionError: item.motionError || null, postId: created.id, status: mode === "shareNow" ? "PUBLISHING" : mode === "addToQueue" ? "QUEUED" : item.mediaType === "image" && item.motionError ? "STATIC FALLBACK" : "SCHEDULED", bufferStatus: created.status || null, dueAt: created.dueAt || null });
      } catch (error) { result.status = "FAILED"; result.error = error instanceof Error ? error.message : "Buffer rejected this post."; await finishPublishJob(env, result.id, "failed", null, String(result.error)); }
      await saveCampaign(env, campaign);
    }
    item.state = campaign.results.some((result) => result.itemId === item.id && result.surface !== "story" && result.status === "FAILED") ? "failed" : "scheduled";
  }
  await Promise.all(campaign.results.map(async (result) => {
    const postId = typeof result.postId === "string" ? result.postId : null;
    const dueAt = result.dueAt || result.requestedDueAt;
    if (!postId || !dueAt || Date.parse(String(dueAt)) > now.getTime() || result.status === "FAILED") return;
    try {
      const current = await publisher.getPostStatus(postId);
      result.bufferStatus = current.status || null;
      result.sentAt = current.sentAt || null;
      result.externalLink = current.externalLink || null;
      if (current.status === "sent") result.status = "SENT";
      if (current.status === "error") { result.status = "FAILED"; result.error = current.error?.message || "Buffer could not publish this post."; result.supportUrl = current.error?.supportUrl || null; }
      await recordDelivery(env, { publishJobId: result.id, brandId: campaign.brandId, providerStatus: current.status || null, publicUrl: current.externalLink || null, error: result.status === "FAILED" ? String(result.error || "Buffer delivery failed") : null });
    } catch { /* Preserve the last confirmed state if Buffer status refresh is unavailable. */ }
  }));
  const processing = campaign.results.filter((result) => ["PROCESSING MOTION", "SCHEDULING"].includes(result.status)).length;
  const activeItems = campaign.items.filter((item) => ["queued", "rendering", "completed", "hosting", "scheduling"].includes(item.state)).length;
  const failed = campaign.results.filter((result) => result.status === "FAILED").length;
  campaign.message = processing || activeItems ? `PROCESSING MOTION — ${processing || activeItems} ${processing ? "destination" : "item"}${(processing || activeItems) === 1 ? "" : "s"} pending.` : failed ? `Campaign finished with ${failed} failed destination${failed === 1 ? "" : "s"}.` : campaign.results.length ? "Campaign completed and confirmed by Buffer." : "Motion media completed.";
  await saveCampaign(env, campaign);
  return json({ campaignId: campaign.id, message: campaign.message, items: campaign.items, results: campaign.results, processing: processing > 0 || activeItems > 0 }, 200);
}

async function previewSchedule(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
  const body = await request.json() as { prompt?: string; count?: number; timing?: string; timeZone?: string; now?: string; channels?: Array<Record<string, unknown>>; selected?: string[]; samplePosts?: AgentPlan["posts"]; brandId?: string; surfaceMode?: string; surfaceModeManual?: boolean };
  const prompt = String(body.prompt || "");
  const count = Math.max(1, Math.min(50, Number(body.count) || 1));
  const zone = validTimeZone(String(body.timeZone || "America/Toronto"));
  const suppliedNow = body.now && !Number.isNaN(Date.parse(body.now)) ? new Date(body.now) : new Date();
  const schedule = buildSchedule(prompt, count, String(body.timing || "auto"), zone, suppliedNow);
  const channels = Array.isArray(body.channels) ? body.channels : [];
  const selectedIds = Array.isArray(body.selected) ? body.selected : [];
  const brandId = String(body.brandId || ATLASIUM_BRAND_ID);
  const chosen = selectChannels(prompt, channels, selectedIds, brandId);
  const samplePosts = Array.isArray(body.samplePosts) ? body.samplePosts.slice(0, count) : [];
  const mode = surfaceModeFor(prompt, body.surfaceMode, body.surfaceModeManual === true);
  const assignments = expandSurfaceAssignments(routePosts(prompt, samplePosts, chosen, selectedIds.length > 0, brandId), mode, prompt).map(({ post, channel, caption, surface, surfaceId, surfaceLabel }, index) => { const itemIndex = samplePosts.indexOf(post); return { id: `preview-${String(index + 1).padStart(2, "0")}`, brandId, itemIndex, concept: post.concept, caption, channelId: channel.id, channel: channel.displayName || channel.name, service: channel.service, surface, surfaceId, surfaceLabel, requestedDueAt: schedule.times[itemIndex], dueAt: schedule.times[itemIndex] }; });
  return json({ ...schedule, brandId, timeZone: zone, channels: chosen, assignments });
}

async function upload(request: Request, env: Env) {
  if (!authorized(request, env)) {
    return json({ error: "This uploader link is not authorized." }, 401);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > 21 * 1024 * 1024) return json({ error: "Image is over the 20 MB limit." }, 413);

  const form = await request.formData();
  const brand = await requireBrand(env, String(form.get("brandId") || ATLASIUM_BRAND_ID));
  const image = form.get("image");
  if (!(image instanceof File)) return json({ error: "Choose an image to upload." }, 400);
  if (image.size > 20 * 1024 * 1024) return json({ error: "Image is over the 20 MB limit." }, 413);

  const extension = allowedTypes.get(image.type.toLowerCase());
  if (!extension) return json({ error: "Use a JPG, PNG, WebP, GIF or HEIC image." }, 415);

  const id = crypto.randomUUID();
  const key = `brands/${brand.id}/${new Date().toISOString().slice(0, 10)}/${id}.${extension}`;
  await env.UPLOADS.put(key, image.stream(), {
    httpMetadata: { contentType: image.type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { originalName: image.name.slice(0, 200), brandId: brand.id },
  });

  return json({ url: `${new URL(request.url).origin}/i/${key}` }, 201);
}

async function publish(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
  if (!env.BUFFER_API_KEY) return json({ error: "Buffer is not connected yet." }, 503);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 22 * 1024 * 1024) return json({ error: "Request is too large." }, 413);
  const form = await request.formData();
  const requestedBrandId = String(form.get("brandId") || ATLASIUM_BRAND_ID);
  const image = form.get("image");
  const caption = String(form.get("caption") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const refine = form.get("refine") === "true";
  const requestedSurfaceMode = String(form.get("surfaceMode") || "");
  const surfaceMode = surfaceModeFor(notes, requestedSurfaceMode, Boolean(requestedSurfaceMode));
  let mode = String(form.get("mode") || "addToQueue");
  let dueAt = String(form.get("dueAt") || "") || undefined;
  let channelIds: string[] = [];
  try { channelIds = JSON.parse(String(form.get("channels") || "[]")); } catch { return json({ error: "Invalid channel selection." }, 400); }
  if (!(image instanceof File) || !caption || !channelIds.length) return json({ error: "Add an image, post text, and at least one channel." }, 400);
  if (!allowedTypes.has(image.type.toLowerCase()) || image.size > 20 * 1024 * 1024) return json({ error: "Use a supported image under 20 MB." }, 415);
  if (!["shareNow", "addToQueue", "customScheduled", "smartSchedule"].includes(mode)) return json({ error: "Invalid publishing time." }, 400);
  if (mode === "smartSchedule") { mode = "customScheduled"; dueAt = buildSchedule(caption, 1, "auto", String(form.get("timeZone") || "America/Toronto")).times[0] || undefined; }
  if (mode === "customScheduled" && (!dueAt || Number.isNaN(Date.parse(dueAt)) || Date.parse(dueAt) <= Date.now())) return json({ error: "Choose a future schedule time." }, 400);

  const publisher = publishingProvider(env);
  const connected = await publisher.listDestinations();
  if (requestedBrandId === ATLASIUM_BRAND_ID) await syncAtlasiumChannels(env, connected);
  const brand = await requireBrand(env, requestedBrandId);
  const assigned = new Set(brand.channelIds.length ? brand.channelIds : connected.map((channel) => channel.id));
  const available = connected.filter((channel) => assigned.has(channel.id));
  const chosen = available.filter((channel) => channelIds.includes(String(channel.id)));
  if (chosen.length !== channelIds.length) return json({ error: "One or more Buffer channels are invalid." }, 400);

  const extension = allowedTypes.get(image.type.toLowerCase())!;
  const binary = new Uint8Array(await image.arrayBuffer());
  const key = `brands/${brand.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-feed.${extension}`;
  await env.UPLOADS.put(key, binary, { httpMetadata: { contentType: image.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: image.name.slice(0, 200), brandId: brand.id, surface: "feed" } });
  const imageUrl = `${new URL(request.url).origin}/i/${key}`;
  let storyImageUrl: string | undefined;
  let storyMediaError: string | undefined;
  if (surfaceMode !== "main" && chosen.some((channel) => storyService(String(channel.service)))) {
    try {
      let storyBytes = binary;
      let storyContentType = image.type;
      let storyExtension = extension;
      if (env.IMAGES) {
        const body = new Response(binary).body;
        if (body) {
          const transformed = await env.IMAGES.input(body).transform({ width: 1080, height: 1920, fit: "cover", gravity: "center" }).output({ format: "image/png", quality: 95 });
          const storyResponse = transformed.response();
          if (storyResponse.ok) { storyBytes = new Uint8Array(await storyResponse.arrayBuffer()); storyContentType = "image/png"; storyExtension = "png"; }
        }
      }
      const storyKey = `brands/${brand.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-story.${storyExtension}`;
      await env.UPLOADS.put(storyKey, storyBytes, { httpMetadata: { contentType: storyContentType, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: image.name.slice(0, 200), brandId: brand.id, surface: "story" } });
      storyImageUrl = `${new URL(request.url).origin}/i/${storyKey}`;
    } catch (error) { storyMediaError = `Story media formatting failed: ${error instanceof Error ? error.message : "the vertical asset could not be stored"}`; }
  }

  const results: Array<Record<string, unknown>> = [];
  const manualCampaignId = `manual_${crypto.randomUUID()}`;
  for (const channel of chosen) {
    const text = refine ? await refinePost(env, caption, notes, String(channel.service)) : caption;
    const postId = `${manualCampaignId}-01`;
    const assignments = expandSurfaceAssignments([{ post: { concept: "Manual publication", caption: text, imagePrompt: "", id: postId, itemIndex: 0, mediaType: "image", motionStyle: null, motionPrompt: null, duration: null, aspectRatio: "4:5" } as PlannedPost, channel, caption: text }], surfaceMode, notes);
    for (const assignment of assignments) {
      const { surface, surfaceId, surfaceLabel } = assignment;
      const jobId = `${postId}:${String(channel.id)}:${surface}`;
      const mediaUrl = surface === "story" ? storyImageUrl : imageUrl;
      if (!mediaUrl) {
        results.push({ id: jobId, brandId: brand.id, channel: channel.displayName || channel.name, channelId: String(channel.id), service: channel.service, surface, surfaceId, surfaceLabel, status: "FAILED", error: `${storyMediaError || "Story media could not be prepared."} Main publication was preserved.` });
        continue;
      }
      const reserved = await reservePublishJob(env, { id: jobId, brandId: brand.id, campaignId: manualCampaignId, postId, destinationId: `${String(channel.id)}#${surfaceId}`, scheduledTime: dueAt || mode, provider: publisher.id });
      if (!reserved) { results.push({ id: jobId, brandId: brand.id, channel: channel.displayName || channel.name, channelId: String(channel.id), service: channel.service, surface, surfaceId, surfaceLabel, status: "DUPLICATE PREVENTED" }); continue; }
      try {
        const post = await publisher.createPost({ channelId: String(channel.id), service: String(channel.service), text, mediaUrl, mediaType: "image", surface, mode, dueAt, aiAssisted: refine });
        await finishPublishJob(env, jobId, "confirmed", post.id, null);
        results.push({ id: jobId, brandId: brand.id, channel: channel.displayName || channel.name, channelId: String(channel.id), service: channel.service, surface, surfaceId, surfaceLabel, postId: post.id, status: "CONFIRMED" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Buffer rejected this post.";
        await finishPublishJob(env, jobId, "failed", null, message);
        results.push({ id: jobId, brandId: brand.id, channel: channel.displayName || channel.name, channelId: String(channel.id), service: channel.service, surface, surfaceId, surfaceLabel, status: "FAILED", error: message });
      }
    }
  }
  const action = mode === "shareNow" ? "published" : mode === "customScheduled" ? "scheduled" : "added to the queue";
  const failed = results.filter((result) => result.status === "FAILED").length;
  await audit(env, brand.id, "manual_publication_submitted", { campaignId: manualCampaignId, destinations: results.length, failed, mode, surfaceMode }, actorId(request));
  return json({ brandId: brand.id, campaignId: manualCampaignId, message: failed ? `${results.length - failed} publication${results.length - failed === 1 ? "" : "s"} ${action}; ${failed} failed and is shown separately.` : `${results.length} publication${results.length === 1 ? "" : "s"} ${action} successfully.`, imageUrl, storyImageUrl: storyImageUrl || null, results }, failed ? 207 : 201);
}

async function workspace(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This EchoFlow workspace is not authorized." }, 401);
  const connected = env.BUFFER_API_KEY ? await publishingProvider(env).listDestinations() : [];
  return json(await workspaceSnapshot(env, connected));
}

async function flowWorkspaceRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This FLOW workspace is not authorized." }, 401);
  const brandId = request.headers.get("X-Brand-ID")?.trim() || "";
  if (!brandId) return json({ error: "A valid brand is required for FLOW." }, 400);
  const connected = env.BUFFER_API_KEY ? await publishingProvider(env).listDestinations() : [];
  if (brandId === ATLASIUM_BRAND_ID) await syncAtlasiumChannels(env, connected);
  let reconciliation = { checked: 0, sent: 0, failed: 0, pending: 0 };
  let refreshError = "";
  try { reconciliation = await reconcileDeliveries(request, env, brandId); }
  catch (error) { refreshError = error instanceof Error ? error.message : "Delivery status refresh is temporarily unavailable."; }
  return json({ ...await flowWorkspaceSnapshot(env, brandId, connected), reconciliation, refreshError });
}

async function brandPayload(request: Request, env: Env, brandId?: string) {
  const form = await request.formData();
  let profile: BrandProfileInput;
  try { profile = JSON.parse(String(form.get("profile") || "{}")) as BrandProfileInput; }
  catch { throw new Error("The brand details could not be read."); }
  profile.channelIds = Array.isArray(profile.channelIds) ? profile.channelIds : [];
  profile.timezone = validTimeZone(String(profile.timezone || "America/Toronto"));
  const logo = form.get("logo");
  let hostedLogo: { url: string; r2Key: string } | null = null;
  if (logo instanceof File && logo.size) {
    if (!allowedTypes.has(logo.type.toLowerCase()) || logo.size > 10 * 1024 * 1024) throw new Error("Use a JPG, PNG, WebP, GIF or HEIC logo under 10 MB.");
    const extension = allowedTypes.get(logo.type.toLowerCase())!;
    const owner = brandId || "new-brand";
    const key = `brands/${owner}/logos/${crypto.randomUUID()}.${extension}`;
    await env.UPLOADS.put(key, logo.stream(), { httpMetadata: { contentType: logo.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: logo.name.slice(0, 200), brandId: brandId || "pending" } });
    hostedLogo = { r2Key: key, url: `${new URL(request.url).origin}/i/${key}` };
  }
  const connected = await publishingProvider(env).listDestinations();
  return { profile, hostedLogo, connected };
}

async function createBrandRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This EchoFlow workspace is not authorized." }, 401);
  const brandId = `brand_${crypto.randomUUID()}`;
  const { profile, hostedLogo, connected } = await brandPayload(request, env, brandId);
  return json({ brand: await createBrand(env, profile, connected, hostedLogo, brandId, actorId(request)) }, 201);
}

async function updateBrandRoute(request: Request, env: Env, brandId: string) {
  if (!authorized(request, env)) return json({ error: "This EchoFlow workspace is not authorized." }, 401);
  await requireBrand(env, brandId);
  const { profile, hostedLogo, connected } = await brandPayload(request, env, brandId);
  return json({ brand: await updateBrand(env, brandId, profile, connected, hostedLogo, actorId(request)) });
}

async function draftRoute(request: Request, env: Env, brandId: string) {
  if (!authorized(request, env)) return json({ error: "This EchoFlow workspace is not authorized." }, 401);
  const body = await request.json() as { prompt?: string; timing?: string; selectedChannels?: string[] };
  await saveDraft(env, brandId, { prompt: String(body.prompt || ""), timing: String(body.timing || "auto"), selectedChannels: Array.isArray(body.selectedChannels) ? body.selectedChannels.map(String) : [] });
  return json({ saved: true, brandId, savedAt: new Date().toISOString() });
}

async function archiveBrandRoute(request: Request, env: Env, brandId: string) {
  if (!authorized(request, env)) return json({ error: "This EchoFlow workspace is not authorized." }, 401);
  await archiveBrand(env, brandId, actorId(request));
  return json({ archived: true, brandId });
}

function requiredAmplifyBrand(request: Request, bodyBrandId?: unknown) {
  const headerBrandId = request.headers.get("X-Brand-ID")?.trim() || "";
  const suppliedBrandId = String(bodyBrandId || "").trim();
  if (!headerBrandId) throw new Error("A valid brand is required for every AMPLIFY operation.");
  if (suppliedBrandId && suppliedBrandId !== headerBrandId) throw new Error("The requested AMPLIFY brand does not match the authorized brand context.");
  return headerBrandId;
}

async function amplifyWorkspaceRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This AMPLIFY workspace is not authorized." }, 401);
  const brandId = requiredAmplifyBrand(request);
  return json(await loadAmplifyWorkspace(env, brandId));
}

async function amplifyDraftRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This AMPLIFY workspace is not authorized." }, 401);
  const body = await request.json() as Record<string, unknown>;
  const brandId = requiredAmplifyBrand(request, body.brandId);
  const draft = await createAmplifyDraft(env, brandId, body);
  await audit(env, brandId, "advertising_draft_created", { draftId: draft.id, providers: Array.isArray(draft.payload.providerIds) ? draft.payload.providerIds.length : 0, status: draft.status }, actorId(request));
  return json({ draft }, 201);
}

async function amplifyDraftUpdateRoute(request: Request, env: Env, draftId: string) {
  if (!authorized(request, env)) return json({ error: "This AMPLIFY workspace is not authorized." }, 401);
  const body = await request.json() as Record<string, unknown>;
  const brandId = requiredAmplifyBrand(request, body.brandId);
  const draft = await updateAmplifyDraft(env, brandId, draftId, body.payload as Record<string, unknown> || {});
  await audit(env, brandId, "advertising_draft_updated", { draftId, revision: draft.revision }, actorId(request));
  return json({ draft });
}

async function amplifyAssetRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This AMPLIFY workspace is not authorized." }, 401);
  const brandId = requiredAmplifyBrand(request);
  const asset = await uploadAmplifyAsset(request, env, brandId);
  await audit(env, brandId, "advertising_asset_uploaded", { assetId: asset.id, sourceType: asset.sourceType, mediaType: asset.mediaType }, actorId(request));
  return json({ asset }, 201);
}

async function amplifyDryTestRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This AMPLIFY workspace is not authorized." }, 401);
  const body = await request.json() as Record<string, unknown>;
  const brandId = requiredAmplifyBrand(request, body.brandId);
  const result = await runAmplifyDryTest(env, brandId, String(body.draftId || ""), String(body.idempotencyKey || ""), body.confirmed === true);
  const resultRecord = result as Record<string, unknown>;
  await audit(env, brandId, "advertising_dry_test_completed", { draftId: String(resultRecord.draftId || body.draftId || ""), status: String(resultRecord.status || "duplicate"), duplicate: resultRecord.duplicate === true }, actorId(request));
  return json({ result });
}

async function amplifyLiveSubmissionRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This AMPLIFY workspace is not authorized." }, 401);
  const body = await request.json() as Record<string, unknown>;
  const brandId = requiredAmplifyBrand(request, body.brandId);
  await audit(env, brandId, "advertising_live_submission_blocked", { reason: "live_submission_disabled" }, actorId(request));
  return json({ error: "Live advertising submission is disabled. Run a dry test instead. No advertisement was launched and no money was spent.", code: "amplify_live_submission_disabled" }, 403);
}

function requiredEchoContentBrand(request: Request, bodyBrandId?: unknown) {
  const headerBrandId = request.headers.get("X-Brand-ID")?.trim() || "";
  const suppliedBrandId = String(bodyBrandId || "").trim();
  if (!headerBrandId) throw new Error("A valid brand is required for every ECHO content operation.");
  if (suppliedBrandId && suppliedBrandId !== headerBrandId) throw new Error("The requested ECHO content brand does not match the authorized brand context.");
  return headerBrandId;
}

async function echoContentWorkspaceRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This ECHO workspace is not authorized." }, 401);
  const brandId = requiredEchoContentBrand(request);
  return json(await loadEchoContentWorkspace(env, brandId));
}

async function echoContentCreateRoute(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "This ECHO workspace is not authorized." }, 401);
  const body = await request.json() as Record<string, unknown>;
  const brandId = requiredEchoContentBrand(request, body.brandId);
  const draft = await createEchoContentDraft(env, brandId, body);
  await audit(env, brandId, "content_draft_created", { draftId: draft.id, contentType: draft.contentType }, actorId(request));
  return json({ draft }, 201);
}

async function echoContentDraftRoute(request: Request, env: Env, draftId: string) {
  if (!authorized(request, env)) return json({ error: "This ECHO workspace is not authorized." }, 401);
  const brandId = requiredEchoContentBrand(request);
  if (request.method === "DELETE") {
    const result = await deleteEchoContentDraft(env, brandId, draftId);
    await audit(env, brandId, "content_draft_deleted", { draftId }, actorId(request));
    return json(result);
  }
  const body = await request.json() as Record<string, unknown>;
  if (request.method === "PATCH") {
    const draft = await updateEchoContentDraft(env, brandId, draftId, body);
    await audit(env, brandId, "content_draft_updated", { draftId, contentType: draft.contentType, status: draft.status }, actorId(request));
    return json({ draft });
  }
  return json({ error: "Method not allowed." }, 405);
}

async function echoContentActionRoute(request: Request, env: Env, draftId: string, action: string) {
  if (!authorized(request, env)) return json({ error: "This ECHO workspace is not authorized." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const brandId = requiredEchoContentBrand(request, body.brandId);
  if (action === "revise") {
    const draft = await reviseEchoContentSection(env, brandId, draftId, body);
    await audit(env, brandId, "content_section_revised", { draftId, operation: body.operation, section: body.section }, actorId(request));
    return json({ draft });
  }
  if (action === "undo") {
    const draft = await undoEchoContentRevision(env, brandId, draftId);
    await audit(env, brandId, "content_revision_undone", { draftId }, actorId(request));
    return json({ draft });
  }
  if (action === "duplicate") {
    const draft = await duplicateEchoContentDraft(env, brandId, draftId);
    await audit(env, brandId, "content_draft_duplicated", { sourceDraftId: draftId, draftId: draft.id }, actorId(request));
    return json({ draft }, 201);
  }
  if (action === "repurpose") {
    const draft = await repurposeEchoContentDraft(env, brandId, draftId, body.targetType);
    await audit(env, brandId, "content_draft_repurposed", { sourceDraftId: draftId, draftId: draft.id, targetType: body.targetType }, actorId(request));
    return json({ draft }, 201);
  }
  if (action === "image") {
    const result = await generateEchoFeaturedImage(request, env, brandId, draftId);
    await audit(env, brandId, "content_featured_image_generated", { draftId }, actorId(request));
    return json(result, 201);
  }
  return json({ error: "Unknown ECHO content action." }, 404);
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

    if (url.pathname === "/api/echo/content/workspace") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      try { return await echoContentWorkspaceRoute(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not load ECHO content." }, statusFor(error, 400)); }
    }

    if (url.pathname === "/api/echo/content/drafts") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await echoContentCreateRoute(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not create the content draft." }, statusFor(error, 400)); }
    }

    const echoContentMatch = url.pathname.match(/^\/api\/echo\/content\/drafts\/([^/]+)(?:\/([^/]+))?$/);
    if (echoContentMatch) {
      try {
        const draftId = decodeURIComponent(echoContentMatch[1]);
        const action = echoContentMatch[2] || "";
        return action ? await echoContentActionRoute(request, env, draftId, action) : await echoContentDraftRoute(request, env, draftId);
      } catch (error) { return json({ error: error instanceof Error ? error.message : "Could not update the content draft." }, statusFor(error, 400)); }
    }

    if (url.pathname === "/api/amplify/workspace") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      try { return await amplifyWorkspaceRoute(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not load AMPLIFY." }, statusFor(error, 400)); }
    }

    if (url.pathname === "/api/amplify/drafts") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await amplifyDraftRoute(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not prepare the advertising draft." }, statusFor(error, 400)); }
    }

    const amplifyDraftMatch = url.pathname.match(/^\/api\/amplify\/drafts\/([^/]+)$/);
    if (amplifyDraftMatch) {
      if (request.method !== "PATCH") return json({ error: "Method not allowed." }, 405);
      try { return await amplifyDraftUpdateRoute(request, env, decodeURIComponent(amplifyDraftMatch[1])); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not update the advertising draft." }, statusFor(error, 400)); }
    }

    if (url.pathname === "/api/amplify/assets") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await amplifyAssetRoute(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not upload this advertising creative." }, statusFor(error, 400)); }
    }

    if (url.pathname === "/api/amplify/dry-test") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await amplifyDryTestRoute(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "The AMPLIFY dry test failed." }, statusFor(error, 400)); }
    }

    if (url.pathname === "/api/amplify/launch") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      return amplifyLiveSubmissionRoute(request, env);
    }

    if (url.pathname === "/api/workspace") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      try { return await workspace(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not load the EchoFlow workspace." }, statusFor(error, 502)); }
    }

    if (url.pathname === "/api/flow/workspace") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      try { return await flowWorkspaceRoute(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not load FLOW.", code: "flow_workspace_unavailable" }, statusFor(error, 502)); }
    }

    if (url.pathname === "/api/brands") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await createBrandRoute(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Could not create the brand." }, 400); }
    }

    const brandRoute = url.pathname.match(/^\/api\/brands\/([^/]+)(?:\/(draft|archive))?$/);
    if (brandRoute) {
      const brandId = decodeURIComponent(brandRoute[1]);
      try {
        if (brandRoute[2] === "draft" && request.method === "PUT") return await draftRoute(request, env, brandId);
        if (brandRoute[2] === "archive" && request.method === "POST") return await archiveBrandRoute(request, env, brandId);
        if (!brandRoute[2] && request.method === "PATCH") return await updateBrandRoute(request, env, brandId);
        return json({ error: "Method not allowed." }, 405);
      } catch (error) { return json({ error: error instanceof Error ? error.message : "Could not update the brand." }, statusFor(error, 400)); }
    }

    if (url.pathname === "/api/channels") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      if (!authorized(request, env)) return json({ error: "This publishing link is not authorized." }, 401);
      if (!env.BUFFER_API_KEY) return json({ configured: false, channels: [] });
      try {
        const connected = await publishingProvider(env).listDestinations();
        const brandId = request.headers.get("X-Brand-ID") || url.searchParams.get("brandId") || ATLASIUM_BRAND_ID;
        if (brandId === ATLASIUM_BRAND_ID) await syncAtlasiumChannels(env, connected);
        const brand = await requireBrand(env, brandId);
        const assigned = new Set(brand.channelIds.length ? brand.channelIds : connected.map((channel) => channel.id));
        return json({ configured: true, brandId: brand.id, channels: connected.filter((channel) => assigned.has(channel.id)) });
      }
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
      catch (error) { return json({ error: error instanceof Error ? error.message : "Campaign creation failed." }, statusFor(error, 502)); }
    }

    if (url.pathname.startsWith("/api/campaign/")) {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      try { return await processCampaign(request, env, decodeURIComponent(url.pathname.slice("/api/campaign/".length))); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Campaign progress failed." }, statusFor(error, 502)); }
    }

    if (url.pathname === "/api/motion-preview") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try { return await motionPreview(request, env); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Motion preview failed." }, 502); }
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
      if (!env.IMAGES) return json({ error: "Image optimization is unavailable." }, 503);
      const images = env.IMAGES;
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
