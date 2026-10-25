# Visez: internal launch handoff (October 25, 2026)

## Verified state, October 25, 2026

- `codex/bidflo-next` combines qualification, proposal quality, duplicate-application protection, fast review, uncertain-submission recovery, job-alert parsing, the Visez visual release, Won/Nurture stages, client opt-out safeguards, preview protections, and AI-provider diagnostics. Local tests, lint, production compilation, the quality gate, and container build passed before the integration.
- Neon migration `0006_duplicate_application_guards.sql` was validated on the isolated `codex-bidflo-migration-0006` branch and then applied successfully to the production `bidflo` database. Production has all three indexes and the migration record; prechecks found zero duplicate job keys, submissions, or manual handoffs.
- The previously verified release was live on both existing Render services as immutable image `ghcr.io/atlasium788ai/bidflo:37e55e923cbc74dc6a3fd70693016257b512f47a` (`sha256:1e1907676f9545f7747615b316744e432d1a552abfdcb51dccf7f269d5c70b42`). Replace it with the fully tested Visez image, keeping the existing web URL, Neon database, environment variables, free web plan, and five-minute cron schedule.
- The web service uses the image's default `pnpm start`, health check path `/api/health`, and reports `database: ready`. The cron image overrides the command with `node scripts/run-cron.mjs`. Confirm a successful scheduled run after each future image update.
- Render native build minutes remain exhausted, so releases use the repository's image workflow on GitHub's free standard runner. It builds `linux/amd64`, runs the complete build gate inside the image, publishes to public GHCR, and verifies an anonymous pull before Render is updated. Do not switch back to a Render Git build while the limit remains exhausted.
- Slack is not configured in the processor environment. AI remains unconfigured because the previous key was revoked. These require new secrets from Blair; do not invent, recover, print, or commit credentials.
- Temporary Neon test branch `codex-bidflo-migration-0006` remains available for inspection. Deleting it is destructive and requires explicit operator confirmation.

- **Development branch:** `codex/bidflo-next`. Make all further Visez changes here.
- **Current live source:** Render web and cron are image-backed. Keep both pinned to the same immutable Visez image.
- **Free verification:** GitHub Actions quality gate on this development branch runs tests, lint, and production compilation on standard hosted runners. Do not create preview environments or new paid services.
- **Release method:** Batch changes; obtain green CI; publish a dedicated release image; require the image workflow and anonymous pull to pass; then pin both existing Render services to that exact immutable tag. Do not attempt paid build-minute purchases, upgrades, or new subscriptions.
- **Business controls:** Never submit Upwork bids, spend Connects, send client messages, or contact team members without explicit authorization. Do not change the approved three-section interface without a request.
- **Continuity:** Preserve real opportunities, database records, current Render configuration, and the live site's availability. Inspect and back up production data before future migrations.

---

# Visez release constraints and integration tasks

## Hardening handoff, October 24

- This branch added `lib/pipeline-guards.ts`, `lib/security.ts`, `tests/hardening.test.ts`, `db/migrations/0005_inbound_recovery.sql`, hardened `lib/workflow.ts`, submission and opportunity routes, UI error handling, safer security headers, and a DB-backed health endpoint.
- **Do not claim production-ready security while `BIDFLO_AUTH_DISABLED=true`.** This development bypass allows anonymous operators and is the largest unresolved risk. User requested no login interruption during initial UI tests; do not silently change the login mode. Bring it to the operator's attention before handling real client data.
- Upwork automated bridge remains disabled during login bypass and unless `UPWORK_SUBMISSION_BRIDGE_ENABLED=true` is explicitly set. Do not spend Connects or send messages without clear separate approval.
- Incoming events are atomically claimed, retried after transient errors, recovered after interrupted workers; messages deduped by source_event_id. Check `bidflo_inbound_events` for stale `processing` or `failed` rows.
- Proposal updates use transaction-locked state transitions, and editing revokes prior approval. An uncertain bridge submission requires reconciliation in Upwork before any retry.
- CI workflow `.github/workflows/bidflo-ci.yml` should be green before treating latest changes as stable; tests + lint + production build. Next priorities: actual authenticated end-to-end browser test, rate-limits on costly AI calls, and Slack bot credential/configuration.
- Keep only the approved three-tab dark UX, no multi-tenant launch and no changes to unrelated Atlasium products.

## Slack alerts, October 24

- The internal pilot requires BidFlo Slack notifications for qualified opportunities, prepared proposals, inbound client replies, confirmed submissions, interview stages, and wins.
- Default private destination: Blair's own Slack DM, not the shared #revenue-intake-alerts or the sales team. No weekend team messaging.
- Source: `lib/slack-alerts.ts` queues/delivers deduplicated events, `lib/slack-message.ts` sanitizes private alert content, migration `0004_slack_notifications.sql`, existing five-minute cron dispatches/retries. Uses either `SLACK_BOT_TOKEN` + `SLACK_DESTINATION_ID` or a private-channel `SLACK_WEBHOOK_URL`; add secrets privately in Render, never to Git. ChatGPT's @Slack connected app does not authorize standalone server sends.
- After credentials installed, verify an actual private Slack alert from a genuine new opportunity or reply (not merely a one-off message sent by ChatGPT). Never call delivery verified before that.

## Current rollout decision (October 24, 2026)

**Phase 1: internal Atlasium use only.** The founder will use BidFlo for real opportunities this week. Do NOT launch paid subscriptions, invite external tenants, start building sign-up flows, or redesign the approved Find | Bid | Follow Up UI during this test period. Keep temporary no-login development bypass as requested; do not switch authentication back on unprompted. Preserve existing data, real opportunities, and UI.

