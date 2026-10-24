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

## Reliability and security (October 24 pilot)

- Production migrations include `0005_inbound_recovery.sql`: inbound jobs are atomically claimed, retryable up to five times, and recovered after interruption. Client reply messages have a unique source-event key, so replaying the same signed webhook cannot create another message.
- Proposal editing, approval and manual submission confirmation run in guarded database transactions. Advancing a closed opportunity backwards is blocked. Editing an approved draft revokes approval.
- Manual submission is idempotent. An optional integration bridge **cannot run** while `BIDFLO_AUTH_DISABLED=true`; to enable it in future requires authenticated administration plus `UPWORK_SUBMISSION_BRIDGE_ENABLED=true`, `UPWORK_SUBMISSION_WEBHOOK_URL`, and `UPWORK_SUBMISSION_TOKEN`. A timeout leaves the item marked `submission_processing` to require manual verification, never an automatic resubmit.
- Sensitive browser mutations check same-origin headers, and the website sets clickjacking, content-type and framing security headers. **These are not substitutes for authentication.**
- **Critical unresolved security risk:** `BIDFLO_AUTH_DISABLED=true` grants a public visitor the operator session; this is suitable only for temporary testing with non-sensitive data. Turn it OFF, finish Neon Auth and restrict the operator user before importing confidential client replies, using real accounts, or enabling any submission bridge. The existing request-origin check does NOT authenticate a visitor.
- The health endpoint checks Neon connectivity; GitHub workflow `.github/workflows/bidflo-ci.yml` runs tests, lint, and production compilation. Render deploys independently run tests/build.
- Avoid storing client personal data in Slack. A connected ChatGPT Slack app is not an unattended BidFlo Slack bot credential. Review backup/restore procedures, token rotation, and an authenticated end-to-end test before real-world production rollout.

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

Optional submission bridge requires an authenticated operator, explicit `UPWORK_SUBMISSION_BRIDGE_ENABLED=true`, `UPWORK_SUBMISSION_WEBHOOK_URL`, and `UPWORK_SUBMISSION_TOKEN`. Manual, human-controlled submission is the default.

## Fast troubleshooting

Use the shortest path to the broken step. **Do not redesign or rebuild unrelated parts.**

| What is broken | First place to check | Next step |
|---|---|---|
| A job does not appear | `bidflo_inbound_events` and Resend webhook | Check sender allowlist, pending/failed event and processor logs |
| Scoring or proposal looks wrong | `lib/workflow.ts`, `lib/qualification.ts`, latest `bidflo_proposals` | Check qualification inputs and reviewer notes, then rescore only an unapproved opportunity |
| A client response is missing | `bidflo_messages` and `lib/email-parser.ts` | Check if the reply was ingested and safely linked; do not guess a client match |
| Slack or email notifications fail | `bidflo_notifications`, `lib/slack-alerts.ts`, `lib/owner-notifications.ts` | Check delivery configuration, retry state and audit logs |
| A bid's status is confusing | `bidflo_submission_events` and `app/api/opportunities/[id]/submit/route.ts` | Compare with Upwork before attempting another submission |
| The site errors | Render web logs, `/api/health`, Neon connectivity | Roll back the last failing deploy; preserve stored records |

Production changes must pass `pnpm test`, `pnpm lint`, and `pnpm exec next build` before release. Keep **Find | Bid | Follow Up** unchanged unless an interface change is specifically requested.

## Validation

```bash
pnpm test
pnpm run build
```

`db/migrations/0001_bidflo.sql` is idempotent and is applied by Render's pre-deploy command.
