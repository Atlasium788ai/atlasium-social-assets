# Visez production handoff — October 27, 2026

## Scope and safety

- Work only on Visez in `bidflo/` from development branch `codex/bidflo-next`.
- Visez is Atlasium's internal client-acquisition system. Do not build subscriptions, tenant onboarding, or unrelated products.
- Never submit an Upwork proposal, spend Connects, or send a client reply without Blair's explicit approval for that specific action.
- Use authorized Upwork sources only. Do not scrape Upwork or bypass platform controls.
- Preserve real production data and never present sample records as real opportunities.
- User-facing branding is Visez. Legacy `bidflo_` table identifiers and the existing Render URL are technical compatibility names only.

## Verified production state

- Live URL: `https://atlasium-bidflo.onrender.com`.
- Render web service: `srv-dbdqlld9fdbs738bbjb0`; five-minute cron: `crn-dbdqloqvcj2c738ia2o0`.
- Both services are image-backed and pinned to the same immutable `ghcr.io/atlasium788ai/visez:<release-sha>` image. Releases use GitHub Actions because Render native build minutes are unavailable.
- Neon production project `red-haze-71922576`, branch `br-bitter-sea-b5x6t3ei`, database `bidflo`.
- Authentication is enforced and restricted to `info@atlasium788.ca`. The login client has a 30-second deadline with cleanup, so failed or unavailable authentication cannot leave the button stuck on “Signing in…”.
- Private Slack destination `#visez-opportunities` is connected. The durable queue, retry handling, and genuine opportunity alerts are verified.
- The signed inbound-email path, AI proposal generation, independent quality review, Neon persistence, duplicate guards, approval queue, manual submission handoff, and server-side five-minute processor are implemented.
- The processor records a truthful check even when no new data exists. A successful invocation with `processed: 0` is not a successful opportunity discovery.
- Production migration `0010_high_value_capabilities.sql` adds Genesys Cloud CX, advertising, SEO/SEM, CRM-platform, funnel, and tracking signals while preserving custom settings. It requires specialist availability and delivery economics to be confirmed.

## Interface and workflow

- Preserve the approved three-tile homepage.
- Authenticated navigation has five operational sections: Opportunities, Proposals, Approvals, Follow-ups, Settings.
- Pipeline: New → Qualified → Draft Ready → Approved → Ready to Submit/Submission Processing → Submitted → Client Response → Interview → Won/Lost, with Nurture and explicit client opt-out handled separately.
- Proposal approval uses deterministic checks plus independent AI review. Unsupported proof, unclear scope, specialist availability, severe budget mismatch, and material delivery risks require human judgment.
- Follow-up drafts appear as Warm, Professional, and Direct. They are editable/copyable and never auto-send.
- Connects, account selection, and source-of-truth submission status must be confirmed in authenticated Upwork until a supported backend authorization exists.

## Current external boundary

- Real Upwork notification emails can enter through the signed webhook and are processed every five minutes. This is the verified autonomous intake path.
- A Codex Upwork connection does not automatically authorize the Render-hosted Visez server. Backend Upwork discovery, submission IDs, Connects reconciliation, and reply reconciliation remain unavailable until Atlasium grants a supported server-side integration.
- Do not claim that Visez searches Upwork directly while only notification-email intake is connected.
- Manual submission opens the correct Upwork job in the owner's authenticated browser and requires the owner to confirm the completed submission in Visez.

## Release procedure

1. Run tests, lint, and the Next production build locally.
2. Push `codex/bidflo-next`, cherry-pick the verified commit to the existing release branch, and require the GitHub quality and image workflows to pass.
3. Pin both Render services to the exact immutable image SHA; do not use a mutable tag.
4. Verify `/api/health`, anonymous redirects to `/login`, the login response/reset flow, migration records, a completed cron invocation, and Neon persistence.
5. Report only verified results and owner/platform blockers. Never expose credentials in source, logs, or reports.
