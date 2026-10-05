import __fs from "node:fs";
import __path from "node:path";
import __crypto from "node:crypto";
import __http from "node:http";

const __m_roles = (() => {
  const ROLE_KEYS = Object.freeze(["clara","cyrus","malik","amara","mateo","kenji","nadia"]);
  
  const shared = [
    "Use available context before asking routine questions.",
    "Do not invent facts, prices, links, status, activity or completion.",
    "Do not claim completion without evidence.",
    "Execute safe work inside your lane instead of narrating capability.",
    "Route cross-department work to the correct specialist.",
    "Keep wording concise, direct and human. Do not use em dash characters.",
    "Company north star: booked meetings, proposals advanced, collected revenue and recurring revenue. Every department must remove friction from those outcomes.",
    "Priority order when work competes: live buyer/reply, booked meeting, proposal/deal, payment, verified outbound opportunity, pipeline support, internal housekeeping.",
    "Revenue loop: Find -> Engage -> Qualify -> Assess -> Trial -> Book -> Sell -> Follow Up -> Recover -> Measure -> Repeat.",
    "Do not stop at acknowledgements, queued work, or promises. A task is complete only when evidence proves the intended outcome or a genuine blocker is recorded.",
    "When work stalls, retry, re-sequence, or reassign inside authorization before escalating.",
    "Operate as a nonstop execution company: continuously seek the next revenue-producing move, execute it, verify it, and keep going. Do not wait for permission on routine authorized work.",
    "Safe read tools include read_channel, reeviq_leads, reeviq_lead, instantly_campaign and instantly_unread_count. Use verified receipts as evidence before claiming pipeline movement.",
    "You have live web research through your OpenAI model. Use it for factual, technical, product, vendor, troubleshooting, documentation and current-world questions before asking Blair.",
    "Escalate only human judgment, legal/compliance, financial commitments, sensitive relationship decisions, irreversible actions or missing authorization. Lack of general knowledge is not a Blair blocker until you have researched it."
  ].join("\n");
  
  const roles = Object.freeze({
    clara: { key:"clara", name:"Clara", title:"Executive Assistant", iconEmoji:":spiral_calendar_pad:", channelIds:[], allowedChannelIds:["C08JFCZ597Y"], mission:"Own executive coordination, training continuity, grouped approvals and concise Blair-facing escalation." },
    cyrus: { key:"cyrus", name:"Cyrus", title:"Relentless Engine | Chief of Staff", iconEmoji:":compass:", channelIds:["C08JFCZ597Y","C0C6JGFKESG"], mission:"Run Atlasium as a ruthless, nonstop, money-first operating engine. Continuously identify the highest-value authorized action, dispatch the right specialist, verify proof of work, follow up, retry, re-sequence or reassign stalled work, and immediately take the next executable revenue action. Keep the revenue loop moving until there is a verified result, a genuine blocker, or a required executive approval. Do not confuse acknowledgement, queued work, waiting, or activity with completion." },
    malik: { key:"malik", name:"Malik", title:"Sales & Business Development", iconEmoji:":chart_with_upwards_trend:", channelIds:["C0C0RGGN147","C0A5WULQD8D","C0C199X6JAV"], mission:"Own lead research, qualification, approved outreach support, follow-up, pipeline hygiene and meeting preparation. Cody owns live discovery, demos, proposals, negotiation and closing." },
    amara: { key:"amara", name:"Amara", title:"Client Success, Onboarding & Delivery", iconEmoji:":seedling:", channelIds:["C0C0YJC1FPY","C0C10P0ADFV","C0C16US3BLJ","C0BJRSNCDTP"], mission:"Own post-sale onboarding, delivery readiness, support triage, blocker tracking and clean client handoffs." },
    mateo: { key:"mateo", name:"Mateo", title:"Marketing & Content", iconEmoji:":art:", channelIds:["C0C21JELXQ8","C0AN9FTRAPJ"], mission:"Own content planning, drafting, repurposing, campaign readiness, claim verification and marketing KPI diagnosis." },
    kenji: { key:"kenji", name:"Kenji", title:"Product & Development", iconEmoji:":hammer_and_wrench:", channelIds:["C0A9FLBQTHU","C08SFM1GMGU","C08U6JQP478","C0BNM4JEKA5"], mission:"Own issue triage, requirements, test plans, QA evidence, integration diagnosis and deployment-readiness. Zee owns live code/integration/deployment execution." },
    nadia: { key:"nadia", name:"Nadia", title:"Finance & Administration", iconEmoji:":abacus:", channelIds:["C0C12DDBK45","C0BTXN66894","C08R88UDRSN"], mission:"Own invoice/payment-status review, cash metrics, reconciliation preparation, anomaly detection and finance/admin evidence." }
  });
  
  const byChannel = new Map();
  for (const role of Object.values(roles)) for (const channelId of role.channelIds) byChannel.set(channelId, role);
  
  function roleForChannel(channelId) { return byChannel.get(channelId) || null; }
  function instructionsFor(role) { return `${role.name} - ${role.title}\n\n${role.mission}\n${shared}`; }
  return { ROLE_KEYS, roles, roleForChannel, instructionsFor };
})();

const __m_training = (() => {
  const order = ["step1","step2","step3","step4","products","certified"];
  const BASELINE = Object.freeze({
    U0ANZD41188:"step4", U0ASABNH0GG:"step4", U0C19NS010A:"step3", U0BRXJ0JT1P:"step2",
    U0BG1QGS3H7:"step2", U08S0HJ19BK:"step1", U0A60BDPZ50:"step1", U0C1WPVMKRS:"reconcile"
  });
  const rank=s=>order.indexOf(s);
  function inferFromHistory(history=[]) {
    const text=history.map(x=>x.text||"").join("\n").toLowerCase();
    if (/products ready|product training complete/.test(text)) return "products";
    if (/demo complete/.test(text)) return "step4";
    if (/reply ready|\bready\b/.test(text)) return "step3";
    if (/revenue consultant/.test(text)) return "step2";
    if (/\bstart\b/.test(text)) return "step1";
    return null;
  }
  function reconcileTraining(userId, history=[], persisted={}) {
    const base=BASELINE[userId] || null, hist=inferFromHistory(history), saved=persisted[userId] || null;
    if (base === "reconcile" && !hist && !saved) return "reconcile";
    const candidates=[base,hist,saved].filter(s=>rank(s)>=0);
    return candidates.sort((a,b)=>rank(b)-rank(a))[0] || "reconcile";
  }
  function trainingResponse(userId, message, history, persisted={}) {
    const stage=reconcileTraining(userId,history,persisted); const t=String(message||"").trim();
    if (/^help\b/i.test(t)) return {stage,advanced:false,text:"Tell me what part is unclear and I will help with only that step."};
    if(stage==="reconcile") return {stage,advanced:false,text:"I am reconciling your training so you do not restart anything. What is the last step you completed, and what completion reply did you send?"};
    if(stage==="step1" && /^start$/i.test(t)) return {stage:"step2",advanced:true,text:"Step 2: What Atlasium Does. Atlasium identifies where businesses lose time, money, revenue and opportunity, then installs systems to improve it. Reply in one sentence explaining the job of an Atlasium Revenue Consultant."};
    if(stage==="step2" && t.length>=20) return {stage:"step3",advanced:true,text:"Step 3: Your Role. Your first responsibility is learning how to create opportunities using Atlasium training, scripts, technology and support. Reply READY to continue."};
    if(stage==="step3" && /^ready$/i.test(t)) return {stage:"step4",advanced:true,text:"Step 4: Full Atlasium Demo. Watch the assigned full-platform demo. Then reply DEMO COMPLETE and describe one business problem Atlasium can help solve."};
    if(stage==="step4" && /demo complete/i.test(t) && t.replace(/demo complete/i,"").trim().length>=8) return {stage:"products",advanced:true,text:"Step 5: Product Training. Reply PRODUCTS READY and I will send the first product module only."};
    if(stage==="products" && /products ready/i.test(t)) return {stage:"products",advanced:false,text:"Products ready. Continue with one assigned product module at a time. I will not skip ahead."};
    if(stage==="certified") return null;
    return {stage,advanced:false,text:`You are continuing at ${stage}. Complete only the current step. HELP is always allowed.`};
  }
  return { BASELINE, inferFromHistory, reconcileTraining, trainingResponse };
})();

const __m_evidence = (() => {
  const crypto = __crypto;
  function evidenceId(source, payload) { return `ev_${crypto.createHash("sha256").update(source+JSON.stringify(payload)).digest("hex").slice(0,16)}`; }
  function wrapEvidence(source, items=[]) { return items.map(item=>({ id:evidenceId(source,item), source, payload:item, trusted:false })); }
  function validateEvidenceRefs(refs=[], available=[]) { const set=new Set(available.map(x=>x.id)); return refs.every(x=>set.has(x)); }
  return { evidenceId, wrapEvidence, validateEvidenceRefs };
})();

