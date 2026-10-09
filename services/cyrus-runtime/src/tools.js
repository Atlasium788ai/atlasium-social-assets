import { createHash } from "node:crypto";

function ok(data, evidence) {
  return { ok: true, data, evidence };
}

function fail(error, retryable = false) {
  return { ok: false, error, retryable };
}

export function createToolbox({ store, config, slackApi, fetchImpl = fetch, agentDispatcher = null }) {
  let instantlyStageBusy = false;
  const definitions = [
    {
      type: "function",
      name: "recall_memory",
      description: "Recall active decisions and durable context from previous tasks and restarts.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    },
    {
      type: "function",
      name: "remember_decision",
      description: "Persist a decision Blair made, including why it was made.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" }, decision: { type: "string" }, rationale: { type: "string" } },
        required: ["topic", "decision", "rationale"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "system_health",
      description: `Check ${config.name}'s durable store and runtime health.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "list_operating_plan",
      description: "Read the durable Atlasium company-level operating plan: active priorities, owners, blockers, next actions, and evidence summaries.",
      parameters: { type: "object", properties: { include_completed: { type: "boolean" } }, additionalProperties: false },
    },
    {
      type: "function",
      name: "upsert_operating_item",
      description: "Cyrus only: create or update one durable company-level priority/open loop when its owner, status, blocker, or next action materially changes.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          owner: { type: "string" },
          status: { type: "string", enum: ["planned","running","blocked","completed"] },
          priority: { type: "integer", minimum: 1, maximum: 5 },
          next_action: { type: "string" },
          next_action_at: { type: "string" },
          evidence_summary: { type: "string" }
        },
        required: ["id","title","owner","status"],
        additionalProperties: false
      },
    },
    {
      type: "function",
      name: "create_work_plan",
      description: "Break the current objective into ordered work items with explicit owners and dependencies.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                owner: { type: "string" },
                depends_on: { type: "string" },
                next_action_at: { type: "string" },
              },
              required: ["id", "title", "owner"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "list_work_plan",
      description: "Read the current objective's durable work items and status.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "update_work_item",
      description: "Update a work item. Completed items require an evidence_id returned by a verified tool.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "string" },
          status: { type: "string", enum: ["planned", "running", "blocked", "completed"] },
          evidence_id: { type: "string" },
          next_action_at: { type: "string" },
        },
        required: ["item_id", "status"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "delegate_to_agent",
      description: "Deliver work to a connected Atlasium agent and wait for its verified response. Never use this for an unconnected role.",
      parameters: {
        type: "object",
        properties: { agent: { type: "string" }, objective: { type: "string" }, work_item_id: { type: "string" } },
        required: ["agent", "objective"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "schedule_followup",
      description: "Schedule an automatic reassessment when work is genuinely waiting. Minimum 15 seconds.",
      parameters: {
        type: "object",
        properties: { seconds: { type: "integer", minimum: 15, maximum: 86400 }, reason: { type: "string" } },
        required: ["seconds", "reason"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "http_read",
      description: "Read an allowlisted HTTPS page or API without changing it.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
    },
    {
      type: "function",
      name: "ask_chatgpt",
      description: "Ask the Atlasium research brain for a factual, technical, strategic, or troubleshooting answer. It can search the live public web when needed and returns source URLs. Use this before asking Blair for information that can be researched independently.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          context: { type: "string" },
          must_search_web: { type: "boolean" }
        },
        required: ["question"],
        additionalProperties: false
      },
    },
    {
      type: "function",
      name: "slack_channel_history",
      description: "Read recent evidence from an explicitly allowlisted non-DM Slack channel.",
      parameters: {
        type: "object",
        properties: { channel_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 30 } },
        required: ["channel_id"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "reeviq_leads",
      description: "Read up to 100 ReeVIQ leads for verified revenue prioritization. Read-only.",
      parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, status: { type: "string" } }, additionalProperties: false },
    },
    {
      type: "function",
      name: "instantly_campaign",
      description: "Read the configured Instantly campaign status and settings. Read-only. Never sends email.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "instantly_preflight",
      description: "Verify an Instantly campaign is safe for staging/launch preparation. Defaults to the configured campaign. Read-only.",
      parameters: { type: "object", properties: { campaign_id: { type: "string" } }, additionalProperties: false },
    },
    {
      type: "function",
      name: "instantly_create_fresh_pilot",
      description: "Create or reuse a clean draft Command88 pilot campaign based on the configured campaign copy, schedule, and sender accounts. Never activates or sends.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "instantly_campaign_leads",
      description: "Read an Instantly campaign lead inventory for duplicate and pilot-cap checks. Defaults to the configured campaign. Read-only.",
      parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, campaign_id: { type: "string" } }, additionalProperties: false },
    },
    {
      type: "function",
      name: "instantly_workspace_presence",
      description: "Read-only duplicate screen for up to 20 candidate emails. Returns which emails already exist anywhere in the Instantly workspace so Malik can choose a genuinely fresh contact before staging.",
      parameters: {
        type: "object",
        properties: {
          emails: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
          campaign_id: { type: "string" }
        },
        required: ["emails"],
        additionalProperties: false
      },
    },
    {
      type: "function",
      name: "instantly_stage_lead",
      description: "Stage one already-verified ReeVIQ lead into an inactive Instantly campaign without activating or sending. Uses Instantly's official bulk-add path, reconciles existing workspace leads by copy/move when needed, and verifies the exact lead/campaign relationship before reporting success.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          company_name: { type: "string" },
          website: { type: "string" },
          personalization: { type: "string" },
          campaign_id: { type: "string" },
          source_email_verified: { type: "boolean" }
        },
        required: ["email", "source_email_verified"],
        additionalProperties: false
      },
    },
    {
      type: "function",
      name: "instantly_activate_campaign",
      description: "Activate a small verified Instantly pilot only after strict safety preflight. Checks campaign copy, lead cap, sender health, opt-out/suppression guardrails, and verifies the sending state after activation.",
      parameters: {
        type: "object",
        properties: { campaign_id: { type: "string" } },
        required: ["campaign_id"],
        additionalProperties: false
      },
    },
    {
      type: "function",
      name: "instantly_pause_campaign",
      description: "Put the configured Instantly campaign into a non-sending state and verify the result.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "instantly_repair_cody_route",
      description: "Repair stale Cody-specific routing inside the configured inactive Instantly campaign sequence. Removes rep=cody URL routing and replaces Cody references with team-neutral wording, then verifies the repair. Never activates or sends.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "instantly_received_emails",
      description: "Read recent received Instantly emails/replies for live response triage. Read-only.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          unread_only: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 50 }
        },
        additionalProperties: false
      },
    },
    {
      type: "function",
      name: "instantly_unread_count",
      description: "Read the current Instantly unread reply count. Read-only.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "reeviq_lead",
      description: "Read one ReeVIQ lead and its current qualification/meeting state. Read-only.",
      parameters: { type: "object", properties: { lead_id: { type: "string" }, expected_email: { type: "string" }, expected_name: { type: "string" } }, required: ["lead_id"], additionalProperties: false },
    },
    {
      type: "function",
      name: "complete_task",
      description: "Mark an action complete. Action requests require evidence from another tool first.",
      parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
    },
    {
      type: "function",
      name: "report_blocker",
      description: "Stop only when a precise missing authority, access, credential, or decision prevents progress.",
      parameters: { type: "object", properties: { blocker: { type: "string" } }, required: ["blocker"], additionalProperties: false },
    },
  ];

  async function execute(name, args, context) {
    if (name === "recall_memory") return ok(store.recallDecisions(args.query));
    if (name === "remember_decision") {
      const row = store.rememberDecision({ ...args, sourceTaskId: context.taskId });
      return ok(row, { source: `${config.role}_memory`, claim: `Decision remembered: ${args.topic}`, detail: row });
    }
    if (name === "system_health") {
      const health = store.health();
      return ok(health, { source: `${config.role}_runtime`, claim: "Durable store health check passed", detail: health });
    }
    if (name === "list_operating_plan") {
      return ok(store.getOperatingItems({ includeCompleted: Boolean(args.include_completed) }));
    }
    if (name === "upsert_operating_item") {
      if (config.role !== "cyrus") return fail("Only Cyrus can update the company operating plan");
      if (!args.id?.trim() || !args.title?.trim() || !args.owner?.trim()) return fail("Operating item needs id, title, and owner");
      const row = store.upsertOperatingItem({
        id: args.id.trim(),
        title: args.title.trim(),
        owner: args.owner.trim(),
        status: args.status || "running",
        priority: Math.max(1, Math.min(5, Number(args.priority || 3))),
        nextAction: args.next_action?.trim() || null,
        nextActionAt: args.next_action_at?.trim() || null,
        evidenceSummary: args.evidence_summary?.trim() || null,
        sourceTaskId: context.taskId,
      });
      return ok(row, { source: "cyrus:operating_plan", claim: `Operating item updated: ${row.id} -> ${row.status}`, detail: row });
    }
    if (name === "http_read") {
      let url;
      try { url = new URL(args.url); } catch { return fail("Invalid URL"); }
      if (url.protocol !== "https:" || !config.httpReadAllowlist.has(url.origin)) return fail(`URL origin is not allowlisted: ${url.origin}`);
      try {
        const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(12_000) });
        const body = (await response.text()).slice(0, 12_000);
        if (!response.ok) return fail(`GET ${url} returned ${response.status}`, response.status >= 500);
        return ok({ status: response.status, body }, { source: String(url), claim: `Read returned HTTP ${response.status}`, detail: { status: response.status, bodySample: body.slice(0, 500) } });
      } catch (error) {
        return fail(`GET failed: ${error.message}`, true);
      }
    }
    if (name === "ask_chatgpt") {
      const question = String(args.question || "").trim();
      const contextText = String(args.context || "").trim();
      if (!question) return fail("Research question is required");
      if (question.length > 8_000 || contextText.length > 12_000) return fail("Research request is too large");
      try {
        const tools = [{ type: "web_search" }];
        const body = {
          model: config.openAiModel,
          instructions: [
            "You are the Atlasium internal research support brain.",
            "Answer the question directly and accurately.",
            "Use live web search for current, external, technical, product, vendor, legal/regulatory, pricing, documentation, or uncertain facts.",
            "Prefer primary/official sources for technical and product facts.",
            "Do not invent Atlasium-internal facts. Treat supplied context as internal context, not as public-source evidence.",
            "Do not take actions, contact people, spend money, or make commitments. Research and explain only.",
            "Return a concise answer suitable for another executive agent to act on."
          ].join("\n"),
          input: contextText ? `Context:\n${contextText}\n\nQuestion:\n${question}` : question,
          tools,
          tool_choice: args.must_search_web === false ? "auto" : "auto",
          include: ["web_search_call.action.sources"]
        };
        const response = await fetchImpl(`${config.openAiBaseUrl.replace(/\/$/, "")}/responses`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.openAiApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return fail(`Research service returned HTTP ${response.status}: ${String(result?.error?.message || "unknown error").slice(0,300)}`, response.status >= 500 || response.status === 429);
        const answer = result.output_text || (result.output || [])
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content || [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text || "")
          .join("\n");
        const citations = [];
        for (const item of result.output || []) {
          if (item.type === "message") {
            for (const part of item.content || []) {
              for (const ann of part.annotations || []) {
                if (ann?.type === "url_citation" && ann.url) citations.push({ title: ann.title || ann.url, url: ann.url });
              }
            }
          }
          if (item.type === "web_search_call") {
            for (const source of item.action?.sources || []) {
              if (source?.url) citations.push({ title: source.title || source.url, url: source.url });
            }
          }
        }
        const uniqueSources = [...new Map(citations.map((s) => [s.url, s])).values()].slice(0, 12);
        if (!answer.trim()) return fail("Research service returned no answer", true);
        const data = { answer: answer.trim(), sources: uniqueSources, searchedWeb: (result.output || []).some((item) => item.type === "web_search_call") };
        return ok(data, { source: "chatgpt:research", claim: `Research answer returned for: ${question.slice(0,160)}`, detail: { searchedWeb: data.searchedWeb, sources: uniqueSources.slice(0,6), answerSample: data.answer.slice(0,500) } });
      } catch (error) {
        return fail(`Research request failed: ${error.message}`, true);
      }
    }
    if (name === "slack_channel_history") {
      const id = args.channel_id;
      if (!config.slackAllowedChannelIds.has(id) || /^[DG]/.test(id)) return fail(`That Slack channel is not approved for ${config.name} evidence reads`);
      const result = await slackApi("conversations.history", { channel: id, limit: Math.min(args.limit || 20, 30) });
      if (!result.ok) return fail(result.error || "Slack history read failed", result.error === "ratelimited");
      const messages = (result.messages || []).map(({ ts, user, text }) => ({ ts, user, text }));
      return ok(messages, { source: `slack:${id}`, claim: `Read ${messages.length} channel messages`, detail: { latestTs: messages[0]?.ts || null } });
    }
    if (name === "create_work_plan") {
      if (!Array.isArray(args.items) || args.items.some((item) => !item?.id?.trim() || !item?.title?.trim() || !item?.owner?.trim())) {
        return fail("Every work item needs an id, title, and owner");
      }
      try { return ok(store.createWorkPlan(context.taskId, args.items)); }
      catch (error) { return fail(`Work plan rejected: ${error.message}`); }
    }
    if (name === "list_work_plan") return ok(store.getWorkItems(context.taskId));
    if (name === "update_work_item") {
      try {
        const row = store.updateWorkItem(context.taskId, args.item_id, {
          status: args.status,
          evidenceId: args.evidence_id || null,
          nextActionAt: args.next_action_at || null,
        });
        return ok(row);
      } catch (error) { return fail(`Work item update rejected: ${error.message}`); }
    }
    if (name === "delegate_to_agent") {
      const target = String(args.agent || "").toLowerCase();
      const handoffId = createHash("sha256").update(JSON.stringify([context.taskId, target, args.objective, args.work_item_id || ""])).digest("hex");
      if (agentDispatcher?.has(target)) {
        try {
          const body = await agentDispatcher.dispatch({
            id: handoffId,
            from: config.role,
            to: target,
            message: args.objective,
          });
          if (!body?.ok) return fail(body?.error || `Agent ${target} rejected the local handoff`);
          return ok(body, {
            source: `handoff:${target}`,
            claim: `Verified handoff to ${target}: ${body.status}`,
            detail: { handoffId, status: body.status, evidenceCount: body.evidenceCount || 0, transport: "local" },
          });
        } catch (error) {
          return fail(`Handoff to ${target} failed: ${error.message}`, true);
        }
      }
      const baseUrl = config.agentPeers[target];
      if (!baseUrl) return fail(`Agent ${target || "unknown"} is not connected for verified handoff`);
      try {
        const response = await fetchImpl(`${baseUrl}/handoff`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-atlasium-source": config.role },
          body: JSON.stringify({ id: handoffId, from: config.role, to: target, message: args.objective }),
          signal: AbortSignal.timeout(75_000),
        });
        let body;
        try { body = await response.json(); } catch { return fail(`Agent ${target} returned invalid JSON`, response.status >= 500); }
        if (!response.ok || !body.ok) return fail(body.error || `Agent ${target} returned ${response.status}`, response.status >= 500);
        const claim = `Verified handoff to ${target}: ${body.status}`;
        return ok(body, { source: `handoff:${target}`, claim, detail: { handoffId, status: body.status, evidenceCount: body.evidenceCount || 0 } });
      } catch (error) {
        return fail(`Handoff to ${target} failed: ${error.message}`, true);
      }
    }
    if (name === "reeviq_leads") {
      if (!config.reeviqBaseUrl) return fail("ReeVIQ base URL is not configured");
      if (!config.reeviqApiKeys.length) return fail("ReeVIQ API key is not configured");
      const limit = Math.max(1, Math.min(100, Number(args.limit || 25)));
      const status = String(args.status || "NEW").trim();
      const url = `${config.reeviqBaseUrl.replace(/\/$/, "")}/v1/xipherx-lead/fetch`;
      let lastStatus = 0;
      try {
        for (const key of config.reeviqApiKeys) {
          const response = await fetchImpl(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ filter: status ? { status } : {}, limit, page: 1, sortBy: "createdAt", sortType: "desc" }),
            signal: AbortSignal.timeout(12_000),
          });
          lastStatus = response.status;
          if ((response.status === 401 || response.status === 403) && key !== config.reeviqApiKeys.at(-1)) continue;
          if (response.status >= 500 && key !== config.reeviqApiKeys.at(-1)) continue;
          if (!response.ok) return fail(`ReeVIQ returned HTTP ${response.status}`, response.status >= 500);
          const body = await response.json();
          const data = body?.data ?? body;
          const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.leads) ? data.leads : Array.isArray(data?.results) ? data.results : Array.isArray(body?.items) ? body.items : [];
          const total = body?.total ?? body?.count ?? data?.total ?? data?.count ?? data?.pagination?.total ?? body?.pagination?.total ?? null;
          const leads = items.slice(0, limit).map((x) => {
            const lead = x?.lead ?? x;
            return { id: lead?.id || null, status: lead?.status || x?.status || null, firstName: lead?.firstName || null, lastName: lead?.lastName || null, email: lead?.email || null, phone: lead?.phone || null, companyName: lead?.companyName || null, jobTitle: lead?.jobTitle || null, industry: lead?.industry || null, location: lead?.location || null, provider: lead?.provider || null, emailVerified: lead?.emailVerified ?? null, phoneVerified: lead?.phoneVerified ?? null };
          });
          return ok({ total, count: leads.length, leads }, { source: "reeviq:leads", claim: `Read ${leads.length} ReeVIQ ${status || "all"} leads`, detail: { total, count: leads.length, sampleIds: leads.slice(0, 10).map((lead) => lead.id) } });
        }
        return fail(`ReeVIQ request failed (HTTP ${lastStatus || "unknown"})`, lastStatus >= 500);
      } catch (error) { return fail(`ReeVIQ read failed: ${error.message}`, true); }
    }
    if (name === "instantly_campaign") {
      if (!config.instantlyApiKey) return fail("Instantly API key is not configured");
      if (!config.instantlyCampaignId) return fail("Instantly campaign ID is not configured");
      try {
        const url = `${config.instantlyBaseUrl.replace(/\/$/, "")}/campaigns/${encodeURIComponent(config.instantlyCampaignId)}`;
        const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return fail(`Instantly returned HTTP ${response.status}`, response.status >= 500);
        const body = await response.json();
        const data = { id: body.id || null, name: body.name || null, status: body.status ?? null, dailyLimit: body.daily_limit ?? body.dailyLimit ?? null, emailListCount: body.email_list_count ?? body.emailListCount ?? null, stopOnReply: body.stop_on_reply ?? body.stopOnReply ?? null };
        return ok(data, { source: "instantly:campaign", claim: "Read configured Instantly campaign", detail: data });
      } catch (error) { return fail(`Instantly campaign read failed: ${error.message}`, true); }
    }
    if (name === "instantly_preflight") {
      if (!config.instantlyApiKey) return fail("Instantly API key is not configured");
      const campaignId = String(args.campaign_id || config.instantlyCampaignId || "").trim();
      if (!campaignId) return fail("Instantly campaign ID is not configured");
      try {
        const url = `${config.instantlyBaseUrl.replace(/\/$/, "")}/campaigns/${encodeURIComponent(campaignId)}`;
        const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return fail(`Instantly returned HTTP ${response.status}`, response.status >= 500);
        const body = await response.json();
        const serialized = JSON.stringify(body);
        const status = Number(body.status);
        const staleCodyRoute = /rep=cody|\/cody\/|\bcody\b/i.test(serialized);
        const retiredBrand = /\bcoreiq\b|\bgojiberry\b/i.test(serialized);
        const hasSequence = Array.isArray(body.sequences) && body.sequences.length > 0;
        const senderCount = Array.isArray(body.email_list) ? body.email_list.length : 0;
        const sequenceCount = Array.isArray(body.sequences) ? body.sequences.length : Array.isArray(body.sequence) ? body.sequence.length : null;
        const safeInactive = [0, 2, 3].includes(status);
        const data = {
          id: body.id || campaignId,
          name: body.name || null,
          status,
          statusLabel: ({0:"draft",1:"active",2:"paused",3:"completed",4:"running_subsequences"})[status] || `status_${status}`,
          staleCodyRoute,
          sequenceCount,
          senderCount,
          retiredBrand,
          stopOnReply: body.stop_on_reply ?? null,
          allowRiskyContacts: body.allow_risky_contacts ?? null,
          safeToStage: safeInactive && !staleCodyRoute && !retiredBrand && hasSequence && senderCount > 0
        };
        return ok(data, { source: "instantly:preflight", claim: `Instantly preflight: ${data.name || data.id} is ${data.statusLabel}; safeToStage=${data.safeToStage}; staleCodyRoute=${staleCodyRoute}; retiredBrand=${retiredBrand}; senders=${senderCount}`, detail: data });
      } catch (error) { return fail(`Instantly preflight failed: ${error.message}`, true); }
    }
    if (name === "instantly_activate_campaign") {
      if (!config.instantlyApiKey) return fail("Instantly API key is not configured");
      const campaignId = String(args.campaign_id || "").trim();
      if (!campaignId) return fail("campaign_id is required");
      const base = config.instantlyBaseUrl.replace(/\/$/, "");
      const readHeaders = { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" };
      const jsonHeaders = { ...readHeaders, "Content-Type": "application/json" };
      try {
        const campaignRes = await fetchImpl(`${base}/campaigns/${encodeURIComponent(campaignId)}`, { headers: readHeaders, signal: AbortSignal.timeout(10_000) });
        if (!campaignRes.ok) return fail(`Campaign preflight returned HTTP ${campaignRes.status}`, campaignRes.status >= 500);
        const campaign = await campaignRes.json();
        const status = Number(campaign.status);
        if (![0,2].includes(status)) return fail(`Refusing activation from campaign status ${status}; expected draft or paused`);

        const seqText = JSON.stringify(campaign.sequences || []);
        if (!Array.isArray(campaign.sequences) || !campaign.sequences.length) return fail("Refusing activation: campaign has no sequence");
        if (/rep=cody|\/cody\/|\bcody\b/i.test(seqText)) return fail("Refusing activation: campaign contains stale Cody-specific routing");
        if (/\bcoreiq\b|\bgojiberry\b/i.test(seqText)) return fail("Refusing activation: campaign contains retired Atlasium branding");
        if (/our%20team|\/our team\//i.test(seqText)) return fail("Refusing activation: campaign may contain a malformed repaired booking URL");
        if (!campaign?.campaign_schedule?.schedules?.length) return fail("Refusing activation: campaign has no sending schedule");
        if (campaign.stop_on_reply !== true) return fail("Refusing activation: stop_on_reply is not enabled");
        if (campaign.allow_risky_contacts === true) return fail("Refusing activation: risky contacts are enabled");
        if (campaign.insert_unsubscribe_header === false) return fail("Refusing activation: unsubscribe header is disabled");

        const leadRes = await fetchImpl(`${base}/leads/list`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ campaign: campaignId, in_campaign: true, limit: 100 }),
          signal: AbortSignal.timeout(12_000)
        });
        if (!leadRes.ok) return fail(`Lead preflight returned HTTP ${leadRes.status}`, leadRes.status >= 500);
        const leadBody = await leadRes.json().catch(() => ({}));
        const rawLeads = Array.isArray(leadBody) ? leadBody : Array.isArray(leadBody?.items) ? leadBody.items : Array.isArray(leadBody?.data) ? leadBody.data : Array.isArray(leadBody?.leads) ? leadBody.leads : Array.isArray(leadBody?.data?.items) ? leadBody.data.items : [];
        const leadCount = Number(leadBody?.total ?? leadBody?.count ?? leadBody?.data?.total ?? rawLeads.length);
        const pilotCap = Math.max(1, Number(process.env.INSTANTLY_PILOT_CAP || 5));
        if (leadCount < 1) return fail("Refusing activation: pilot has no leads");
        if (leadCount > pilotCap) return fail(`Refusing activation: pilot has ${leadCount} leads above cap ${pilotCap}`);

        const senders = (Array.isArray(campaign.email_list) ? campaign.email_list : [])
          .map((item) => typeof item === "string" ? item : item?.email)
          .filter(Boolean);
        if (!senders.length) return fail("Refusing activation: no sending accounts configured");
        const accountStates = [];
        for (const email of senders) {
          const accountRes = await fetchImpl(`${base}/accounts/${encodeURIComponent(email)}`, { headers: readHeaders, signal: AbortSignal.timeout(10_000) });
          if (!accountRes.ok) return fail(`Sender preflight failed for ${email}: HTTP ${accountRes.status}`);
          const account = await accountRes.json();
          accountStates.push({ email, status: Number(account.status), warmupStatus: account.warmup_status ?? null });
          if (Number(account.status) !== 1) return fail(`Refusing activation: sender ${email} is not active (status ${account.status})`);
        }

        const vitalsRes = await fetchImpl(`${base}/accounts/test/vitals`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ accounts: senders }),
          signal: AbortSignal.timeout(15_000)
        });
        if (!vitalsRes.ok) return fail(`Sender vitals preflight returned HTTP ${vitalsRes.status}`, vitalsRes.status >= 500 || vitalsRes.status === 429);
        const vitals = await vitalsRes.json();
        const failures = Array.isArray(vitals?.failure_list) ? vitals.failure_list : [];
        const successes = Array.isArray(vitals?.success_list) ? vitals.success_list : [];
        if (failures.length) return fail(`Refusing activation: sender-domain vitals failed for ${failures.map((x)=>x.domain).filter(Boolean).join(", ") || failures.length + " domain(s)"}`);
        if (successes.some((x) => x.allPass === false)) return fail("Refusing activation: one or more sender-domain vitals did not pass");

        const activateRes = await fetchImpl(`${base}/campaigns/${encodeURIComponent(campaignId)}/activate`, {
          method: "POST",
          headers: jsonHeaders,
          signal: AbortSignal.timeout(15_000)
        });
        const activateText = await activateRes.text();
        let activateBody = {};
        try { activateBody = activateText ? JSON.parse(activateText) : {}; } catch { activateBody = { raw: activateText.slice(0,500) }; }
        if (!activateRes.ok) return fail(`Instantly activation returned HTTP ${activateRes.status}: ${String(activateBody?.message || activateBody?.error || activateText).slice(0,300)}`, activateRes.status >= 500 || activateRes.status === 429);

        const verifyRes = await fetchImpl(`${base}/campaigns/${encodeURIComponent(campaignId)}`, { headers: readHeaders, signal: AbortSignal.timeout(10_000) });
        if (!verifyRes.ok) return fail(`Activation verification returned HTTP ${verifyRes.status}`);
        const verified = await verifyRes.json();
        const afterStatus = Number(verified.status);
        if (![1,4].includes(afterStatus)) return fail(`Campaign activation was not verified; resulting status ${afterStatus}`);

        const sendingRes = await fetchImpl(`${base}/campaigns/${encodeURIComponent(campaignId)}/sending-status`, { headers: readHeaders, signal: AbortSignal.timeout(10_000) });
        const sending = sendingRes.ok ? await sendingRes.json() : null;
        const reason = sending?.diagnostics?.status ?? sending?.summary?.status ?? null;
        const data = { campaignId, leadCount, pilotCap, senders: accountStates, status: afterStatus, sendingReason: reason };
        return ok(data, { source: "instantly:campaign_activation", claim: `Activated verified Command88 pilot ${campaignId} with ${leadCount} lead(s); status ${afterStatus}; sending reason ${reason || "unknown"}`, detail: data });
      } catch (error) {
        return fail(`Instantly activation failed: ${error.message}`, true);
      }
    }
    if (name === "instantly_pause_campaign") {
      if (!config.instantlyApiKey || !config.instantlyCampaignId) return fail("Instantly campaign access is not configured");
      const base = config.instantlyBaseUrl.replace(/\/$/, "");
      const url = `${base}/campaigns/${encodeURIComponent(config.instantlyCampaignId)}`;
      const headers = { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" };
      try {
        const beforeRes = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10000) });
        if (!beforeRes.ok) return fail(`Instantly campaign read returned HTTP ${beforeRes.status}`);
        const before = await beforeRes.json();
        const beforeStatus = Number(before.status);
        if ([0,2,3].includes(beforeStatus)) return ok({ beforeStatus, afterStatus: beforeStatus, changed: false }, { source: "instantly:campaign_pause", claim: `Campaign already non-sending at status ${beforeStatus}`, detail: { beforeStatus } });
        if (![1,4].includes(beforeStatus)) return fail(`Unexpected campaign status ${beforeStatus}`);
        const stopRes = await fetchImpl(`${url}/pause`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, signal: AbortSignal.timeout(12000) });
        if (!stopRes.ok) return fail(`Instantly pause returned HTTP ${stopRes.status}`, stopRes.status >= 500 || stopRes.status === 429);
        const verifyRes = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10000) });
        if (!verifyRes.ok) return fail(`Instantly pause verification returned HTTP ${verifyRes.status}`);
        const after = await verifyRes.json();
        const afterStatus = Number(after.status);
        if ([1,4].includes(afterStatus)) return fail(`Campaign remained in sending state ${afterStatus}`);
        return ok({ beforeStatus, afterStatus, changed: true }, { source: "instantly:campaign_pause", claim: `Campaign paused and verified non-sending at status ${afterStatus}`, detail: { beforeStatus, afterStatus } });
      } catch (error) { return fail(`Instantly pause failed: ${error.message}`, true); }
    }
    if (name === "instantly_repair_cody_route") {
      if (!config.instantlyApiKey) return fail("Instantly API key is not configured");
      if (!config.instantlyCampaignId) return fail("Instantly campaign ID is not configured");
      const cleanString = (value) => {
        let out = String(value);
        out = out
          .replace(/([?&])rep=cody(?=(&|#|$))/gi, (match, sep, tail) => tail === "&" ? sep : "")
          .replace(/\?&/g, "?")
          .replace(/[?&]$/g, "");
        out = out
          .replace(/book(?:ing)?\s+(?:a\s+call\s+)?with\s+cody/gi, "book a time with our team")
          .replace(/schedule(?:d|ing)?\s+(?:a\s+call\s+)?with\s+cody/gi, "schedule a time with our team")
          .replace(/meet(?:ing)?\s+with\s+cody/gi, "meet with our team")
          .replace(/\bcody\b/gi, "our team");
        return out;
      };
      const transform = (value) => {
        if (typeof value === "string") return cleanString(value);
        if (Array.isArray(value)) return value.map(transform);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v)]));
        return value;
      };
      try {
        const base = config.instantlyBaseUrl.replace(/\/$/, "");
        const getUrl = `${base}/campaigns/${encodeURIComponent(config.instantlyCampaignId)}`;
        const response = await fetchImpl(getUrl, { headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return fail(`Instantly campaign read returned HTTP ${response.status}`, response.status >= 500);
        const campaign = await response.json();
        const status = Number(campaign.status);
        if (![0, 2, 3].includes(status)) return fail(`Refusing route repair while campaign can send or has unknown status ${status}`);
        if (!Array.isArray(campaign.sequences) || !campaign.sequences.length) return fail("Campaign has no editable sequence payload");
        const before = JSON.stringify(campaign.sequences);
        if (!/rep=cody|\bcody\b/i.test(before)) {
          return ok({ changed: false, verified: true, status }, { source: "instantly:route_repair", claim: "Instantly campaign already has no Cody-specific routing", detail: { changed: false, status } });
        }
        const sequences = transform(campaign.sequences);
        const after = JSON.stringify(sequences);
        if (/rep=cody|\bcody\b/i.test(after)) return fail("Route repair could not remove all Cody-specific references; refusing partial update");
        const patchResponse = await fetchImpl(getUrl, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ sequences }),
          signal: AbortSignal.timeout(15_000)
        });
        const patchText = await patchResponse.text();
        if (!patchResponse.ok) return fail(`Instantly route repair returned HTTP ${patchResponse.status}: ${patchText.slice(0, 300)}`, patchResponse.status >= 500 || patchResponse.status === 429);
        const verifyResponse = await fetchImpl(getUrl, { headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (!verifyResponse.ok) return fail(`Instantly repair verification returned HTTP ${verifyResponse.status}`, verifyResponse.status >= 500);
        const verifiedCampaign = await verifyResponse.json();
        const remaining = /rep=cody|\bcody\b/i.test(JSON.stringify(verifiedCampaign.sequences || []));
        if (remaining) return fail("Instantly route repair verification still found Cody-specific routing");
        const data = { changed: true, verified: true, campaignId: config.instantlyCampaignId, status };
        return ok(data, { source: "instantly:route_repair", claim: "Removed and verified stale Cody-specific routing from inactive Instantly campaign", detail: data });
      } catch (error) { return fail(`Instantly route repair failed: ${error.message}`, true); }
    }
    if (name === "instantly_create_fresh_pilot") {
      if (!config.instantlyApiKey || !config.instantlyCampaignId) return fail("Instantly campaign access is not configured");
      const pilotPrefix = "Atlasium Revenue Leak Assessment - Command88 Pilot";
      const pilotCap = Math.max(1, Number(process.env.INSTANTLY_PILOT_CAP || 5));
      const base = config.instantlyBaseUrl.replace(/\/$/, "");
      const headers = { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" };
      const countCampaignLeads = async (campaignId) => {
        const response = await fetchImpl(`${base}/leads/list`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ campaign: campaignId, in_campaign: true, limit: 100 }),
          signal: AbortSignal.timeout(12_000)
        });
        if (!response.ok) return null;
        const body = await response.json().catch(() => ({}));
        const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : Array.isArray(body?.leads) ? body.leads : Array.isArray(body?.data?.items) ? body.data.items : [];
        return Number(body?.total ?? body?.count ?? body?.data?.total ?? items.length);
      };
      try {
        const listRes = await fetchImpl(`${base}/campaigns?limit=100&search=${encodeURIComponent(pilotPrefix)}`, { headers, signal: AbortSignal.timeout(10000) });
        if (listRes.ok) {
          const listBody = await listRes.json();
          const items = Array.isArray(listBody) ? listBody : Array.isArray(listBody?.items) ? listBody.items : Array.isArray(listBody?.data) ? listBody.data : [];
          const candidates = items
            .filter((item) => String(item?.name || "").startsWith(pilotPrefix) && [0,2].includes(Number(item?.status)));
          const usable = [];
          for (const existing of candidates) {
            if (!existing?.id) continue;
            const count = await countCampaignLeads(existing.id);
            if (count != null && count < pilotCap) usable.push({ existing, count });
          }
          usable.sort((a,b) => {
            if (b.count !== a.count) return b.count - a.count;
            return String(b.existing?.timestamp_created || "").localeCompare(String(a.existing?.timestamp_created || ""));
          });
          if (usable.length) {
            const { existing, count } = usable[0];
            const data = { id: existing.id, name: existing.name, status: Number(existing.status), reused: true, leadCount: count, pilotCap };
            return ok(data, { source: "instantly:fresh_pilot", claim: `Reused fullest safe Command88 pilot ${existing.id} with ${count}/${pilotCap} leads in non-sending status ${existing.status}`, detail: data });
          }
        }

        const sourceRes = await fetchImpl(`${base}/campaigns/${encodeURIComponent(config.instantlyCampaignId)}`, { headers, signal: AbortSignal.timeout(10000) });
        if (!sourceRes.ok) return fail(`Source campaign read returned HTTP ${sourceRes.status}`, sourceRes.status >= 500);
        const source = await sourceRes.json();
        const sourceSerialized = JSON.stringify(source?.sequences || []);
        if (/rep=cody|\/cody\/|\bcody\b/i.test(sourceSerialized)) return fail("Source campaign copy still contains Cody-specific routing");
        if (/\bcoreiq\b|\bgojiberry\b/i.test(sourceSerialized)) return fail("Source campaign copy contains retired Atlasium branding");
        if (!source?.campaign_schedule?.schedules?.length) return fail("Source campaign has no reusable schedule");
        if (!Array.isArray(source?.sequences) || !source.sequences.length) return fail("Source campaign has no reusable sequence");
        if (!Array.isArray(source?.email_list) || !source.email_list.length) return fail("Source campaign has no sender accounts configured");

        const stamp = new Date().toISOString().replace(/[-:]/g,"").slice(0,13);
        const pilotName = `${pilotPrefix} ${stamp}`;
        const payload = {
          name: pilotName,
          campaign_schedule: source.campaign_schedule,
          sequences: source.sequences,
          email_list: source.email_list,
          stop_on_reply: true,
          stop_on_auto_reply: source.stop_on_auto_reply ?? true,
          stop_for_company: source.stop_for_company ?? false,
          daily_limit: Math.max(1, Math.min(5, Number(source.daily_limit || 5))),
          daily_max_leads: Math.max(1, Math.min(5, Number(source.daily_max_leads || 5))),
          email_gap: Math.max(10, Number(source.email_gap || 10)),
          open_tracking: source.open_tracking ?? false,
          link_tracking: source.link_tracking ?? false,
          text_only: source.text_only ?? false,
          insert_unsubscribe_header: source.insert_unsubscribe_header ?? true,
          allow_risky_contacts: false
        };
        const createRes = await fetchImpl(`${base}/campaigns`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000)
        });
        const createText = await createRes.text();
        let created = {};
        try { created = createText ? JSON.parse(createText) : {}; } catch { created = { raw: createText.slice(0,500) }; }
        if (!createRes.ok) return fail(`Fresh pilot creation returned HTTP ${createRes.status}: ${String(created?.message || created?.error || createText).slice(0,300)}`, createRes.status >= 500 || createRes.status === 429);
        const id = created?.id || created?.data?.id;
        if (!id) return fail("Fresh pilot campaign was created but no campaign ID was returned");
        const verifyRes = await fetchImpl(`${base}/campaigns/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(10000) });
        if (!verifyRes.ok) return fail(`Fresh pilot verification returned HTTP ${verifyRes.status}`);
        const verified = await verifyRes.json();
        const status = Number(verified?.status);
        if (![0,2].includes(status)) return fail(`Fresh pilot created in unexpected sending-capable status ${status}`);
        if (/rep=cody|\/cody\/|\bcody\b/i.test(JSON.stringify(verified?.sequences || []))) return fail("Fresh pilot verification found stale Cody routing");
        if (/\bcoreiq\b|\bgojiberry\b/i.test(JSON.stringify(verified?.sequences || []))) return fail("Fresh pilot verification found retired Atlasium branding");
        const leadCount = await countCampaignLeads(id);
        if (leadCount !== 0) return fail(`Fresh pilot verification expected 0 leads but found ${leadCount}`);
        const data = { id, name: verified?.name || pilotName, status, reused: false, leadCount: 0, pilotCap, dailyLimit: verified?.daily_limit ?? payload.daily_limit, senderCount: Array.isArray(verified?.email_list) ? verified.email_list.length : source.email_list.length };
        return ok(data, { source: "instantly:fresh_pilot", claim: `Created distinct clean draft Command88 pilot ${id}; 0/${pilotCap} leads; daily limit ${data.dailyLimit}; senders ${data.senderCount}`, detail: data });
      } catch (error) { return fail(`Fresh pilot creation failed: ${error.message}`, true); }
    }
    if (name === "instantly_campaign_leads") {
      if (!config.instantlyApiKey || !config.instantlyCampaignId) return fail("Instantly campaign access is not configured");
      const limit = Math.max(1, Math.min(100, Number(args.limit || 100)));
      const campaignId = String(args.campaign_id || config.instantlyCampaignId || "").trim();
      if (!campaignId) return fail("Instantly campaign ID is not configured");
      try {
        const base = config.instantlyBaseUrl.replace(/\/$/, "");
        const response = await fetchImpl(`${base}/leads/list`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ campaign: campaignId, in_campaign: true, limit }),
          signal: AbortSignal.timeout(12_000)
        });
        const textBody = await response.text();
        let body = {};
        try { body = textBody ? JSON.parse(textBody) : {}; } catch { body = { raw: textBody.slice(0, 500) }; }
        if (!response.ok) return fail(`Instantly lead inventory returned HTTP ${response.status}: ${String(body?.message || body?.error || textBody).slice(0,300)}`, response.status >= 500 || response.status === 429);
        const rawItems = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : Array.isArray(body?.leads) ? body.leads : Array.isArray(body?.data?.items) ? body.data.items : [];
        const leads = rawItems.map((lead) => ({
          id: lead?.id || null,
          email: lead?.email || null,
          status: lead?.status ?? lead?.lead_status ?? null,
          campaignId: lead?.campaign || lead?.campaign_id || null,
          createdAt: lead?.created_at || lead?.createdAt || null
        }));
        const counts = {};
        for (const lead of leads) counts[String(lead.status ?? "unknown")] = (counts[String(lead.status ?? "unknown")] || 0) + 1;
        const total = Number(body?.total ?? body?.count ?? body?.data?.total ?? leads.length);
        const uniqueCampaignIds = [...new Set(leads.map((lead) => lead.campaignId).filter(Boolean))];
        const data = { total, returned: leads.length, counts, campaignIds: uniqueCampaignIds, leads };
        return ok(data, { source: "instantly:campaign_leads", claim: `Read ${leads.length} Instantly leads for requested campaign ${campaignId}; total ${total}; returned campaign IDs ${uniqueCampaignIds.join(",") || "none"}; statuses ${JSON.stringify(counts)}`, detail: { campaignId, total, returned: leads.length, counts, campaignIds: uniqueCampaignIds, sample: leads.slice(0,10) } });
      } catch (error) { return fail(`Instantly lead inventory failed: ${error.message}`, true); }
    }
    if (name === "instantly_workspace_presence") {
      if (!config.instantlyApiKey) return fail("Instantly API key is not configured");
      const campaignId = String(args.campaign_id || config.instantlyCampaignId || "").trim();
      const emails = [...new Set((args.emails || []).map((email) => String(email || "").trim().toLowerCase()).filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)))].slice(0,20);
      if (!emails.length) return fail("At least one valid email is required");
      const base = config.instantlyBaseUrl.replace(/\/$/, "");
      const headers = { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json", "Content-Type": "application/json" };
      try {
        const present = [];
        const absent = [];
        for (const email of emails) {
          const response = await fetchImpl(`${base}/leads/list`, {
            method: "POST",
            headers,
            body: JSON.stringify({ search: email, limit: 20 }),
            signal: AbortSignal.timeout(12_000)
          });
          if (!response.ok) return fail(`Instantly duplicate screen returned HTTP ${response.status} for ${email}`, response.status >= 500 || response.status === 429);
          const body = await response.json().catch(() => ({}));
          const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : Array.isArray(body?.leads) ? body.leads : Array.isArray(body?.data?.items) ? body.data.items : [];
          const matches = items.filter((lead) => String(lead?.email || "").trim().toLowerCase() === email);
          if (!matches.length) {
            absent.push(email);
            continue;
          }
          present.push({
            email,
            leadIds: matches.map((lead) => lead?.id).filter(Boolean),
            campaignIds: [...new Set(matches.map((lead) => lead?.campaign || lead?.campaign_id).filter(Boolean))],
            inTarget: Boolean(campaignId && matches.some((lead) => String(lead?.campaign || lead?.campaign_id || "") === campaignId))
          });
        }
        const data = { checked: emails.length, campaignId: campaignId || null, absent, present };
        return ok(data, { source: "instantly:workspace_presence", claim: `Screened ${emails.length} candidate email(s): ${absent.length} fresh, ${present.length} already in workspace`, detail: data });
      } catch (error) {
        return fail(`Instantly duplicate screen failed: ${error.message}`, true);
      }
    }
    if (name === "instantly_stage_lead") {
      if (!config.instantlyApiKey) return fail("Instantly API key is not configured");
      const campaignId = String(args.campaign_id || config.instantlyCampaignId || "").trim();
      if (!campaignId) return fail("Instantly campaign ID is not configured");
      const email = String(args.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("A valid lead email is required");
      if (args.source_email_verified !== true) return fail("Refusing staging: source_email_verified must be true from a verified ReeVIQ record");
      if (instantlyStageBusy) return fail("Another verified Instantly staging write is already in progress; retry after it finishes", true);
      instantlyStageBusy = true;

      const headers = { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json", "Content-Type": "application/json" };
      const base = config.instantlyBaseUrl.replace(/\/$/, "");
      const parseJson = async (response) => {
        const text = await response.text();
        try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 1000) }; }
      };
      const listExact = async (extra = {}) => {
        const response = await fetchImpl(`${base}/leads/list`, {
          method: "POST",
          headers,
          body: JSON.stringify({ search: email, limit: 100, ...extra }),
          signal: AbortSignal.timeout(12_000)
        });
        const body = await parseJson(response);
        if (!response.ok) throw new Error(`Instantly exact lead lookup HTTP ${response.status}: ${String(body?.message || body?.error || body?.raw || "").slice(0,300)}`);
        const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : Array.isArray(body?.leads) ? body.leads : Array.isArray(body?.data?.items) ? body.data.items : [];
        return items.filter((lead) => String(lead?.email || "").trim().toLowerCase() === email);
      };
      const verifyLead = async (leadId) => {
        if (!leadId) return null;
        const response = await fetchImpl(`${base}/leads/${encodeURIComponent(leadId)}`, {
          headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) return null;
        const body = await response.json();
        const lead = body?.data ?? body;
        if (String(lead?.email || "").trim().toLowerCase() !== email) return null;
        return lead;
      };
      const verifyTarget = async (leadId = null) => {
        const direct = await verifyLead(leadId);
        if (direct && String(direct?.campaign || "") === campaignId) return direct;
        const exact = await listExact({ campaign: campaignId, in_campaign: true });
        return exact.find((lead) => String(lead?.campaign || "") === campaignId) || null;
      };
      const waitForJob = async (jobId) => {
        if (!jobId) return null;
        let last = null;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
          const response = await fetchImpl(`${base}/background-jobs/${encodeURIComponent(jobId)}`, {
            headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" },
            signal: AbortSignal.timeout(10_000)
          });
          if (!response.ok) continue;
          last = await response.json();
          const status = String(last?.status || last?.data?.status || "").toLowerCase();
          if (["success","completed"].includes(status)) return last;
          if (["failed","error","cancelled"].includes(status)) throw new Error(`Instantly background job ${jobId} failed with status ${status}`);
        }
        return last;
      };

      try {
        // Campaign must remain incapable of sending while we stage/test.
        const campaignResponse = await fetchImpl(`${base}/campaigns/${encodeURIComponent(campaignId)}`, {
          headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000)
        });
        if (!campaignResponse.ok) return fail(`Instantly campaign preflight returned HTTP ${campaignResponse.status}`, campaignResponse.status >= 500);
        const campaign = await campaignResponse.json();
        const status = Number(campaign.status);
        if (![0,2,3].includes(status)) return fail(`Refusing to stage into a sending/unknown campaign state ${status}`);
        if (/rep=cody|\bcody\b/i.test(JSON.stringify(campaign))) return fail("Refusing to stage: campaign still contains Cody-specific routing");

        // Exact target duplicate check first.
        const targetMatches = await listExact({ campaign: campaignId, in_campaign: true });
        const targetExisting = targetMatches.find((lead) => String(lead?.campaign || "") === campaignId);
        if (targetExisting) {
          const data = { accepted: false, duplicate: true, verified: true, email, campaignId, leadId: targetExisting.id || null, path: "already_in_target" };
          return ok(data, { source: "instantly:lead_stage", claim: `Verified ${email} already exists in target campaign ${campaignId}`, detail: data });
        }

        // Respect pilot cap using authoritative target inventory before any write.
        const inventoryResponse = await fetchImpl(`${base}/leads/list`, {
          method: "POST",
          headers,
          body: JSON.stringify({ campaign: campaignId, in_campaign: true, limit: 100 }),
          signal: AbortSignal.timeout(12_000)
        });
        const inventoryBody = await parseJson(inventoryResponse);
        if (!inventoryResponse.ok) return fail(`Cannot verify Instantly campaign inventory before staging (HTTP ${inventoryResponse.status})`, inventoryResponse.status >= 500 || inventoryResponse.status === 429);
        const inventoryItems = Array.isArray(inventoryBody) ? inventoryBody : Array.isArray(inventoryBody?.items) ? inventoryBody.items : Array.isArray(inventoryBody?.data) ? inventoryBody.data : Array.isArray(inventoryBody?.leads) ? inventoryBody.leads : Array.isArray(inventoryBody?.data?.items) ? inventoryBody.data.items : [];
        const pilotCap = Math.max(1, Number(process.env.INSTANTLY_PILOT_CAP || 5));
        if (inventoryItems.length >= pilotCap) return fail(`Pilot cap reached: target campaign has ${inventoryItems.length} visible leads (cap ${pilotCap})`);

        // Existing workspace contacts are not copied between campaigns during pilot construction.
        // Choose a genuinely fresh verified contact instead; this avoids async move/copy ambiguity.
        const workspaceMatches = await listExact();
        const existingElsewhere = workspaceMatches.find((lead) => String(lead?.campaign || "") !== campaignId);
        if (existingElsewhere?.id) {
          const data = {
            accepted: false,
            verified: true,
            duplicateWorkspace: true,
            chooseAnother: true,
            email,
            existingLeadId: existingElsewhere.id,
            existingCampaignId: existingElsewhere?.campaign || existingElsewhere?.campaign_id || null,
            campaignId
          };
          return ok(data, { source: "instantly:lead_stage", claim: `Skipped ${email}: contact already exists elsewhere in Instantly; choose a fresh ReeVIQ contact`, detail: data });
        }

        // New contact: use the official bulk-add endpoint. ReeVIQ already verified this email, so do not
        // spawn Instantly's asynchronous verification job.
        const lead = {
          email,
          first_name: String(args.first_name || "").trim() || undefined,
          last_name: String(args.last_name || "").trim() || undefined,
          company_name: String(args.company_name || "").trim() || undefined,
          website: String(args.website || "").trim() || undefined,
          personalization: String(args.personalization || "").trim() || undefined
        };
        Object.keys(lead).forEach((key) => lead[key] === undefined && delete lead[key]);
        const addResponse = await fetchImpl(`${base}/leads/add`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            campaign_id: campaignId,
            leads: [lead],
            verify_leads_on_import: false,
            skip_if_in_workspace: true,
            skip_if_in_campaign: true,
            skip_if_in_list: false
          }),
          signal: AbortSignal.timeout(15_000)
        });
        const addResult = await parseJson(addResponse);
        if (!addResponse.ok) return fail(`Instantly bulk-add returned HTTP ${addResponse.status}: ${String(addResult?.message || addResult?.error || addResult?.raw || "").slice(0,300)}`, addResponse.status >= 500 || addResponse.status === 429);

        const created = Array.isArray(addResult?.created_leads)
          ? addResult.created_leads.find((item) => String(item?.email || "").trim().toLowerCase() === email) || addResult.created_leads[0]
          : null;
        const uploaded = Number(addResult?.leads_uploaded || 0);
        if (uploaded !== 1 || !created?.id) {
          const summary = {
            status: addResult?.status || null,
            totalSent: addResult?.total_sent ?? null,
            uploaded,
            skipped: addResult?.skipped_count ?? null,
            duplicated: addResult?.duplicated_leads ?? null,
            invalid: addResult?.invalid_email_count ?? null,
            blocklisted: addResult?.in_blocklist ?? null
          };
          return fail(`Instantly did not create ${email} in the target campaign: ${JSON.stringify(summary)}`);
        }

        const verified = await verifyTarget(created.id);
        if (!verified) return fail(`Instantly reported ${email} uploaded as lead ${created.id}, but exact target verification failed; do not stage another lead until reconciled`, true);
        const data = {
          accepted: true,
          verified: true,
          email,
          campaignId,
          leadId: verified.id || created.id,
          campaignStatusAtStage: status,
          path: "bulk_add_verified",
          uploadSummary: {
            totalSent: addResult?.total_sent ?? 1,
            uploaded,
            skipped: addResult?.skipped_count ?? 0,
            invalid: addResult?.invalid_email_count ?? 0,
            blocklisted: addResult?.in_blocklist ?? 0
          }
        };
        return ok(data, { source: "instantly:lead_stage", claim: `Verified ${email} staged in inactive Instantly campaign ${campaignId} via official bulk-add`, detail: data });
      } catch (error) {
        return fail(`Instantly lead staging failed: ${error.message}`, true);
      } finally {
        instantlyStageBusy = false;
      }
    }
    if (name === "instantly_received_emails") {
      if (!config.instantlyApiKey) return fail("Instantly API key is not configured");
      const limit = Math.max(1, Math.min(50, Number(args.limit || 20)));
      const qs = new URLSearchParams({ email_type: "received", limit: String(limit), latest_of_thread: "true" });
      if (args.unread_only !== false) qs.set("is_unread", "true");
      if (args.campaign_id) qs.set("campaign_id", String(args.campaign_id));
      try {
        const response = await fetchImpl(`${config.instantlyBaseUrl.replace(/\/$/, "")}/emails?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(12_000)
        });
        if (!response.ok) return fail(`Instantly received-email read returned HTTP ${response.status}`, response.status >= 500 || response.status === 429);
        const body = await response.json();
        const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : [];
        const emails = items.slice(0,limit).map((email)=>({
          id: email?.id || null,
          threadId: email?.thread_id || email?.threadId || null,
          from: email?.from_address_email || email?.from_address || email?.from || null,
          to: email?.to_address_email_list || email?.to_address || null,
          subject: email?.subject || null,
          timestamp: email?.timestamp_email || email?.timestamp_created || email?.created_at || null,
          isUnread: email?.is_unread ?? null,
          campaignId: email?.campaign_id || email?.campaign || null,
          eaccount: email?.eaccount || email?.email_account || null,
          preview: String(email?.body?.text || email?.text || email?.body?.html || email?.html || "").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,700)
        }));
        return ok({ count: emails.length, emails }, { source: "instantly:received_emails", claim: `Read ${emails.length} recent received Instantly email(s)`, detail: { count: emails.length, sample: emails.slice(0,5) } });
      } catch (error) {
        return fail(`Instantly received-email read failed: ${error.message}`, true);
      }
    }
    if (name === "instantly_unread_count") {
      if (!config.instantlyApiKey) return fail("Instantly API key is not configured");
      try {
        const url = `${config.instantlyBaseUrl.replace(/\/$/, "")}/emails/unread/count`;
        const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.instantlyApiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return fail(`Instantly returned HTTP ${response.status}`, response.status >= 500);
        const body = await response.json();
        const unreadCount = body.count ?? body.unread_count ?? body.unreadCount ?? body;
        return ok({ unreadCount }, { source: "instantly:unread", claim: "Read Instantly unread reply count", detail: { unreadCount } });
      } catch (error) { return fail(`Instantly unread read failed: ${error.message}`, true); }
    }
    if (name === "reeviq_lead") {
      if (!config.reeviqBaseUrl) return fail("ReeVIQ base URL is not configured");
      if (!config.reeviqApiKeys?.length) return fail("ReeVIQ API key is not configured");
      const leadId = String(args.lead_id || "").trim();
      if (!leadId) return fail("ReeVIQ lead ID is required");
      const url = `${String(config.reeviqBaseUrl).replace(/\/$/, "")}/v1/xipherx-lead/fetch`;
      try {
        for (const key of config.reeviqApiKeys) {
          const expectedEmail = String(args.expected_email || "").trim().toLowerCase();
          const expectedName = String(args.expected_name || "").trim();
          const requestBody = expectedEmail
            ? { searchKey: expectedEmail, limit: 10, page: 1 }
            : expectedName
              ? { searchKey: expectedName, limit: 10, page: 1 }
              : { filter: { id: leadId }, limit: 10, page: 1 };
          const response = await fetchImpl(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(12_000),
          });
          if ((response.status === 401 || response.status === 403) && key !== config.reeviqApiKeys.at(-1)) continue;
          if (!response.ok) return fail(`ReeVIQ returned HTTP ${response.status}`, response.status >= 500);
          const body = await response.json();
          const data = body?.data ?? body;
          const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.leads) ? data.leads : Array.isArray(data?.results) ? data.results : Array.isArray(body?.items) ? body.items : [];
          const normalized = items.map((item) => item?.lead ?? item).filter(Boolean);
          const lead = normalized.find((item) => String(item?.id || "") === leadId)
            || (expectedEmail ? normalized.find((item) => String(item?.email || "").trim().toLowerCase() === expectedEmail) : null)
            || normalized[0];
          if (!lead) return fail(`ReeVIQ lead ${leadId} was not found`);
          const receipt = { id: lead?.id || leadId, status: lead?.status || null, firstName: lead?.firstName || null, lastName: lead?.lastName || null, email: lead?.email || null, phone: lead?.phone || null, companyName: lead?.companyName || null, jobTitle: lead?.jobTitle || null, industry: lead?.industry || null, location: lead?.location || null, website: lead?.website || null, emailVerified: lead?.emailVerified ?? null, phoneVerified: lead?.phoneVerified ?? null };
          if (String(receipt.id) !== leadId) return fail(`ReeVIQ identity mismatch: requested ${leadId}, received ${receipt.id}`);
          if (expectedEmail && String(receipt.email || "").trim().toLowerCase() !== expectedEmail) return fail(`ReeVIQ identity mismatch for ${leadId}: email does not match expected record`);
          const expectedNameLower = expectedName.toLowerCase();
          const actualName = `${receipt.firstName || ""} ${receipt.lastName || ""}`.trim().toLowerCase();
          if (expectedNameLower && actualName !== expectedNameLower) return fail(`ReeVIQ identity mismatch for ${leadId}: name does not match expected record`);
          return ok(receipt, { source: "reeviq:lead", claim: `Verified ReeVIQ lead identity ${receipt.id} via ${expectedEmail ? "email search" : expectedName ? "name search" : "ID filter"}`, detail: receipt });
        }
        return fail("ReeVIQ authorization failed");
      } catch (error) { return fail(`ReeVIQ read failed: ${error.message}`, true); }
    }
    if (name === "schedule_followup") {
      if (context.isFollowup) {
        return fail("This is the scheduled follow-up. Reassess now, then complete with evidence or report the exact blocker; do not schedule the same follow-up again.");
      }
      const seconds = Math.max(15, Math.min(86400, Number(args.seconds || 0)));
      const dueAt = new Date(Date.now() + seconds * 1000).toISOString();
      const row = store.scheduleFollowup(context.taskId, { dueAt, reason: String(args.reason || "Reassess objective") });
      return ok(row);
    }
    if (name === "complete_task") {
      const evidenceCount = store.getEvidence(context.taskId).length;
      if (context.requiresEvidence && evidenceCount === 0) return fail("Completion rejected: this action has no verification evidence");
      if (store.hasPendingFollowup(context.taskId)) return fail("Completion rejected: an automatic follow-up is still pending");
      const openItems = store.openWorkItems(context.taskId);
      if (openItems.length) return fail(`Completion rejected: ${openItems.length} planned work item(s) are still open`);
      store.setTaskStatus(context.taskId, "completed", { summary: args.summary });
      return ok({ status: "completed", summary: args.summary });
    }
    if (name === "report_blocker") {
      store.setTaskStatus(context.taskId, "blocked", { blocker: args.blocker });
      return ok({ status: "blocked", blocker: args.blocker });
    }
    return fail(`Unknown tool: ${name}`);
  }

  const revenueTools = new Set(["reeviq_leads", "reeviq_lead", "instantly_campaign", "instantly_campaign_leads", "instantly_create_fresh_pilot", "instantly_preflight", "instantly_activate_campaign", "instantly_pause_campaign", "instantly_repair_cody_route", "instantly_workspace_presence", "instantly_stage_lead", "instantly_received_emails", "instantly_unread_count"]);
  const roleDefinitions = definitions.filter((tool) => {
    if (tool.name === "upsert_operating_item" && config.role !== "cyrus") return false;
    if (revenueTools.has(tool.name) && config.role !== "malik") return false;
    return true;
  });
  return { definitions: roleDefinitions, execute };
}
