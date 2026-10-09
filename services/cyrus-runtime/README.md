# Atlasium executive bot runtime

The production runtime first proven by Cyrus and reused by Malik. One Railway
service runs one role, one Slack Socket Mode connection and one persistent
SQLite database. Identity, prompt, permissions, peers and data path are
configuration; execution and reliability code are shared.

## Guarantees in this build

- Direct messages are accepted only from `BLAIR_SLACK_USER_ID`.
- Slack delivery deduplication uses `event_id`, never message text.
- Tasks, steps, evidence, decisions, work plans, follow-ups and reply outbox live in SQLite and recover after restart.
- A task cannot be marked complete without evidence when it is an action request.
- Planned work must be evidence-complete before its parent objective can complete.
- Failed steps are retained and the agent can try a safe alternative.
- Retryable tool failures are retried once and both attempts are recorded.
- Automatic follow-ups persist through restarts and produce distinct deduplicated Slack replies.
- Private Railway handoffs are idempotent and only accept configured peer roles.
- Each bot can read only explicitly allowlisted HTTPS origins and non-DM Slack channels.
- Non-revenue roles receive no outbound-campaign tools. No role receives a
  general staff-messaging, spending, deletion, or production-deployment tool.
- `/health` reports SQLite state, Slack authentication and live socket status.
- `EXPECTED_SLACK_BOT_USER_ID` stops a service before Socket Mode starts if the
  supplied token belongs to the wrong bot.

## Supported role profiles

The same runtime accepts these `BOT_ROLE` values: `cyrus`, `malik`, `clara`,
`mateo`, `kenji`, `amara`, `nadia`, and `sloane`. Clara is explicitly the new
Command88 Clara and is forbidden from claiming the Viktor Clara identity or
history. Malik alone receives the revenue execution tools. The other department
roles receive the shared memory, planning, research, evidence, recovery,
follow-up, Slack-read, and verified handoff framework.

## Local test

```bash
node --test test/*.test.js
```

Run the opt-in live-model role gate only when API credit is available:

```bash
OPENAI_API_KEY=... node scripts/evaluate-roles.mjs
```

It evaluates the six duplicated department roles against their actual system
prompts. Each must use the health tool, refuse to impersonate another
department, deliver the cross-department objective to Cyrus, verify both pieces
of evidence, and only then complete.

## Railway prerequisites

1. Reuse an isolated empty or retired service slot; do not replace onboarding or a working bot.
2. Attach a role-specific persistent volume such as `/data/cyrus` or `/data/malik`.
3. Set `BOT_ROLE`, `EXPECTED_SLACK_BOT_USER_ID`, and only that role's Slack
   app/bot tokens.
4. Confirm the shared runtime no longer owns that role's socket before enabling Socket Mode here.
5. Deploy and pass `/health`, direct-DM, tool/evidence, failure-recovery, duplicate-event, follow-up, handoff and restart-memory tests.

Cyrus must list every live department service in `AGENT_PEERS_JSON`. Each
department service lists only Cyrus unless a direct department-to-department
route is deliberately approved. This keeps company memory and coordination
through Cyrus without creating another architecture or a shared SQLite file.

The recovered shared runtime and its Cyrus-socket handoff build are kept in
`../legacy-swarm-runtime`.

## Research support

All dedicated executive runtimes built from this template inherit the read-only `ask_chatgpt` tool. It can use OpenAI web search for current factual, technical, product, vendor, documentation, and troubleshooting questions and returns source URLs. Agents should use research before escalating general-knowledge questions to Blair. Public research never authorizes side effects, spending, prospect contact, legal commitments, or changes to live systems.