const __m_policy = (() => {
  const destructive = /\b(delete|erase|purge)\b.{0,40}\b(record|lead|account|file|campaign|data)\b/i;
  const money = /\b(spend|buy|purchase|pay|refund|transfer|charge)\b/i;
  const pricing = /\b(non[- ]standard|custom|special|override)\b.{0,25}\b(price|pricing|discount)\b|\bdiscount\b/i;
  const legal = /\b(sign|execute|accept|agree to)\b.{0,30}\b(contract|legal|regulatory|regulated)\b/i;
  const deploy = /\b(deploy|release|publish|go live|push)\b.{0,30}\b(production|prod|live)\b|\bpush to production\b/i;
  const billing = /\b(enroll|subscribe|activate paid|start billing)\b/i;
  const irreversible = /\birreversible exception\b/i;
  const reviewPrefix = /\b(review|analy[sz]e|assess|plan|prepare|draft|check|explain|inspect|test|simulate|audit)\b/i;
  
  function classifyApproval(text = "") {
    const t = String(text);
    if (reviewPrefix.test(t) && !/\b(do it|execute now|apply now|run live|actually deploy|actually refund|actually charge)\b/i.test(t)) {
      return { required:false, reason:null };
    }
    const checks = [
      [money,"financial_commitment"],[pricing,"nonstandard_pricing"],[legal,"legal_commitment"],
      [destructive,"destructive_action"],[deploy,"production_deploy"],[billing,"paid_enrollment"],[irreversible,"irreversible_exception"]
    ];
    for (const [re, reason] of checks) if (re.test(t)) return { required:true, reason };
    return { required:false, reason:null };
  }
  
  const ack = /^(ok(ay)?|thanks?|thank you|got it|done|perfect|great|cool|sounds good|👍|✅)[.!\s]*$/i;
  function shouldHandle(event, botUserId, proactive=false) {
    if (!event?.channel || !event?.text) return false;
    if (event.subtype || event.bot_id || event.user === botUserId) return false;
    const clean = String(event.text).replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!clean || ack.test(clean)) return false;
    const dm = event.channel_type === "im" || String(event.channel).startsWith("D");
    const mention = event.type === "app_mention" || (botUserId && event.text.includes(`<@${botUserId}>`));
    return dm || mention || proactive;
  }
  return { classifyApproval, shouldHandle };
})();

const __m_specialist_playbooks = (() => {
  const PLAYBOOKS = Object.freeze({
    clara:{checks:["preserve training state","group human approvals","avoid duplicate reminders","verify completion before advancement"],risky:["training completion","human approval"]},
    cyrus:{checks:["revenue impact first","correct specialist owner","dependency order","company priority","evidence freshness","open-task follow-up","retry or reassign stalled work","verified outcome before completion"],risky:["cross-department completion","revenue result","cash received","meeting booked"]},
    malik:{checks:["duplicate lead","consent and opt-out","contactability","pipeline evidence","standard approved offer"],risky:["contact sent","meeting booked","proposal sent","won","cash received"]},
    amara:{checks:["sale evidence","onboarding prerequisites","delivery receipt","client commitment"],risky:["activated","delivered","client success outcome"]},
    mateo:{checks:["claim source","approved message","channel approval","performance evidence"],risky:["published","campaign performance","guarantee"]},
    kenji:{checks:["source changed","tests passed","build produced","deployed","health checked","live behavior verified"],risky:["deployed","live","fixed in production"]},
    nadia:{checks:["invoice source","payment reference","amount match","transaction dedupe"],risky:["paid","cash received","refund completed","balance settled"]}
  });
  
  const riskyPatterns={
    malik:/\b(sent|booked|proposal sent|won|closed won|cash received)\b/i,
    amara:/\b(activated|delivered|implemented|client is live|successful onboarding)\b/i,
    mateo:/\b(published|posted live|campaign generated|guaranteed|guarantee)\b/i,
    kenji:/\b(deployed|live in production|fixed in production|production is healthy)\b/i,
    nadia:/\b(paid|payment received|cash received|refund completed|settled)\b/i,
    clara:/\b(completed training|certified|approved by)\b/i,
    cyrus:/\b(completed by|finished by|all departments complete)\b/i
  };
  function validateSpecialistDecision(roleKey,decision,evidence=[]){
    const pattern=riskyPatterns[roleKey]; if(!pattern||!pattern.test(decision?.text||"")) return {ok:true};
    if(!Array.isArray(decision.evidenceRefs)||decision.evidenceRefs.length===0) return {ok:false,reason:"risky_claim_without_evidence"};
    const ids=new Set(evidence.map(e=>e.id)); if(decision.evidenceRefs.some(id=>!ids.has(id))) return {ok:false,reason:"risky_claim_invented_evidence"};
    return {ok:true};
  }
  return { PLAYBOOKS, validateSpecialistDecision };
})();

const __m_startup_parallel = (() => {
  async function parallelByRole(roleKeys, worker) {
    if (!Array.isArray(roleKeys) || roleKeys.length === 0) return [];
    return Promise.all(roleKeys.map(async (key) => [key, await worker(key)]));
  }
  
  function toRoleMap(entries) {
    return Object.fromEntries(entries || []);
  }
  return { parallelByRole, toRoleMap };
})();

const __m_action_executor = (() => {
  const crypto = __crypto;
  const ALLOWED=new Set(["read_channel","reeviq_leads","reeviq_lead","instantly_campaign","instantly_unread_count","internal_dm","internal_channel_post"]);
  const READ_ONLY=new Set(["read_channel","reeviq_leads","reeviq_lead","instantly_campaign","instantly_unread_count"]);
  class ActionExecutor {
    constructor({slackByRole,state,roles,config,fetchImpl=fetch}) { this.slackByRole=slackByRole; this.state=state; this.roles=roles; this.config=config; this.fetchImpl=fetchImpl; }
    id(action,roleKey){ return action.idempotencyKey || crypto.createHash("sha256").update(JSON.stringify([roleKey,action])).digest("hex"); }
    async execute(roleKey, action, {shadow=false}={}) {
      if(!ALLOWED.has(action.type)) return {ok:false,status:"blocked_capability"};
      if(this.config.postingCanaryUserId && !READ_ONLY.has(action.type)) return {ok:true,status:"canary_side_effect_shadowed"};
      if(action.type==="read_channel") {
        const channel=action.channel; const known=Object.values(this.roles).some(r=>r.channelIds.includes(channel));
        if(!known) return {ok:false,status:"unknown_internal_channel"};
        const owner=Object.values(this.roles).find(r=>r.channelIds.includes(channel));
        if(roleKey!=="cyrus" && owner?.key!==roleKey) return {ok:false,status:"read_scope_denied"};
        try { const messages=await this.slackByRole[roleKey].recentContext(channel, action.threadTs); return {ok:true,status:"read_confirmed",receipt:{channel,messages}}; }
        catch(e){ return {ok:false,status:"read_failed",error:e.message}; }
      }
      if(action.type==="reeviq_leads" || action.type==="reeviq_lead") {
        const keys=(this.config.reeviqApiKeys||[]).filter(Boolean);
        if(!this.config.reeviqBaseUrl) return {ok:false,status:"reeviq_base_missing"};
        if(!keys.length) return {ok:false,status:"reeviq_key_missing"};
        const base=String(this.config.reeviqBaseUrl).replace(/\/$/,"");
        let url;
        if(action.type==="reeviq_leads") {
          const limit=Math.max(1,Math.min(100,Number(action.limit||25)));
          const status=String(action.status||"NEW").trim();
          const qs=new URLSearchParams({limit:String(limit)});
          if(status) qs.set("status",status);
          url=`${base}/v1/xipherx-lead/assigned?${qs.toString()}`;
        } else {
          const leadId=String(action.leadId||action.id||"").trim();
          if(!leadId) return {ok:false,status:"reeviq_lead_id_missing"};
          url=`${base}/v1/xipherx-lead/${encodeURIComponent(leadId)}`;
        }
        let lastStatus=0;
        try {
          for(const key of keys) {
            const res=await this.fetchImpl(url,{headers:{Authorization:`Bearer ${key}`,Accept:"application/json"},signal:AbortSignal.timeout(12000)});
            lastStatus=res.status;
            if((res.status===401||res.status===403) && key!==keys.at(-1)) continue;
            if(!res.ok) return {ok:false,status:`reeviq_http_${res.status}`};
            const body=await res.json();
            const data=body?.data ?? body;
            if(action.type==="reeviq_lead") {
              const lead=data?.lead ?? data?.item ?? data;
              const receipt={lead:{
                id:lead?.id||null,status:lead?.status||null,firstName:lead?.firstName||null,lastName:lead?.lastName||null,
                email:lead?.email||null,phone:lead?.phone||null,companyName:lead?.companyName||null,jobTitle:lead?.jobTitle||null,
                industry:lead?.industry||null,location:lead?.location||null,website:lead?.website||null,provider:lead?.provider||null,
                emailVerified:lead?.emailVerified??null,phoneVerified:lead?.phoneVerified??null,decisionMakerReached:lead?.decisionMakerReached??null
              },qualification:data?.qualification||null,upcomingMeeting:data?.upcomingMeeting||null,campaignCount:Array.isArray(data?.campaigns)?data.campaigns.length:null};
              return {ok:true,status:"reeviq_lead_read",receipt};
            }
            const items = Array.isArray(data) ? data :
              Array.isArray(data?.items) ? data.items :
              Array.isArray(data?.leads) ? data.leads :
              Array.isArray(data?.results) ? data.results :
              Array.isArray(body?.items) ? body.items : [];
            const total=body?.total ?? data?.total ?? data?.pagination?.total ?? body?.pagination?.total ?? null;
            const leads=items.slice(0,100).map(x=>{
              const lead=x?.lead ?? x;
              return {id:lead?.id||null,status:lead?.status||x?.status||null,firstName:lead?.firstName||null,lastName:lead?.lastName||null,
                email:lead?.email||null,phone:lead?.phone||null,companyName:lead?.companyName||null,jobTitle:lead?.jobTitle||null,
                industry:lead?.industry||null,location:lead?.location||null,provider:lead?.provider||null,
                emailVerified:lead?.emailVerified??null,phoneVerified:lead?.phoneVerified??null};
            });
            return {ok:true,status:"reeviq_leads_read",receipt:{total,count:leads.length,leads}};
          }
          return {ok:false,status:`reeviq_http_${lastStatus||"auth_failed"}`};
        } catch(e){ return {ok:false,status:"reeviq_read_failed",error:e.message}; }
      }
      if(action.type==="instantly_campaign" || action.type==="instantly_unread_count") {
        if(!this.config.instantlyApiKey) return {ok:false,status:"instantly_key_missing"};
        const base=String(this.config.instantlyBaseUrl||"https://api.instantly.ai/api/v2").replace(/\/$/,"");
        let url;
        if(action.type==="instantly_campaign") {
          const campaignId=String(action.campaignId||this.config.instantlyCampaignId||"").trim();
          if(!campaignId) return {ok:false,status:"instantly_campaign_missing"};
          url=`${base}/campaigns/${encodeURIComponent(campaignId)}`;
        } else {
          url=`${base}/emails/unread/count`;
        }
        try {
          const res=await this.fetchImpl(url,{headers:{Authorization:`Bearer ${this.config.instantlyApiKey}`,Accept:"application/json"},signal:AbortSignal.timeout(10000)});
          if(!res.ok) return {ok:false,status:`instantly_http_${res.status}`};
          const body=await res.json();
          if(action.type==="instantly_campaign") {
            const receipt={id:body.id||null,name:body.name||null,status:body.status??null,dailyLimit:body.daily_limit??body.dailyLimit??null,emailListCount:body.email_list_count??body.emailListCount??null,stopOnReply:body.stop_on_reply??body.stopOnReply??null};
            return {ok:true,status:"instantly_campaign_read",receipt};
          }
          return {ok:true,status:"instantly_unread_read",receipt:{unreadCount:body.count??body.unread_count??body.unreadCount??body}};
        } catch(e){ return {ok:false,status:"instantly_read_failed",error:e.message}; }
      }
      const id=this.id(action,roleKey); const prior=this.state.actionStatus(id);
      if(prior?.status==="confirmed") return {ok:true,status:"duplicate_suppressed",receipt:prior.receipt};
      if(prior?.status==="unknown") return {ok:false,status:"reconciliation_required"};
      if(shadow) return {ok:true,status:"shadow_dry_run",id};
      const slack=this.slackByRole[roleKey]; if(!slack) return {ok:false,status:"missing_role_client"};
      try {
        let out;
        if(action.type==="internal_dm") {
          if(!action.userId || [this.config.blairUserId,this.config.zeeUserId].includes(action.userId)) return {ok:false,status:"proactive_exec_dm_blocked"};
          const ch=await slack.openDm(action.userId); out=await slack.post({channel:ch,text:action.text});
        } else {
          const owner=Object.values(this.roles).find(r=>r.channelIds.includes(action.channel));
          if(!owner || owner.key!==roleKey) return {ok:false,status:"channel_owner_mismatch"};
          out=await slack.post({channel:action.channel,text:action.text});
        }
        const receipt={ts:out.ts,channel:out.channel||action.channel||null}; this.state.setAction(id,{status:"confirmed",receipt});
        return {ok:true,status:"confirmed",receipt};
      } catch(e) {
        this.state.setAction(id,{status:"unknown",error:e.message}); this.state.setUnknown(id,{roleKey,actionType:action.type});
        return {ok:false,status:"unknown",error:e.message};
      }
    }
  }
  return { ActionExecutor };
})();

