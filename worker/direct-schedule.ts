import { listDirectSocialDestinations, publishDirectSocial, type DirectSocialEnv } from "./direct-social";

export type DirectScheduleEnv = DirectSocialEnv & {
  DB?: D1Database;
  DIRECT_SOCIAL_SCHEDULER_ENABLED?: string;
};

export type DirectScheduleInput = {
  id: string;
  brandId: string;
  campaignId: string;
  postId: string;
  channelId: string;
  service: string;
  caption: string;
  imageUrl: string;
  dueAt: string;
};

const WORKSPACE_ID = "workspace_atlasium";
const MAX_DAYS_AHEAD = 90;
const BATCH_SIZE = 10;
const nowIso = () => new Date().toISOString();

export function scheduleIsEnabled(env: DirectScheduleEnv) {
  return env.DIRECT_SOCIAL_SCHEDULER_ENABLED === "true" && Boolean(env.DB);
}

export async function enqueueDirectPost(env: DirectScheduleEnv, input: DirectScheduleInput, now = new Date()) {
  if (!scheduleIsEnabled(env)) throw new Error("First-party scheduling is not enabled on this deployment.");
  if (!input.id || !input.campaignId || !input.postId || !input.brandId || !input.channelId)
    throw new Error("A valid brand, campaign, post and destination are required.");
  const dueMs = Date.parse(input.dueAt);
  if (!Number.isFinite(dueMs) || dueMs < now.getTime() + 120_000 || dueMs > now.getTime() + MAX_DAYS_AHEAD * 86400_000)
    throw new Error("Choose a posting time at least two minutes ahead, within 90 days.");
  if (!input.caption.trim() || !/^https:\/\//.test(input.imageUrl))
    throw new Error("A caption and publicly hosted HTTPS image are required.");
  const destination = listDirectSocialDestinations(env).find((channel) => channel.id === input.channelId && channel.brandId === input.brandId && channel.service === input.service.toLowerCase());
  if (!destination) throw new Error("This direct destination does not belong to the selected brand.");
  const stamp = now.toISOString();
  const result = await env.DB!.prepare(`INSERT OR IGNORE INTO scheduled_social_posts
    (id, workspace_id, brand_id, campaign_id, post_id, channel_id, service, caption, image_url, due_at, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(input.id, WORKSPACE_ID, input.brandId, input.campaignId, input.postId, input.channelId, input.service.toLowerCase(),
      input.caption.slice(0, 6000), input.imageUrl, new Date(dueMs).toISOString(), stamp, stamp).run();
  return { queued: Number(result.meta?.changes || 0) > 0, id: input.id, dueAt: new Date(dueMs).toISOString() };
}

export async function listScheduledDirectPosts(env: DirectScheduleEnv, brandId: string) {
  if (!env.DB) return [];
  if (!brandId) throw new Error("A brand is required.");
  const records = await env.DB.prepare(`SELECT id, campaign_id AS campaignId, channel_id AS channelId, service,
      caption, due_at AS dueAt, state, provider_post_id AS providerPostId, error, attempted_at AS attemptedAt
      FROM scheduled_social_posts WHERE workspace_id = ? AND brand_id = ?
      ORDER BY due_at DESC LIMIT 100`).bind(WORKSPACE_ID, brandId).all();
  return records.results || [];
}

export async function cancelScheduledDirectPost(env: DirectScheduleEnv, brandId: string, jobId: string) {
  if (!env.DB) throw new Error("First-party scheduling storage is unavailable.");
  if (!brandId || !jobId) throw new Error("A brand and scheduled post are required.");
  const changed = await env.DB.prepare(`UPDATE scheduled_social_posts SET state = 'cancelled', updated_at = ?
    WHERE id = ? AND workspace_id = ? AND brand_id = ? AND state = 'pending'`)
    .bind(nowIso(), jobId, WORKSPACE_ID, brandId).run();
  if (!Number(changed.meta?.changes || 0)) return { cancelled: false, id: jobId };
  await env.DB.prepare(`UPDATE publish_jobs SET status = 'cancelled', updated_at = ?
    WHERE id = ? AND brand_id = ? AND workspace_id = ? AND provider = 'direct' AND status = 'scheduled'`)
    .bind(nowIso(), jobId, brandId, WORKSPACE_ID).run();
  return { cancelled: true, id: jobId };
}

/**
 * Invoked ONLY by the platform's configured cron trigger.
 * A row is claimed atomically and never retried automatically after an
 * ambiguous provider failure or worker crash, preventing duplicate posting.
 */
export async function dispatchDueDirectPosts(env: DirectScheduleEnv, now = new Date()) {
  if (!scheduleIsEnabled(env)) return { checked: 0, sent: 0, review: 0, disabled: true };
  const due = await env.DB!.prepare(`SELECT id, brand_id AS brandId, channel_id AS channelId, service, caption, image_url AS imageUrl
    FROM scheduled_social_posts WHERE workspace_id = ? AND state = 'pending' AND due_at <= ?
    ORDER BY due_at ASC LIMIT ?`).bind(WORKSPACE_ID, now.toISOString(), BATCH_SIZE).all<{
      id: string; brandId: string; channelId: string; service: string; caption: string; imageUrl: string;
    }>();
  let sent = 0, review = 0;
  for (const item of due.results || []) {
    const claim = await env.DB!.prepare(`UPDATE scheduled_social_posts
      SET state = 'submitting', attempted_at = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND state = 'pending'`)
      .bind(now.toISOString(), now.toISOString(), item.id, WORKSPACE_ID).run();
    if (Number(claim.meta?.changes || 0) !== 1) continue;
    try {
      const result = await publishDirectSocial(env, {
        brandId: item.brandId, channelId: item.channelId, service: item.service,
        text: item.caption, mediaUrl: item.imageUrl, mediaType: "image", surface: "feed", mode: "shareNow",
      });
      const stamp = nowIso();
      await env.DB!.prepare(`UPDATE scheduled_social_posts SET state = 'sent', provider_post_id = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND state = 'submitting'`)
        .bind(result.id, stamp, item.id, WORKSPACE_ID).run();
      await env.DB!.prepare(`UPDATE publish_jobs SET status = 'sent', provider_post_id = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND provider = 'direct'`)
        .bind(result.id, stamp, item.id, WORKSPACE_ID).run();
      sent++;
    } catch {
      // A platform call may have succeeded despite a timeout. Never blindly retry.
      const stamp = nowIso();
      try {
        await env.DB!.prepare(`UPDATE scheduled_social_posts SET state = 'needs_review',
          error = 'Check the destination before retrying. Publication may have succeeded.', updated_at = ?
          WHERE id = ? AND workspace_id = ? AND state = 'submitting'`)
          .bind(stamp, item.id, WORKSPACE_ID).run();
        await env.DB!.prepare(`UPDATE publish_jobs SET status = 'needs_review',
          error = 'Direct-platform result uncertain. Verify the destination manually.', updated_at = ?
          WHERE id = ? AND workspace_id = ? AND provider = 'direct'`)
          .bind(stamp, item.id, WORKSPACE_ID).run();
      } catch { /* Keep submitting state for manual inspection; never auto-retry. */ }
      review++;
    }
  }
  return { checked: (due.results || []).length, sent, review, disabled: false };
}
