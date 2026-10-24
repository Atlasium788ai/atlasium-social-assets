# EchoFlow Social

EchoFlow Social is Atlasium's multi-brand, first-party social-content workspace, including ECHO (content), FLOW (operations) and AMPLIFY (advertising drafts).

## First-party publishing

- EchoFlow does **not** send new posts through Buffer or another social scheduling intermediary.
- New immediate image publications use the platform Graph API directly for **Facebook Pages** and **Instagram professional accounts**. Social-app permissions and account access must be approved and configured before a live post is possible.
- Multi-brand settings, campaign and media histories remain in D1 and R2. Existing historical publishing records are preserved, but legacy provider accounts are not active publishing destinations.
- Connections are provisioned from the Cloudflare **secret** `DIRECT_SOCIAL_CONNECTIONS`. Each entry has: `id`, `brandId`, `service` (`facebook` or `instagram`), `accountId`, `displayName` and `accessToken`. Never commit credentials to the repo or send them to a client.
- **Post now** supports a photo feed post where the platform credentials have been approved and connected. Instagram Stories, Reels, video, LinkedIn, TikTok and X require separate approved integrations, and are not represented as live.
- **First-party scheduling** now has an independent D1 queue, cancellation and a scheduled Cloudflare Worker handler. Scheduling is exposed only with the `DIRECT_SOCIAL_SCHEDULER_ENABLED=true` flag, a deployed cron trigger, an applied database migration and an active direct platform account. Until those deployment conditions have been checked, it remains disabled.
- Scheduled posts must be at least two minutes ahead and no more than 90 days ahead. Each due job is atomically claimed once. After a crash or unclear provider response, automatic retries are deliberately suppressed and the item is marked for manual review.
- Native Meta photo publishing requires a publicly reachable HTTPS image URL. Instagram uses the media-container + publication sequence after it reports `FINISHED`.
- Platform API publishing is only initiated on an explicitly submitted publishing action. Dry-run testing must use mocked platform endpoints.

## Safety

- All direct connections are bound to immutable brand IDs; unrelated brands cannot select or publish to each other's accounts.
- No client-visible API contains the platform access token.
- Failed or pending publication is never claimed as a successful send.
- Historical campaigns, images, drafts and delivery records are not deleted or republished when migrating away from a legacy provider.

## Activation checklist

1. Apply `drizzle/0003_direct_social_schedule.sql` to the **target D1 database**, with an approved migration/backup. Do not blindly reset or reseed the database.
2. Store `DIRECT_SOCIAL_CONNECTIONS` as a Cloudflare secret, with current Page or Instagram professional-account tokens assigned to the intended immutable brand IDs. Do not put tokens in Git or browser storage.
3. Configure the Cloudflare scheduled trigger to run once per minute. The `scheduled()` handler performs atomic due-job claims and submits a maximum of ten posts per invocation.
4. Validate the deploy and cron events on a controlled test account. Only then set `DIRECT_SOCIAL_SCHEDULER_ENABLED=true`.
5. Confirm the results in ECHO's scheduled-post manager and FLOW's job status view. On unclear outcomes, inspect the social platform before any manual retry.

## Validation

Run `pnpm test` to compile the Cloudflare/vinext application and validate offline workflows. Legacy intermediary test fixtures are retained as skipped historical fixtures; new direct publishing and first-party scheduling tests are active. Green unit tests do not prove platform approval, live account connectivity, a functioning cron trigger or successful production delivery.