const __m_slack_api = (() => {
  class SlackApiError extends Error {
    constructor(method, error, details={}) { super(`Slack ${method} failed: ${error}`); this.method=method; this.slackError=error; this.details=details; }
  }
  
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  
  class SlackApi {
    constructor(token, fetchImpl=fetch) { this.token=token; this.fetch=fetchImpl; }
    async call(method, body={}, { readOnly=false }={}) {
      const attempts = readOnly ? 3 : 1;
      let last;
      for (let i=0;i<attempts;i++) {
        try {
          const res = await this.fetch(`https://slack.com/api/${method}`, { method:"POST", headers:{ Authorization:`Bearer ${this.token}`, "Content-Type":"application/json; charset=utf-8" }, body:JSON.stringify(body) });
          if (!res.ok) throw new SlackApiError(method, `http_${res.status}`);
          const data = await res.json();
          if (!data.ok) throw new SlackApiError(method, data.error || "unknown_error", data);
          return data;
        } catch (e) { last=e; if (!readOnly || i===attempts-1) throw e; await sleep(100*(2**i)); }
      }
      throw last;
    }
    authTest() { return this.call("auth.test", {}, {readOnly:true}); }
    async recentContext(channel, threadTs) {
      const method = threadTs ? "conversations.replies" : "conversations.history";
      const payload = threadTs ? {channel, ts:threadTs, limit:20, inclusive:true} : {channel, limit:20};
      const data = await this.call(method,payload,{readOnly:true});
      let msgs=(data.messages||[]).filter(m=>m.text).map(m=>({ts:m.ts,user:m.user||m.bot_id||"unknown",text:String(m.text).slice(0,4000)}));
      if (!threadTs) msgs=msgs.reverse();
      return msgs.slice(-20);
    }
    async openDm(userId) { const d=await this.call("conversations.open",{users:userId},{readOnly:true}); return d.channel.id; }
    post({channel,text,threadTs}) { return this.call("chat.postMessage",{channel,text,thread_ts:threadTs||undefined,unfurl_links:false,unfurl_media:false}); }
  }
  return { SlackApiError, SlackApi };
})();

const __m_socket_mode = (() => {
  async function openSocketUrl(appToken, fetchImpl=fetch) {
    const r=await fetchImpl("https://slack.com/api/apps.connections.open",{method:"POST",headers:{Authorization:`Bearer ${appToken}`}});
    if(!r.ok) throw new Error(`socket_open_http_${r.status}`); const d=await r.json(); if(!d.ok||!d.url) throw new Error(`socket_open_${d.error||"missing_url"}`); return d.url;
  }
  class SocketModeRunner {
    constructor({appToken,controller,WebSocketImpl=globalThis.WebSocket,fetchImpl=fetch,logger=console,onState=()=>{}}){Object.assign(this,{appToken,controller,WebSocketImpl,fetchImpl,logger,onState});this.socket=null;this.stopped=false;}
    async start(){ if(!this.WebSocketImpl) throw new Error("WebSocket unavailable"); const url=await openSocketUrl(this.appToken,this.fetchImpl); const s=new this.WebSocketImpl(url); this.socket=s;
      s.addEventListener("open",()=>{this.onState(true);this.logger.info?.({event:"socket_connected",role:this.controller?.role?.key||"unknown"});});
      s.addEventListener("message",e=>this.onMessage(e).catch(err=>this.logger.error?.({event:"socket_message_error",role:this.controller?.role?.key||"unknown",error:err.message})));
      s.addEventListener("close",()=>{this.onState(false);this.logger.info?.({event:"socket_closed",role:this.controller?.role?.key||"unknown",stopped:this.stopped});if(!this.stopped) setTimeout(()=>this.start().catch(err=>this.logger.error?.({event:"socket_reconnect_error",role:this.controller?.role?.key||"unknown",error:err.message})),1000);});
      s.addEventListener("error",()=>{this.onState(false);this.logger.error?.({event:"socket_error",role:this.controller?.role?.key||"unknown"});});
    }
    async onMessage(raw){ const env=JSON.parse(raw.data); if(env.envelope_id) this.socket.send(JSON.stringify({envelope_id:env.envelope_id})); if(env.type!=="events_api"||!env.payload?.event)return; const ev=env.payload.event; if(String(ev.channel||"")==="D0C1RPLP7NY"){ this.logger.info?.({event:"cyrus_dm_event_shape",role:this.controller?.role?.key||"unknown",type:ev.type||null,subtype:ev.subtype||null,user:ev.user||null,botId:ev.bot_id||null,appId:ev.app_id||null}); } await this.controller.handleEvent(ev,env.payload.event_id); }
    stop(){this.stopped=true;this.socket?.close(1000,"shutdown");}
  }
  return { SocketModeRunner, openSocketUrl };
})();

const __m_dispatcher = (() => {
  class Dispatcher {
    constructor(state) { this.controllers=new Map(); this.state=state; }
    register(key,controller){ this.controllers.set(key,controller); }
    async dispatch({taskId,from,to,message,evidence=[]}) {
      const prior=this.state.getTask(taskId);
      if(prior?.status==="completed") return {status:"duplicate_completed",task:prior};
      if(prior?.status==="running") return {status:"duplicate_running",task:prior};
      const target=this.controllers.get(to);
      if(!target){ this.state.createTask(taskId,{from,to,message,status:"blocked",blocker:"missing_target"}); return {status:"missing_target"}; }
      const task=this.state.createTask(taskId,{from,to,message,status:"queued"});
      this.state.updateTask(taskId,{status:"running",attempts:(task.attempts||0)+1,lastAttemptAt:Date.now()});
      try {
        const out=await target.handleInternal({taskId,from,message,evidence});
        const terminal=/^(executed|respond_posted|respond_prepared|training_posted|training_prepared|no_reply)$/.test(String(out?.status||""));
        this.state.updateTask(taskId,{status:terminal?"completed":"needs_followup",resultStatus:out?.status||"unknown",result:out});
        return out;
      } catch(e) {
        this.state.updateTask(taskId,{status:"needs_followup",lastError:e.message});
        throw e;
      }
    }
  }
  return { Dispatcher };
})();