**Phase 2: future client product.** Plan architecture to support multiple client organizations later: organization-aware data isolation, per-client Upwork OAuth and sender connections, secure authentication, usage limits and billing. Put foundation behind abstractions when it is naturally relevant, but DO NOT turn these future features on or delay internal validation to build them.

**Immediate work: test the actual revenue flow.** Prioritize authorized Upwork feed, working funded OpenAI API proposal drafting/QC, reliable inbound replies, and human-approved application submissions. Absolutely no unapproved bids, Connects spending or external outreach.

## Codex handoff from ChatGPT code edits

- Repo: `Atlasium788ai/atlasium-social-assets`, development branch `codex/bidflo-next`, app in `bidflo/`. Production Render services are image-backed; do not assume the old `codex/bidflo` branch is live.
- Live service: `https://atlasium-bidflo.onrender.com`; web and 5-minute processor hosted on Render from the pinned GHCR image above, database `bidflo` in Neon.
- New Follow Up feature committed: `components/reply-assistant.tsx` renders editable Direct/Consultative/Friendly messages with **Copy**, per-tone **Refresh**, and **Previous/Next** versions persisted to browser localStorage for that message; draft-generation API `app/api/opportunities/[id]/reply-suggestions/route.ts`. All replies encourage the client to meet *inside Upwork*. There is no auto-send.
- `components/reply-notification.tsx` mounted in `components/app-shell.tsx`; while the app is open, it polls `app/api/follow-up/replies/route.ts` every 45 seconds for linked inbound client messages and shows a dismissible popup. It only shows a reply on the associated opportunity; if no exact match, messages remain unlinked rather than guess. Client conversation deep links saved to `bidflo_messages.upwork_room_url` when notifications contain one; otherwise open Upwork Messages inbox and show original job link.
- Parser and workflow: `lib/email-parser.ts`, `lib/workflow.ts`. DB migration: `db/migrations/0002_upwork_reply_room.sql`. Migrator fixed to run in TSX CommonJS `scripts/migrate.ts`; `package.json` build runs `pnpm test && next build`, start runs DB migrations then Next.
- Tests: 70 passed in the release image build on October 25, with lint and Next production compilation also passing. The production image and database-backed health check passed; no actual linked inbound client replies yet, so the popup/reply copy flow must be exercised end-to-end on a genuine incoming response before claiming that behavior proven. A previously received real job (Run That Rehab CRM automation) scored 90 and received a manual-review draft. **Do not fabricate Upwork data, fake wins, or pretend fake events are real prospects.**
- AI status: `AI_API_KEY` unset in Render because an earlier key was leaked and revoked; Neon AI Gateway on Free plan returned 403. Reply cards currently use clearly labeled editable **starter variants**, not personalized GPT replies. After a new account-owner-created OpenAI API key is privately installed in Render, verify live personalized reply generation, distinct tones, regeneration, review, safeguards, and model costs. Never commit or print keys.
- Upwork status: `.codex/config.toml` registers official Upwork OAuth MCP for Codex; this does **not** mean the Render-hosted application has automatically connected to the user's Upwork account. OAuth authorization and consented backend polling remain outstanding. Email ingestion works for permitted forwarded notifications; do not misrepresent it as live autonomous scanning.
- UX/design: app is dark-mode only and Apple-clean. Preserve other sections when asked for one edit. Keep wording free of unsubstantiated scanning/win claims and keep branding `Powered by Atlasium 7/88`. Any sign-in design is conceptual while auth bypass remains on.


- Product UI: dark mode only, minimalist futuristic design, exactly three sections: Find | Bid | Follow Up. Headline "Your Upwork advantage." Tagline "Every opportunity. Every time." Footer "Powered by Atlasium 7/88". Do not add unrelated pages, fake job data, or a permanent login flow while temporary development bypass is requested.
- Data: production Neon Postgres via DATABASE_URL, backend Render and a five-minute Render cron. Inbound Resend email webhook is signed; only permit allowlisted senders and safely handle replay/deduplication.
- AI: use direct OpenAI Platform API via AI_API_BASE_URL=https://api.openai.com/v1, AI_API_KEY, AI_MODEL and AI_REVIEW_MODEL. The prior OpenAI backend-connect key was leaked and revoked; the Neon AI Gateway returned HTTP 403 on Neon's Free plan, so it was disconnected and its temporary dedicated credential revoked. Production AI_API_KEY is currently EMPTY pending the account holder creating a fresh scoped OpenAI Platform API key privately and installing it in Render. Never publish that key or commit credentials to Git. GPT-5 chat completions do not support custom temperature. A real model generation AND independent QC must succeed before calling an opportunity AI-reviewed; otherwise make a clearly labeled fallback draft and require human approval. Never copy keys into source or output.
- Upwork: the official Upwork MCP endpoint is https://mcp.upwork.com/mcp (OAuth 2.1). Codex project config registers the MCP. OAuth consent to a real Upwork account has not yet been confirmed. Do not claim that Codex MCP automatically connects the server-hosted BidFlo application. To enable automatic discovery, build a secure, consented backend OAuth/MCP source with token encryption, refresh and least-privilege use; only then poll through existing five-minute processor. No HTML scraping or deprecated RSS.
- No bids, messages or Upwork Connects spending without explicit human review and approval. Preserve that safeguard even during development.
- Until the upstream account OAuth is authorized, real user-forwarded Upwork notification emails remain a functioning intake path; do not imply they arrive automatically unless verified.
- Acceptance: run tests/build; verify production deploy, incoming real opportunity, qualification, AI provider response, human-review queue, and Upwork integration status separately. Do not invent pipeline counts or statuses.
