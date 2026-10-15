import { createHash } from 'node:crypto';

// Record the blocked action independently of its terminal task. Resolution
// notifications are always deferred, never recursive bot-to-bot execution.
export async function recordAndRouteBlocker({ store, config, taskId, blocker, args, agentDispatcher, fetchImpl }) {
  const role = config.role;
  const category = ['software','access','decision','external'].includes(args.category) ? args.category : 'external';
  const source = String(store.getTask(taskId)?.requester_id || '').replace(/^agent:/, '');
  const target = role !== 'cyrus' ? 'cyrus' : category === 'software' && source !== 'kenji' ? 'kenji' : null;
  const id = 'issue-' + createHash('sha256').update(role + ':' + blocker.toLowerCase().replace(/\s+/g,' ').trim()).digest('hex').slice(0,32);
  const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0,1000) : fallback;
  const nextAction = text(args.next_action, 'Inspect the exact dependency and available tools; choose a permitted recovery or independent revenue action.');
  const attempted = text(args.attempted, 'No recovery attempt supplied; inspect task receipts before claiming an attempt.');
  const alternative = text(args.alternative, 'Continue the highest-value authorized prospect, offer, funnel or delivery work that does not require this dependency.');
  const owner = target || 'cyrus';
  const item = store.upsertOperatingItem({ id, title: 'Resolve dependency: ' + blocker.slice(0,180), owner, status:'blocked', priority:1,
    nextAction, evidenceSummary: JSON.stringify({category,originRole:role,originTaskId:taskId,attempted,alternative}), sourceTaskId:taskId });
  let routing = { status:'tracked', owner };
  if (target) {
    const message = `RESOLVE DEPENDENCY ${id}. Origin: ${role}. Category: ${category}. Blocked action: ${blocker}\nRecovery supplied by origin (verify against receipts): ${attempted}\nNext action: ${nextAction}\nIndependent revenue path: ${alternative}\nOwn the issue and persist the resolution plan. Inspect connected evidence/tools and route concrete diagnostics to the right executive through Cyrus. Do not re-delegate the same issue back to its origin without a new executable action. A missing credential remains an exact access dependency; do not invent access or retry it repeatedly. Keep independent revenue work moving. No new spend, external messages or production changes are authorized by this notification. Record resolution only with evidence; queue acceptance is not a fix.`;
    const handoff = { id, from:role, to:target, message, mode:'task', defer:true };
    try {
      let result;
      if (agentDispatcher?.has(target)) result = await agentDispatcher.dispatch(handoff);
      else if (config.agentPeers?.[target]) {
        const response = await fetchImpl(`${config.agentPeers[target]}/handoff`, {method:'POST',headers:{'content-type':'application/json','x-atlasium-source':role},body:JSON.stringify(handoff),signal:AbortSignal.timeout(15_000)});
        result = await response.json();
        if (!response.ok) throw Error(result.error || `Handoff HTTP ${response.status}`);
      } else throw Error(`Resolution owner ${target} has no connected handoff route`);
      if (!result?.ok) throw Error(result?.error || 'Resolution handoff not accepted');
      routing = { status:result.queued ? 'queued' : result.status, owner, taskId:result.taskId, issueResolved:false };
    } catch(error) {
      routing = {status:'delivery_failed',owner,error:String(error.message).slice(0,300),issueResolved:false};
      store.upsertOperatingItem({id,title:item.title,owner,status:'blocked',priority:1,nextAction:`Restore the resolution handoff route, then: ${nextAction}`,evidenceSummary:JSON.stringify({category,attempted,alternative,routing}),sourceTaskId:taskId});
    }
  }
  return { issueId:id, owner, nextAction, alternative, routing, issueResolved:false };
}