const __m_runtime_control = (() => {
  const fs = __fs;
  const path = __path;
  
  const ALLOWED = new Set(["postingEnabled","shadowMode","postingCanaryUserId","proactiveEnabled"]);
  function normalize(input={}){
    const out={};
    for(const [k,v] of Object.entries(input||{})){
      if(!ALLOWED.has(k))continue;
      if(k==="postingCanaryUserId") out[k]=String(v||"");
      else out[k]=Boolean(v);
    }
    return out;
  }
  class RuntimeControl {
    constructor({filePath,config,proactive=null,logger=console,pollMs=100}){Object.assign(this,{filePath,config,proactive,logger,pollMs});this.timer=null;this.lastSignature=null;}
    read(){try{return normalize(JSON.parse(fs.readFileSync(this.filePath,"utf8")));}catch(e){if(e.code==="ENOENT")return null;throw e;}}
    apply(next){if(!next)return false;const before=this.config.proactiveEnabled;Object.assign(this.config,next);if(this.proactive){if(this.config.proactiveEnabled&&!before)this.proactive.start();if(!this.config.proactiveEnabled&&before)this.proactive.stop();}return true;}
    refresh(){try{const st=fs.statSync(this.filePath);const sig=`${st.mtimeMs}:${st.size}`;if(sig===this.lastSignature)return false;const next=this.read();this.apply(next);this.lastSignature=sig;return true;}catch(e){if(e.code==="ENOENT"){this.lastSignature=null;return false;}this.logger.error?.({event:"runtime_control_refresh_failed",error:e.message});return false;}}
    start(){this.refresh();if(this.timer)return;this.timer=setInterval(()=>this.refresh(),this.pollMs);this.timer.unref?.();}
    stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  }
  function safeControl(){return{postingEnabled:false,shadowMode:true,postingCanaryUserId:"",proactiveEnabled:false};}
  function writeControlAtomic(filePath,value){fs.mkdirSync(path.dirname(filePath),{recursive:true});const tmp=`${filePath}.tmp-${process.pid}`;fs.writeFileSync(tmp,JSON.stringify(normalize(value),null,2),{mode:0o600});fs.renameSync(tmp,filePath);}
  return { RuntimeControl, safeControl, writeControlAtomic };
})();

const __m_state_store = (() => {
  const fs = __fs;
  const path = __path;
  const crypto = __crypto;
  
  const initial = () => ({ version:2, events:{}, actions:{}, tasks:{}, training:{}, proactive:{}, engine:{lastTickAt:null,lastResult:null}, unknownEffects:{}, updatedAt:null });
  
  class StateStore {
    constructor(filePath,{remoteUrl="",remoteToken="",fetchImpl=fetch,remoteRetries=8,logger=console}={}) {
      this.filePath=filePath; this.state=initial(); this.remoteUrl=String(remoteUrl||"").replace(/\/$/,""); this.remoteToken=String(remoteToken||""); this.fetchImpl=fetchImpl; this.remoteRetries=remoteRetries; this.logger=logger; this.remoteSaveChain=Promise.resolve(); this.remoteReady=!this.remoteUrl; this.remoteLastError=null; this.remoteLastSavedAt=null; this.remoteLastLoadedAt=null;
    }
    async load() {
      try { this.state = { ...initial(), ...JSON.parse(fs.readFileSync(this.filePath, "utf8")) }; } catch (e) { if (e.code !== "ENOENT") throw e; }
      if(!this.remoteUrl) return this.state;
      if(!this.remoteToken) throw new Error("CYRUS_STATE_TOKEN is required when CYRUS_STATE_URL is configured");
      let lastError=null;
      for(let attempt=1;attempt<=this.remoteRetries;attempt++){
        try{
          const res=await this.fetchImpl(this.remoteUrl,{headers:{"x-cyrus-state-token":this.remoteToken,"accept":"application/json"},signal:AbortSignal.timeout(10000)});
          if(res.status===404){ this.remoteReady=true; this.remoteLastLoadedAt=new Date().toISOString(); return this.state; }
          if(!res.ok) throw new Error(`remote state load failed (${res.status})`);
          const body=await res.json();
          if(body?.state && typeof body.state==="object" && !Array.isArray(body.state)) this.state={...initial(),...body.state};
          this.remoteReady=true; this.remoteLastError=null; this.remoteLastLoadedAt=new Date().toISOString();
          this.writeLocal();
          return this.state;
        }catch(e){ lastError=e; this.remoteLastError=e.message; if(attempt<this.remoteRetries) await new Promise(r=>setTimeout(r,Math.min(3000,500*attempt))); }
      }
      throw new Error(`Durable Cyrus state unavailable: ${lastError?.message||"unknown error"}`);
    }
    writeLocal(){
      fs.mkdirSync(path.dirname(this.filePath), { recursive:true, mode:0o700 });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode:0o600 });
      fs.renameSync(tmp, this.filePath);
      try { fs.chmodSync(this.filePath, 0o600); } catch {}
    }
    save() {
      this.state.updatedAt = new Date().toISOString();
      this.writeLocal();
      if(!this.remoteUrl) return;
      const snapshot=JSON.parse(JSON.stringify(this.state));
      this.remoteSaveChain=this.remoteSaveChain.then(async()=>{
        const res=await this.fetchImpl(this.remoteUrl,{method:"PUT",headers:{"x-cyrus-state-token":this.remoteToken,"content-type":"application/json","accept":"application/json"},body:JSON.stringify({state:snapshot}),signal:AbortSignal.timeout(10000)});
        if(!res.ok) throw new Error(`remote state save failed (${res.status})`);
        this.remoteReady=true; this.remoteLastError=null; this.remoteLastSavedAt=new Date().toISOString();
      }).catch(e=>{this.remoteReady=false;this.remoteLastError=e.message;this.logger.error?.({event:"remote_state_save_failed",error:e.message});throw e;});
    }
    async flush(){ if(this.remoteUrl) await this.remoteSaveChain; }
    seenEvent(id) { return Boolean(id && this.state.events[id]); }
    markEvent(id) { if (id) { this.state.events[id] = Date.now(); this.prune(this.state.events); this.save(); } }
    actionStatus(id) { return this.state.actions[id] || null; }
    setAction(id, status) { this.state.actions[id] = { ...status, at:Date.now() }; this.prune(this.state.actions, 5000); this.save(); }
    setUnknown(id, record) { this.state.unknownEffects[id] = { ...record, at:Date.now() }; this.save(); }
    resolveUnknown(id) { delete this.state.unknownEffects[id]; this.save(); }
    unknownCount() { return Object.keys(this.state.unknownEffects).length; }
    getTask(id) { return this.state.tasks[id] || null; }
    createTask(id, record={}) { if(!this.state.tasks[id]) this.state.tasks[id]={ id, status:"queued", attempts:0, createdAt:Date.now(), updatedAt:Date.now(), ...record }; this.save(); return this.state.tasks[id]; }
    updateTask(id, patch={}) { const prev=this.state.tasks[id]||this.createTask(id); this.state.tasks[id]={...prev,...patch,updatedAt:Date.now()}; this.save(); return this.state.tasks[id]; }
    openTasks() { return Object.values(this.state.tasks).filter(t=>!["completed","cancelled"].includes(t.status)); }
    openTaskCount() { return this.openTasks().length; }
    fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
    prune(obj, max=10000) { const keys=Object.keys(obj); if(keys.length<=max) return; keys.sort((a,b)=>(obj[a]?.at||obj[a]||0)-(obj[b]?.at||obj[b]||0)); for(const k of keys.slice(0, keys.length-max)) delete obj[k]; }
  }
  return { StateStore };
})();

