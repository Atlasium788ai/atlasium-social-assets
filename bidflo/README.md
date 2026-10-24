# BidFlo

BidFlo is Atlasium 7/88's private opportunity and proposal operations system. It receives permitted Upwork notification emails, extracts and deduplicates opportunities, scores fit, prepares tailored proposals, runs an independent quality review, and places approved work in a guarded submission flow.

## Operational flow

1. Forward Upwork notifications to a Resend receiving address.
2. Resend signs and delivers the event to `POST /api/webhooks/resend`.
3. BidFlo verifies the signature and sender allowlist, stores a sanitized event, and acknowledges receipt.
4. The Render cron calls `POST /api/cron/process` every five minutes.
5. New opportunities are deduplicated, scored, rejected or qualified, drafted, reviewed, and surfaced in the approval queue.
6. Blair approves, edits, or rejects. Submission remains blocked until approval.
7. If an authorized integration bridge is configured, BidFlo hands off the approved payload. Otherwise it opens the authenticated Upwork job for human-controlled submission and records Blair's confirmation.

No scraping is used. Email body content is treated as untrusted data and cannot invoke tools or bypass approval.

## Slack alerts

BidFlo writes deduplicated notifications to `bidflo_notifications` for qualified opportunities, proposals ready for review, received Upwork client replies, confirmed submitted proposals, interviews and wins. The existing five-minute processor sends the alerts and retries temporary failures. Alerts do not contain private client-message bodies and link back to the opportunity in BidFlo.

**Pilot delivery goes to Blair alone**, not the sales team. In Render web service, set either:

- **Direct Message:** `SLACK_BOT_TOKEN` (a separately installed Slack app's bot token with `chat:write` and `im:write` permissions) and `SLACK_DESTINATION_ID` (Blair's Slack user ID, `U...`). Do not commit tokens.
- **Private channel:** `SLACK_WEBHOOK_URL` from a Slack incoming webhook explicitly installed to the designated private channel.

If no Slack bot token or webhook is configured, events are queued, not sent. ChatGPT's installed @Slack connector cannot be used as the unattended BidFlo server credential. The five-minute cron returns `slack.configured: false` until it is configured.

Do not invite team members or send teamwide alerts without explicit instruction. Preserve the owner's weekend-messaging preferences. For future client accounts, configure separate destinations and organization-scoped credentials after the internal pilot.

## Local setup

```bash
cd bidflo
pnpm install
cp .env.example .env.local
pnpm run db:migrate
pnpm run dev
```

The Neon project must have Managed Auth enabled. Add the production Render URL as a trusted Auth domain, create Blair's user, and set `BIDFLO_ALLOWED_EMAILS` to the exact allowed address.

## Required production configuration

- `DATABASE_URL`: pooled Neon Postgres connection string.
- `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`: Managed Auth endpoint and 32+ character cookie secret.
- `BIDFLO_ALLOWED_EMAILS`: comma-separated Atlasium admin addresses.
- `AI_API_KEY`, `AI_MODEL`: model-provider credentials and drafting model. `AI_REVIEW_MODEL` may use a separate reviewer.
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`: inbound retrieval and signed-webhook verification.
- `UPWORK_ALLOWED_SENDERS`: exact authenticated sender addresses accepted for processing. If mailbox forwarding rewrites the envelope sender, allowlist only that forwarding address.
- `BIDFLO_OWNER_EMAIL`, `BIDFLO_EMAIL_FROM`: approval notification destination and verified sender.
- `CRON_SECRET`: the same random secret on the web and cron services.
- `BIDFLO_URL`: deployed HTTPS origin used by notifications and the cron.

Optional: `UPWORK_SUBMISSION_WEBHOOK_URL` and `UPWORK_SUBMISSION_TOKEN` enable a separately authorized submission bridge. Without both, the human-controlled flow is used.

## Validation

```bash
pnpm test
pnpm run build
```

`db/migrations/0001_bidflo.sql` is idempotent and is applied by Render's pre-deploy command.
