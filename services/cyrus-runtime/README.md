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
- There is no tool for outbound campaigns, staff messages, spending, deletion or production deployment.
- `/health` reports SQLite state, Slack authentication and live socket status.

## Local test

```bash
node --test test/*.test.js
```

## Railway prerequisites

1. Reuse an isolated empty or retired service slot; do not replace onboarding or a working bot.
2. Attach a role-specific persistent volume such as `/data/cyrus` or `/data/malik`.
3. Set `BOT_ROLE` and only that role's Slack app/bot tokens.
4. Confirm the shared runtime no longer owns that role's socket before enabling Socket Mode here.
5. Deploy and pass `/health`, direct-DM, tool/evidence, failure-recovery, duplicate-event, follow-up, handoff and restart-memory tests.

The recovered shared runtime and its Cyrus-socket handoff build are kept in
`../legacy-swarm-runtime`.

## Research support

All dedicated executive runtimes built from this template inherit the read-only `ask_chatgpt` tool. It can use OpenAI web search for current factual, technical, product, vendor, documentation, and troubleshooting questions and returns source URLs. Agents should use research before escalating general-knowledge questions to Blair. Public research never authorizes side effects, spending, prospect contact, legal commitments, or changes to live systems.