const __m_health = (() => {
  const http = __http;
  function buildHealth(state,config,store){
    const bots=Object.fromEntries(Object.entries(state.bots).map(([k,v])=>[k,{slackAuthenticated:Boolean(v.slackAuthenticated),socketConnected:Boolean(v.socketConnected)}]));
    const all=Object.values(bots);
    const allAuthenticated=all.length===7&&all.every(x=>x.slackAuthenticated);
    const socketBots=Object.entries(bots).filter(([key])=>!["cyrus","malik"].includes(key)).map(([,value])=>value);
    const allSockets=socketBots.length===5&&socketBots.every(x=>x.socketConnected);
    const activationState=state.activationState||"active";
    return {
      ok:(allAuthenticated&&allSockets) || (config.prewarmMode&&allAuthenticated&&activationState==="prewarmed"),
      version:"5.4.0",
      slackMode:"individual",
      postingEnabled:config.postingEnabled,
      shadowMode:config.shadowMode,
      proactiveEnabled:Boolean(config.proactiveEnabled),
      postingCanaryUserId:config.postingCanaryUserId||"",
      prewarmMode:Boolean(config.prewarmMode),
      prewarmed:allAuthenticated&&!allSockets&&activationState==="prewarmed",
      readyForActivation:allAuthenticated&&activationState==="prewarmed",
      activationState,
      botCount:all.length,
      bots,
      unknownEffectCount:store.unknownCount(),
      openTaskCount:store.openTaskCount(),
      relentlessEngine:{ enabled:Boolean(config.proactiveEnabled), lastTickAt:store.state.engine?.lastTickAt||null, lastResult:store.state.engine?.lastResult||null },
      persistence:{ remoteConfigured:Boolean(store.remoteUrl), remoteReady:Boolean(store.remoteReady), lastLoadedAt:store.remoteLastLoadedAt||null, lastSavedAt:store.remoteLastSavedAt||null, lastError:store.remoteLastError||null },
      draining:Boolean(state.draining),
      activeWork:state.activeWork||0
    };
  }
  function startHealthServer({port,state,config,store}){ const server=http.createServer((req,res)=>{if(req.url!=="/health"){res.writeHead(404);return res.end("not found");}res.setHeader("content-type","application/json");res.end(JSON.stringify(buildHealth(state,config,store)));}); server.listen(port); return server; }
  return { buildHealth, startHealthServer };
})();

const __m_model_client = (() => {
  const { instructionsFor } = __m_roles;
  
  const DECISIONS=new Set(["RESPOND","NO_REPLY","ROUTE","APPROVAL_REQUIRED"]);
  const DECISION_ALIASES=Object.freeze({REPLY:"RESPOND",ANSWER:"RESPOND",SILENT:"NO_REPLY",IGNORE:"NO_REPLY",DELEGATE:"ROUTE",DISPATCH:"ROUTE",APPROVAL:"APPROVAL_REQUIRED",REQUIRES_APPROVAL:"APPROVAL_REQUIRED"});
  function parseJsonText(text) {
    let clean=String(text||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/```$/," ").trim();
    let obj;
    try { obj=JSON.parse(clean); }
    catch {
      const start=clean.indexOf("{"); const end=clean.lastIndexOf("}");
      if(start<0||end<=start) throw new Error("invalid_model_json");
      try { obj=JSON.parse(clean.slice(start,end+1)); } catch { throw new Error("invalid_model_json"); }
    }
    if(!obj || typeof obj!=="object" || Array.isArray(obj)) throw new Error("invalid_model_json");
    const actions=Array.isArray(obj.actions)?obj.actions:[];
    const routeTo=obj.routeTo||obj.route_to||obj.target||null;
    const approvalRequired=obj.approvalRequired===true || obj.approval_required===true;
    let rawDecision=String(obj.decision||obj.action||obj.type||"").trim().toUpperCase().replace(/[ -]+/g,"_");
    let decision=DECISION_ALIASES[rawDecision]||rawDecision;
    if(!DECISIONS.has(decision)){
      if(routeTo) decision="ROUTE";
      else if(approvalRequired) decision="APPROVAL_REQUIRED";
      else if(actions.length || String(obj.text||obj.response||obj.message||"").trim()) decision="RESPOND";
      else decision="NO_REPLY";
    }
    if(actions.length && decision!=="RESPOND") decision="RESPOND";
    return {
      decision,
      text:String(obj.text||obj.response||obj.message||""),
      routeTo,
      evidenceRefs:Array.isArray(obj.evidenceRefs)?obj.evidenceRefs:(Array.isArray(obj.evidence_refs)?obj.evidence_refs:[]),
      actions
    };
  }
  
  class ModelClient {
    constructor(config, fetchImpl=fetch) { this.config=config; this.fetch=fetchImpl; this.active=0; this.calls=[]; }
    async decide({role,message,evidence=[]}) {
      if(this.config.aiProvider==="none") return {decision:"NO_REPLY",text:"",routeTo:null,evidenceRefs:[],actions:[]};
      const now=Date.now(); this.calls=this.calls.filter(t=>t>now-3600000);
      if(this.calls.length>=this.config.modelHourlyLimit) throw new Error("model_hourly_limit");
      if(this.active>=this.config.modelConcurrency) throw new Error("model_concurrency_limit");
      this.active++; this.calls.push(now);
      try {
        if(this.config.aiProvider==="openai") return await this.openAi({role,message,evidence});
        return await this.xipherx({role,message,evidence});
      } finally { this.active--; }
    }
    async openAi({role,message,evidence}) {
      const input={ message, evidence:evidence.map(e=>({id:e.id,source:e.source,payload:e.payload})) };
      const res=await this.fetch(`${this.config.openAiBaseUrl.replace(/\/$/,"")}/responses`,{method:"POST",headers:{Authorization:`Bearer ${this.config.openAiApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:this.config.openAiModel,instructions:instructionsFor(role)+"\nReturn strict JSON: {decision,text,routeTo,evidenceRefs,actions}. Evidence refs must come from supplied IDs.",input:JSON.stringify(input),tools:[{type:"web_search"}],tool_choice:"auto"})});
      if(!res.ok) throw new Error(`openai_http_${res.status}`); const d=await res.json();
      let text=d.output_text; if(!text){ text=(d.output||[]).flatMap(x=>x.content||[]).map(c=>c.text||c.output_text||"").join(""); }
      return parseJsonText(text);
    }
    async xipherx({role,message,evidence}) {
      if(!this.config.xipherxUrl) throw new Error("xipherx_url_missing");
      const res=await this.fetch(this.config.xipherxUrl,{method:"POST",headers:{Authorization:`Bearer ${this.config.xipherxToken}`,"Content-Type":"application/json"},body:JSON.stringify({instructions:instructionsFor(role),message,evidence})});
      if(!res.ok) throw new Error(`xipherx_http_${res.status}`); const d=await res.json(); return parseJsonText(d.output||d.text||JSON.stringify(d));
    }
  }
  return { ModelClient, parseJsonText };
})();

const __m_proactive_loop = (() => {
  const { wrapEvidence } = __m_evidence;
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  class ProactiveLoop {
    constructor({controllers,slackByRole,state,roles,config,executor,dispatcher,trainingMaintenance=null,intervalMs=null,logger=console}){
      Object.assign(this,{controllers,slackByRole,state,roles,config,executor,dispatcher,trainingMaintenance,logger});
      this.intervalMs=Number(intervalMs||config.relentlessIntervalMs||300000);
      this.retryCooldownMs=Number(config.relentlessRetryCooldownMs||900000);
      this.timer=null; this.running=false;
    }
    isCanaryTask(task){
      return /canary|probe|test/i.test(String(task?.kind||"")) || /canary|probe|test/i.test(String(task?.id||""));
    }
    async collectRevenueEvidence(results){
      const evidence=[];
      const reads=[
        ["reeviq_new_inventory",{type:"reeviq_leads",limit:100,status:"NEW"}],
        ["instantly_campaign",{type:"instantly_campaign"}],
        ["instantly_unread",{type:"instantly_unread_count"}]
      ];
      for(const [label,action] of reads){
        try{
          const out=await this.executor.execute("cyrus",action,{shadow:false});
          results.push({key:"cyrus",channel:label,status:out.status,ok:Boolean(out.ok)});
          if(out.ok&&out.receipt) evidence.push(...wrapEvidence(label,out.receipt));
        }catch(e){
          results.push({key:"cyrus",channel:label,status:"error",error:e.message});
        }
      }
      return evidence;
    }
    async retryStalled(open,results){
      const now=Date.now();
      const candidates=open.filter(t=>{
        if(this.isCanaryTask(t)) return false;
        if(!["needs_followup","blocked"].includes(String(t.status||""))) return false;
        if((t.attempts||0)>=5) return false;
        if(t.lastAttemptAt && now-t.lastAttemptAt<this.retryCooldownMs) return false;
        const target=t.to||t.owner;
        return Boolean(target&&this.controllers[target]&&t.message);
      }).slice(0,5);
      for(const t of candidates){
        try{
          const target=t.to||t.owner;
          const out=await this.dispatcher.dispatch({taskId:t.id,from:t.from||"cyrus",to:target,message:t.message,evidence:[]});
          results.push({key:"cyrus",channel:"retry",taskId:t.id,target,status:out?.status||"unknown"});
        }catch(e){
          results.push({key:"cyrus",channel:"retry",taskId:t.id,status:"error",error:e.message});
        }
      }
      return candidates.length;
    }
    async tick(){
      if(!this.config.proactiveEnabled||this.running) return {status:"disabled_or_running"};
      this.running=true;
      const results=[];
      const startedAt=Date.now();
      this.logger.info?.({event:"relentless_engine_tick_start",intervalMs:this.intervalMs});
      try{
        const cyrusEvidence=[];

        // Money signals first. No department scan is allowed to delay the revenue decision.
        cyrusEvidence.push(...await this.collectRevenueEvidence(results));

        const open=this.state.openTasks().filter(t=>!this.isCanaryTask(t));
        cyrusEvidence.push(...wrapEvidence("persistent_open_tasks",open));
        const retried=await this.retryStalled(open,results);

        const engineTaskId=`relentless:${Math.floor(Date.now()/this.intervalMs)}`;
        const engineMessage=[
          "RELENTLESS REVENUE ENGINE TICK.",
          "Money first. Do not wait.",
          "Use live ReeVIQ inventory, Instantly campaign/reply signals and unfinished tasks supplied here.",
          "Choose the single highest-value authorized next move and execute or route it now.",
          "If something stalled, retry, re-sequence or reassign it.",
          "Do not stop at research, acknowledgement, queued work, waiting, or a blocker another available route can bypass.",
          "Keep Find -> Engage -> Qualify -> Assess -> Trial -> Book -> Sell -> Follow Up -> Recover -> Measure -> Repeat moving.",
          "External financial, legal, destructive, nonstandard-pricing and irreversible commitments still require approval.",
          "A task is complete only with verified evidence."
        ].join(" ");
        const engineOut=await this.controllers.cyrus.reason({
          message:engineMessage,
          evidence:cyrusEvidence.slice(-220),
          internal:true,
          taskId:engineTaskId
        });

        this.state.state.engine={
          lastTickAt:Date.now(),
          lastResult:engineOut?.status||"unknown",
          lastTaskId:engineTaskId,
          retryCount:retried,
          evidenceCount:cyrusEvidence.length,
          durationMs:Date.now()-startedAt,
          nextTickAt:Date.now()+this.intervalMs
        };
        this.state.save(); await this.state.flush();
        results.push({key:"cyrus",channel:"engine",status:engineOut?.status||"unknown",taskId:engineTaskId});

        if(this.trainingMaintenance){
          const t=await this.trainingMaintenance.tick();
          results.push(...t.map(x=>({key:"clara",channel:"training",status:x.status,type:x.type,userId:x.userId})));
        }
        this.logger.info?.({
          event:"relentless_engine_tick",
          taskId:engineTaskId,
          status:engineOut?.status||"unknown",
          evidenceCount:cyrusEvidence.length,
          retried,
          durationMs:Date.now()-startedAt,
          nextTickMs:this.intervalMs
        });
        return {status:"ok",results};
      }catch(e){
        this.logger.error?.({event:"relentless_engine_tick_failed",error:e.message,durationMs:Date.now()-startedAt});
        throw e;
      }finally{this.running=false;}
    }
    start(){
      if(!this.config.proactiveEnabled||this.timer)return;
      this.logger.info?.({event:"relentless_engine_started",intervalMs:this.intervalMs,retryCooldownMs:this.retryCooldownMs});
      this.tick().catch(e=>this.logger.error?.({event:"proactive_tick_error",error:e.message}));
      this.timer=setInterval(()=>this.tick().catch(e=>this.logger.error?.({event:"proactive_tick_error",error:e.message})),this.intervalMs);
      this.timer.unref?.();
    }
    stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  }
  return { ProactiveLoop };
})();

