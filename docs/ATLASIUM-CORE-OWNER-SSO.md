# EchoFlow Social ↔ Atlasium Core: owner sign-in bridge

Status: **draft only, disabled by default**. This connects the existing Atlasium-owned EchoFlow workspace to an existing, verified ReeVIQ account. It does **not** make the currently single-workspace EchoFlow safe for other customers.

## User journey
1. Atlasium owner signs in to the existing ReeVIQ account and selects EchoFlow in Atlasium Core.
2. EchoFlow creates a new 288-bit browser nonce in a host-only Secure HttpOnly SameSite=Lax cookie, then directs the browser to ReeVIQ.
3. ReeVIQ issues a 256-bit random ticket, valid for 60 seconds and consumed atomically once.
4. EchoFlow exchanges the ticket directly with the ReeVIQ API using a dedicated server secret and compares the browser nonce. No passwords, long-lived access tokens, or legacy shared upload keys cross applications.
5. EchoFlow signs its own short-lived host-only Secure HttpOnly session cookie, restricted to a configured Atlasium owner identity.
6. All existing EchoFlow publishing, D1 brand/campaign data, and Buffer destinations remain under the original workspace. No new publishing is triggered by login.

## Configuration (staging; no secrets in Git)
| Variable | Where | Requirement |
| --- | --- | --- |
| `ATLASIUM_ECHOFLOW_SSO_ENABLED` | ReeVIQ and EchoFlow | `true` only during a controlled staged test |
| `ATLASIUM_ECHOFLOW_SHARED_SECRET` | ReeVIQ and EchoFlow | the same unique random secret (48+ characters), never shared with a browser |
| `ATLASIUM_ECHOFLOW_OWNER_SUBJECT` | ReeVIQ and EchoFlow | exact, verified UUID of the existing Atlasium owner in ReeVIQ |
| `ATLASIUM_ECHOFLOW_SESSION_SECRET` | EchoFlow | distinct high-entropy random secret (48+ characters) for signed EchoFlow cookies |
| `ATLASIUM_ECHOFLOW_BASE_URL` | ReeVIQ | exact public HTTPS origin serving the EchoFlow worker |
| `ATLASIUM_ECHOFLOW_PUBLIC_URL` | EchoFlow | the same public HTTPS origin |
| `ATLASIUM_CORE_FRONTEND_URL` | EchoFlow | exact HTTPS origin serving ReeVIQ front-end |
| `ATLASIUM_CORE_API_URL` | EchoFlow | exact HTTPS origin serving ReeVIQ API |

All configured URLs must be bare origins ending in `/`, with no path, query, username, password or fragment. The public URL must match the incoming Host/Origin. No example origin in this document is intended as a production value.

## Security and customer isolation
- EchoFlow's current `WORKSPACE_ID = "workspace_atlasium"` remains unchanged.
- **Only** the explicitly configured verified owner subject can create an Atlasium-origin EchoFlow session. An ordinary paying Atlasium customer cannot enter this shared workspace through the bridge.
- A valid session is bound to that subject and signed with a dedicated, separate session secret. It is not a general-purpose credential for arbitrary Atlasium users.
- Existing private publishing-key access and existing ChatGPT platform access remain unchanged during the pilot. Replace legacy localStorage and URL key handling separately; do not expose the shared key via SSO.
- Signing in is not paying. Every future customer workspace must have independently enforced plan/credits/usage limits before publishing and must not inherit Atlasium's company channels.
- The bridge does not auto-create an EchoFlow subscription, bill through Buffer, create a campaign, publish, queue or change social account connections.

## Customer-wide SSO release blockers
1. Refactor all EchoFlow D1/R2 brand, campaign, draft, media and publication queries to use an authenticated **tenant workspace ID** instead of the single hard-coded `WORKSPACE_ID`. Add real workspace membership and invite/role checks.
2. Resolve the Atlasium customer's identity to its own EchoFlow workspace through a server-trusted mapping; never infer a tenant from email, URL or header.
3. Add an authoritative, separately configured EchoFlow entitlement to the Atlasium plan catalog and enforce costs, wallet credits, rate limits and publication actions server-side. There is currently no confirmed paid EchoFlow allowance in ReeVIQ.
4. Define and verify a safe migration for existing customer EchoFlow data, including any currently shared access-key workflows; preserve all original Atlasium campaigns and destinations.
5. Run cross-app replay, expiry, nonce, CSRF, browser cookie, owner/non-owner, tenant isolation, prepaid credit, provider webhook, and account deletion/revocation tests in a real staging environment.
6. Add session revocation on logout and on suspension if deploying the bridge broadly. The initial signed cookie has a bounded 12-hour lifetime and logout clears it in the browser.

Do not activate the feature until the owner-only staging path is tested. Do not mark customer-wide SSO or billing integration complete from this draft.