const __m_training_maintenance = (() => {
  const { BASELINE, reconcileTraining } = __m_training;
  class TrainingMaintenance {
    constructor({state,executor,directorMap={},now=()=>Date.now()}){this.state=state;this.executor=executor;this.directorMap=directorMap;this.now=now;if(!this.state.state.trainingActivity)this.state.state.trainingActivity={};}
    touch(userId){const prev=this.state.state.trainingActivity[userId]||{};this.state.state.trainingActivity[userId]={...prev,lastActivityAt:this.now(),reminder24At:null,escalated48At:null};this.state.save();}
    async tick(){const out=[];const now=this.now();for(const userId of Object.keys(BASELINE)){const stage=reconcileTraining(userId,[],this.state.state.training);if(stage==="certified")continue;const a=this.state.state.trainingActivity[userId];if(!a?.lastActivityAt)continue;const age=now-a.lastActivityAt;
        if(age>=24*3600000 && !a.reminder24At){const r=await this.executor.execute("clara",{type:"internal_dm",userId,text:"Training reminder: continue from your current verified step when ready. Reply HELP if you are blocked.",idempotencyKey:`training24:${userId}:${a.lastActivityAt}`},{shadow:false});if(r.ok){a.reminder24At=now;this.state.save();}out.push({userId,type:"24h",status:r.status});}
        if(age>=48*3600000 && !a.escalated48At){const director=this.directorMap[userId];if(!director){out.push({userId,type:"48h",status:"director_mapping_missing"});continue;}const r=await this.executor.execute("clara",{type:"internal_dm",userId:director,text:`Training escalation: ${userId} has been inactive for more than 48 hours at ${stage}.`,idempotencyKey:`training48:${userId}:${a.lastActivityAt}`},{shadow:false});if(r.ok){a.escalated48At=now;this.state.save();}out.push({userId,type:"48h",status:r.status});}
      }return out;}
  }
  return { TrainingMaintenance };
})();

const __m_config = (() => {
  const { ROLE_KEYS } = __m_roles;
  
  const truthy = new Set(["1","true","yes","on"]);
  const bool = (v, d=false) => v == null ? d : truthy.has(String(v).toLowerCase());
  const json = (v,d={}) => { try { return v ? JSON.parse(v) : d; } catch { throw new Error("Invalid JSON configuration"); } };
  
  function loadConfig(env = process.env) {
    const aiProvider = (env.AI_PROVIDER || "none").toLowerCase();
    if (!new Set(["none","openai","xipherx"]).has(aiProvider)) throw new Error("AI_PROVIDER must be none, openai, or xipherx");
    const identities = {};
    for (const key of ROLE_KEYS) {
      const p = key.toUpperCase();
      identities[key] = { botToken: env[`${p}_SLACK_BOT_TOKEN`] || "", appToken: env[`${p}_SLACK_APP_TOKEN`] || "" };
    }
    const slackMode = env.SLACK_MODE || "individual";
    if (slackMode !== "individual") throw new Error("v5 runtime requires SLACK_MODE=individual");
    const missing = ROLE_KEYS.filter(k => !identities[k].botToken || !identities[k].appToken);
    if (missing.length) throw new Error(`Missing Slack bot/app tokens for: ${missing.join(", ")}`);
    const postingEnabled = bool(env.SLACK_POSTING_ENABLED, false);
    if (postingEnabled && aiProvider === "none") throw new Error("Posting cannot be enabled while AI_PROVIDER=none");
    if (aiProvider === "openai" && (!env.OPENAI_API_KEY || !env.OPENAI_MODEL)) throw new Error("AI_PROVIDER=openai requires OPENAI_API_KEY and OPENAI_MODEL");
    return {
      slackMode, identities, postingEnabled,
      shadowMode: bool(env.SWARM_SHADOW_MODE, true),
      proactiveEnabled: bool(env.PROACTIVE_MONITORING_ENABLED, false),
      prewarmMode: bool(env.SWARM_PREWARM_MODE, false),
      activationFile: env.SWARM_ACTIVATION_FILE || "/data/activate-v5",
      activationPollMs: Math.max(50, Number(env.SWARM_ACTIVATION_POLL_MS || 100)),
      controlFile: env.SWARM_CONTROL_FILE || "/data/control.json",
      controlPollMs: Math.max(50, Number(env.SWARM_CONTROL_POLL_MS || 100)),
      port: Number(env.PORT || 3000),
      statePath: env.SWARM_STATE_PATH || "/opt/atlasium-ai-staff-v5/state/runtime-state.json",
      stateRemoteUrl: env.CYRUS_STATE_URL || "",
      stateRemoteToken: env.CYRUS_STATE_TOKEN || "",
      stateRemoteRetries: Math.max(1, Number(env.CYRUS_STATE_RETRIES || 8)),
      aiProvider,
      openAiApiKey: env.OPENAI_API_KEY || "",
      openAiModel: env.OPENAI_MODEL || "",
      openAiBaseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      xipherxUrl: env.XIPHERX_AI_URL || "",
      xipherxToken: env.XIPHERX_AI_TOKEN || "",
      instantlyApiKey: env.INSTANTLY_API_KEY || "",
      instantlyBaseUrl: env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2",
      instantlyCampaignId: env.INSTANTLY_CAMPAIGN_ID || "",
      reeviqBaseUrl: env.REEVIQ_BASE_URL || "",
      reeviqApiKeys: [env.REEVIQ_API_KEY || "", env.REEVIQ_WRITE_API_KEY || ""].filter((v,i,a)=>v&&a.indexOf(v)===i),
      modelHourlyLimit: Number(env.SWARM_MODEL_HOURLY_LIMIT || 500),
      modelConcurrency: Number(env.SWARM_MODEL_CONCURRENCY || 4),
      relentlessIntervalMs: Math.max(120000, Number(env.CYRUS_RELENTLESS_INTERVAL_MS || 300000)),
      relentlessRetryCooldownMs: Math.max(300000, Number(env.CYRUS_RELENTLESS_RETRY_COOLDOWN_MS || 900000)),
      blairUserId: env.BLAIR_SLACK_USER_ID || "U08H6V60U4R",
      zeeUserId: env.ZEE_SLACK_USER_ID || "U0BG1QGS3H7",
      postingCanaryUserId: env.SWARM_POSTING_CANARY_USER_ID || "",
      trainingDirectorMap: json(env.TRAINING_DIRECTOR_MAP_JSON, {})
    };
  }
  return { loadConfig };
})();

const __m_controller = (() => {
  const { roleForChannel, roles } = __m_roles;
  const { classifyApproval, shouldHandle } = __m_policy;
  const { trainingResponse, reconcileTraining, BASELINE } = __m_training;
  const { wrapEvidence, validateEvidenceRefs } = __m_evidence;
  const { validateSpecialistDecision } = __m_specialist_playbooks;
  
  class StaffController {
    constructor({role,slack,model,state,executor,dispatcher,config,trainingMaintenance=null,logger=console}) { Object.assign(this,{role,slack,model,state,executor,dispatcher,config,trainingMaintenance,logger}); this.botUserId=null; }
    async initialize(){ const a=await this.slack.authTest(); this.botUserId=a.user_id; return {teamId:a.team_id,botUserId:a.user_id}; }
    async handleInternal({taskId,from,message,evidence=[]}) { return this.reason({message:`Internal task from ${from}: ${message}`, evidence, internal:true, taskId}); }
    async handleEvent(event,eventId) {
      const key=eventId || event.client_msg_id || `${event.channel}:${event.ts}:${event.user||""}`;
      if(this.state.seenEvent(key)) return {status:"duplicate"};
      this.state.markEvent(key);
      if(!shouldHandle(event,this.botUserId,this.config.proactiveEnabled)) return {status:"ignored"};
      const dm=event.channel_type==="im" || String(event.channel).startsWith("D");
      if(!dm){ const owner=roleForChannel(event.channel); if(owner && owner.key!==this.role.key) return {status:"wrong_role_channel"}; if(!owner && !this.role.allowedChannelIds?.includes(event.channel)) return {status:"unmapped_channel"}; }
      if(dm && !Object.hasOwn(BASELINE,event.user) && event.user!==this.config.blairUserId && event.user!==this.config.zeeUserId) return {status:"unknown_external_dm"};
      const context=await this.slack.recentContext(event.channel, dm?undefined:event.thread_ts);
      if(dm && this.role.key==="clara" && Object.hasOwn(BASELINE,event.user)) {
        this.trainingMaintenance?.touch(event.user);
        const current=reconcileTraining(event.user,context,this.state.state.training);
        if(current!=="certified") {
          const tr=trainingResponse(event.user,event.text,context,this.state.state.training);
          if(tr){ if(tr.advanced){ this.state.state.training[event.user]=tr.stage; this.state.save(); }
            return this.emit({text:tr.text,channel:event.channel,threadTs:undefined,statusPrefix:"training",requesterUserId:event.user}); }
        }
      }
      const evidence=wrapEvidence("slack_context",context);
      const approval=classifyApproval(event.text);
      if(approval.required) return this.emit({text:`${this.role.name}: approval required for ${approval.reason}. No live action was taken.`,channel:event.channel,threadTs:dm?undefined:event.thread_ts,statusPrefix:"approval",requesterUserId:event.user});
      return this.reason({message:event.text,evidence,channel:event.channel,threadTs:dm?undefined:event.thread_ts,requesterUserId:event.user});
    }
    async reason({message,evidence=[],channel=null,threadTs=undefined,internal=false,taskId=null,requesterUserId=null}) {
      let available=[...evidence];
      let d=await this.model.decide({role:this.role,message,evidence:available});
      if(!validateEvidenceRefs(d.evidenceRefs,available)) return {status:"blocked_invented_evidence"};
  
      const readActionTypes=new Set(["read_channel","reeviq_leads","reeviq_lead","instantly_campaign","instantly_unread_count"]);
      const readActions=(d.actions||[]).filter(a=>readActionTypes.has(a.type));
      if(readActions.length){
        const readReceipts=[];
        for(const action of readActions.slice(0,4)) readReceipts.push(await this.executor.execute(this.role.key,action,{shadow:false}));
        const successful=readReceipts.filter(r=>r.ok&&r.receipt).map(r=>r.receipt);
        available=available.concat(wrapEvidence("read_tool_receipt",successful));
        d=await this.model.decide({role:this.role,message:`${message}\n\nYou requested read tools. Verified read receipts are now supplied. Finalize the decision without repeating those reads.`,evidence:available});
        if(!validateEvidenceRefs(d.evidenceRefs,available)) return {status:"blocked_invented_evidence"};
        if((d.actions||[]).some(a=>readActionTypes.has(a.type))) return {status:"blocked_repeated_read_loop"};
      }
  
      const specialistGate=validateSpecialistDecision(this.role.key,d,available);
      if(!specialistGate.ok) return {status:"blocked_specialist_gate",reason:specialistGate.reason};
      if(d.decision==="NO_REPLY") return {status:"no_reply"};
      if(d.decision==="APPROVAL_REQUIRED") return channel?this.emit({text:d.text||`${this.role.name}: approval required.`,channel,threadTs,statusPrefix:"approval",requesterUserId}):{status:"approval_required",text:d.text};
      if(d.decision==="ROUTE") {
        if(!d.routeTo || !roles[d.routeTo]) return {status:"invalid_route"};
        if(!this.dispatcher) return {status:"dispatcher_unavailable"};
        return this.dispatcher.dispatch({taskId:taskId||`${this.role.key}:${Date.now()}`,from:this.role.key,to:d.routeTo,message:d.text||message,evidence:available});
      }
      const receipts=[];
      for(const action of (d.actions||[]).filter(a=>a.type!=="read_channel")) receipts.push(await this.executor.execute(this.role.key,action,{shadow:this.config.shadowMode || !this.config.postingEnabled}));
      if(channel && d.text) return this.emit({text:d.text,channel,threadTs,statusPrefix:"respond",receipts,requesterUserId});
      return {status:"executed",text:d.text,receipts};
    }
    async emit({text,channel,threadTs,statusPrefix,receipts=[],requesterUserId=null}) {
      if(this.config.postingCanaryUserId && requesterUserId!==this.config.postingCanaryUserId) return {status:`${statusPrefix}_canary_suppressed`,text,receipts};
      if(this.config.shadowMode || !this.config.postingEnabled) return {status:`${statusPrefix}_prepared`,text,receipts};
      const out=await this.slack.post({channel,text,threadTs}); return {status:`${statusPrefix}_posted`,ts:out.ts,receipts};
    }
  }
  return { StaffController };
})();

const __m_index = (() => {
  const fs = __fs;
  const { loadConfig } = __m_config;
  const { roles, ROLE_KEYS } = __m_roles;
  const { StateStore } = __m_state_store;
  const { SlackApi } = __m_slack_api;
  const { ModelClient } = __m_model_client;
  const { ActionExecutor } = __m_action_executor;
  const { Dispatcher } = __m_dispatcher;
  const { StaffController } = __m_controller;
  const { SocketModeRunner } = __m_socket_mode;
  const { startHealthServer } = __m_health;
  const { ProactiveLoop } = __m_proactive_loop;
  const { TrainingMaintenance } = __m_training_maintenance;
  const { parallelByRole } = __m_startup_parallel;
  const { RuntimeControl } = __m_runtime_control;
  
  async function bootstrap(env=process.env,{fetchImpl=fetch,WebSocketImpl=globalThis.WebSocket,logger=console}={}) {
    const config=loadConfig(env); const store=new StateStore(config.statePath,{remoteUrl:config.stateRemoteUrl,remoteToken:config.stateRemoteToken,fetchImpl,remoteRetries:config.stateRemoteRetries,logger}); await store.load();
    const persistenceProbeId=String(env.CYRUS_PERSISTENCE_PROBE_ID||"").trim();
    if(persistenceProbeId && !store.getTask(persistenceProbeId)) store.createTask(persistenceProbeId,{owner:"malik",status:"needs_followup",kind:"persistence_probe",marker:String(env.CYRUS_PERSISTENCE_PROBE_MARKER||persistenceProbeId)});
    store.save(); await store.flush();
    logger.info?.({event:"cyrus_persistence_ready",remoteConfigured:Boolean(store.remoteUrl),remoteReady:Boolean(store.remoteReady),openTaskCount:store.openTaskCount(),probePresent:Boolean(persistenceProbeId&&store.getTask(persistenceProbeId))});
    const model=new ModelClient(config,fetchImpl); const dispatcher=new Dispatcher(store);
    const slackByRole=Object.fromEntries(ROLE_KEYS.map(k=>[k,new SlackApi(config.identities[k].botToken,fetchImpl)]));
    const executor=new ActionExecutor({slackByRole,state:store,roles,config,fetchImpl}); const trainingMaintenance=new TrainingMaintenance({state:store,executor,directorMap:config.trainingDirectorMap});
    const state={bots:{},draining:false,activeWork:0,activationState:config.prewarmMode?"authenticating":"activating"}; const controllers={};
    for(const key of ROLE_KEYS){ const c=new StaffController({role:roles[key],slack:slackByRole[key],model,state:store,executor,dispatcher,config,trainingMaintenance:key==="clara"?trainingMaintenance:null,logger}); controllers[key]=c; dispatcher.register(key,c); state.bots[key]={slackAuthenticated:false,socketConnected:false}; }
    const authEntries=await parallelByRole(ROLE_KEYS,async key=>controllers[key].initialize());
    for(const [key,auth] of authEntries) state.bots[key].slackAuthenticated=Boolean(auth.botUserId);
    logger.info?.({event:"executive_socket_handoff",status:"disabled_in_shared_runtime",disabledSocketRoles:["cyrus","malik"],remainingSocketRoles:ROLE_KEYS.filter(key=>!["cyrus","malik"].includes(key))});
    if(!persistenceProbeId){
      for(const task of store.openTasks()) if(task.kind==="persistence_probe") store.state.tasks[task.id]={...task,status:"completed",resultStatus:"persistence_verified",updatedAt:Date.now()};
      store.save(); await store.flush();
    }
    const outreachId=String(env.CYRUS_OUTREACH_ID||"").trim();
    const outreachText=String(env.CYRUS_OUTREACH_TEXT||"").trim();
    if(outreachId && outreachText && !store.getTask(outreachId)){
      try {
        const targetChannel=String(env.CYRUS_OUTREACH_CHANNEL||"").trim() || await slackByRole.cyrus.openDm(config.blairUserId);
        const posted=await slackByRole.cyrus.post({channel:targetChannel,text:outreachText});
        store.createTask(outreachId,{kind:"cyrus_outreach",owner:"cyrus",status:"completed",resultStatus:"slack_message_sent",evidence:{channel:targetChannel,ts:posted?.ts||null}});
        await store.flush();
        logger.info?.({event:"cyrus_outreach_sent",taskId:outreachId,channel:targetChannel,ts:posted?.ts||null});
      } catch(error) {
        store.createTask(outreachId,{kind:"cyrus_outreach",owner:"cyrus",status:"needs_followup",resultStatus:"slack_dm_failed",lastError:error?.message||String(error)});
        await store.flush();
        logger.error?.({event:"cyrus_outreach_failed",taskId:outreachId,error:error?.message||String(error)});
      }
    }
    const internalCanaryId=String(env.CYRUS_INTERNAL_CANARY_ID||"").trim();
    if(internalCanaryId && !store.getTask(internalCanaryId)){
      try {
        const canaryResult=await dispatcher.dispatch({taskId:internalCanaryId,from:"cyrus",to:"malik",message:"Controlled internal canary. Inspect current sales-channel evidence using read tools. Identify one factual current revenue blocker or opportunity. Do not post, DM, contact prospects, launch campaigns, or change any external system. Return only evidence-grounded findings."});
        store.updateTask(internalCanaryId,{kind:"internal_canary",canaryResult});
        await store.flush();
        logger.info?.({event:"cyrus_internal_canary",taskId:internalCanaryId,status:canaryResult?.status||"unknown",persisted:Boolean(store.getTask(internalCanaryId))});
      } catch(error) {
        const prior=store.getTask(internalCanaryId)||{};
        store.updateTask(internalCanaryId,{...prior,kind:"internal_canary",status:"needs_followup",resultStatus:"canary_failed",lastError:error?.message||String(error)});
        await store.flush();
        logger.error?.({event:"cyrus_internal_canary_failed",taskId:internalCanaryId,error:error?.message||String(error),persisted:Boolean(store.getTask(internalCanaryId))});
      }
    }
    for(const task of store.openTasks()) {
      if(task.kind==="internal_canary" && task.id!==internalCanaryId) {
        store.updateTask(task.id,{status:"completed",resultStatus:"superseded_canary"});
      }
    }
    const malikQueueCanaryId=String(env.CYRUS_MALIK_QUEUE_CANARY_ID||"").trim();
    if(malikQueueCanaryId && !store.getTask(malikQueueCanaryId)) {
      store.createTask(malikQueueCanaryId,{kind:"malik_queue_canary",owner:"malik",status:"running"});
      try {
        const inv=await executor.execute("malik",{type:"reeviq_leads",limit:100,status:"NEW"});
        if(!inv.ok) throw new Error(inv.status||"reeviq_inventory_failed");
        const evidence=__m_evidence.wrapEvidence("reeviq_new_leads",inv.receipt?.leads||[]);
        const out=await controllers.malik.reason({
          message:"Build a verified internal top-10 sales queue from these ReeVIQ NEW leads only. Prefer service businesses and records with named contacts, decision-maker job-title evidence, verified email/phone, and usable company/contact data. Deduplicate within the supplied evidence by company, email and phone. Do not contact anyone, do not change CRM status, do not launch a campaign. Be explicit where decision-maker status is not verified. Return concise plain text with exactly 10 records if evidence supports 10, otherwise return the maximum defensible number and the blocker.",
          evidence,internal:true,taskId:malikQueueCanaryId
        });
        const ok=out?.status==="executed" && Boolean(out?.text);
        store.updateTask(malikQueueCanaryId,{status:ok?"completed":"needs_followup",resultStatus:ok?"malik_queue_verified":out?.status||"malik_queue_failed",result:out,evidenceCount:evidence.length});
        await store.flush();
        logger.info?.({event:"cyrus_malik_queue_canary",taskId:malikQueueCanaryId,ok,status:out?.status||"unknown",evidenceCount:evidence.length,textLength:String(out?.text||"").length});
      } catch(error) {
        store.updateTask(malikQueueCanaryId,{status:"needs_followup",resultStatus:"malik_queue_failed",lastError:error?.message||String(error)});
        await store.flush();
        logger.error?.({event:"cyrus_malik_queue_canary_failed",taskId:malikQueueCanaryId,error:error?.message||String(error)});
      }
    }
    const reeviqReadCanaryId=String(env.CYRUS_REEVIQ_READ_CANARY_ID||"").trim();
    if(reeviqReadCanaryId && !store.getTask(reeviqReadCanaryId)) {
      store.createTask(reeviqReadCanaryId,{kind:"reeviq_read_canary",owner:"malik",status:"running"});
      const inv=await executor.execute("malik",{type:"reeviq_leads",limit:25,status:"NEW"});
      const ok=Boolean(inv.ok);
      store.updateTask(reeviqReadCanaryId,{status:ok?"completed":"needs_followup",resultStatus:ok?"reeviq_read_verified":"reeviq_read_failed",evidence:inv.receipt||null,error:inv.error||(!inv.ok?inv.status:null)});
      await store.flush();
      logger.info?.({event:"cyrus_reeviq_read_canary",taskId:reeviqReadCanaryId,ok,status:inv.status,total:inv.receipt?.total??null,count:inv.receipt?.count??null,sampleCompanies:(inv.receipt?.leads||[]).slice(0,5).map(x=>x.companyName).filter(Boolean)});
    }
    const revenueReadCanaryId=String(env.CYRUS_REVENUE_READ_CANARY_ID||"").trim();
    if(revenueReadCanaryId && !store.getTask(revenueReadCanaryId)) {
      store.createTask(revenueReadCanaryId,{kind:"revenue_read_canary",owner:"malik",status:"running"});
      const campaign=await executor.execute("malik",{type:"instantly_campaign"});
      const unread=await executor.execute("malik",{type:"instantly_unread_count"});
      const ok=Boolean(campaign.ok&&unread.ok);
      store.updateTask(revenueReadCanaryId,{status:ok?"completed":"needs_followup",resultStatus:ok?"revenue_read_verified":"revenue_read_failed",evidence:{campaign:campaign.receipt||null,unread:unread.receipt||null},errors:[campaign.error||(!campaign.ok?campaign.status:null),unread.error||(!unread.ok?unread.status:null)].filter(Boolean)});
      await store.flush();
      logger.info?.({event:"cyrus_revenue_read_canary",taskId:revenueReadCanaryId,ok,campaignStatus:campaign.status,unreadStatus:unread.status,campaignName:campaign.receipt?.name||null,campaignState:campaign.receipt?.status??null,emailListCount:campaign.receipt?.emailListCount??null,unreadCount:unread.receipt?.unreadCount??null});
    }
    store.save(); await store.flush();
    const health=startHealthServer({port:config.port,state,config,store});
    const runners=[]; const proactive=new ProactiveLoop({controllers,slackByRole,state:store,roles,config,executor,dispatcher,trainingMaintenance,logger});
    const control=new RuntimeControl({filePath:config.controlFile,config,proactive,logger,pollMs:config.controlPollMs}); control.start();
    let activationTimer=null; let activating=null; let activated=false;
    const activate=async()=>{
      if(activated)return; if(activating)return activating;
      activating=(async()=>{
        state.activationState="activating";
        const runnerEntries=await parallelByRole(ROLE_KEYS.filter(key=>!["cyrus","malik"].includes(key)),async key=>{ const r=new SocketModeRunner({appToken:config.identities[key].appToken,controller:controllers[key],fetchImpl,WebSocketImpl,logger,onState:v=>{state.bots[key].socketConnected=v;}}); await r.start(); return r; });
        runners.push(...runnerEntries.map(([,runner])=>runner));
        proactive.start(); activated=true; state.activationState="active";
      })();
      try{await activating;}finally{activating=null;}
    };
    const activationPresent=()=>{try{return fs.existsSync(config.activationFile);}catch{return false;}};
    if(config.prewarmMode&&!activationPresent()){
      state.activationState="prewarmed";
      activationTimer=setInterval(()=>{if(activationPresent()){clearInterval(activationTimer);activationTimer=null;activate().catch(e=>{state.activationState="activation_failed";logger.error?.({event:"activation_failed",error:e.message});});}},config.activationPollMs);
      activationTimer.unref?.();
    } else await activate();
    const stop=async()=>{state.draining=true; if(activationTimer)clearInterval(activationTimer); control.stop(); proactive.stop(); for(const r of runners)r.stop(); store.save(); await store.flush(); await new Promise(resolve=>health.close(resolve));};
    return {config,store,state,controllers,runners,health,proactive,control,activate,stop};
  }
  
  return { bootstrap };
})();

export { __m_roles, __m_state_store, __m_dispatcher, __m_health, __m_model_client, __m_index };

if (process.env.SWARM_TEST_MODE !== "true") {
  __m_index.bootstrap().catch((e)=>{ console.error(JSON.stringify({event:"fatal",error:e?.message||String(e)})); process.exit(1); });
}
