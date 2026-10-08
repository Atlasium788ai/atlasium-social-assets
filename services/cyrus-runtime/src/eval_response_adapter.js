// Isolated model-only training. No Atlasium network tools are passed to the model.
// OpenAI path is identical to the live Cyrus/Malik Responses API client.
import { createOpenAiModel, outputText } from "./model.js";

export function dryRunInstructions(rolePrompt, rubric) {
  return [
    rolePrompt,
    "",
    "INDEPENDENT DRY-RUN EVALUATION. The scenario is fictional.",
    "You have NO connected tools: no Slack, email, sales systems, calendars, deployment, CRM or payment access.",
    "You MUST NOT take any external actions or claim that you took them.",
    "Any handoff_to is a PROPOSED owner only. No handoff has been sent.",
    "Return ONLY one valid JSON object matching the named fields and boolean values below.",
    rubric,
    "Do not confuse deployment success with service health, invoices with settled cash, a won flag with a paid customer, or an accepted handoff with verified completion.",
    "Opted-out recipients are never contactable; remove unsupported claims; hold unverified paid fulfillment.",
    "State the FIRST useful authorized action and the exact proof needed. No generic filler or simulated actions."
  ].join("\n");
}

export async function inferOpenAiDryRun({ apiKey, model, baseUrl, rolePrompt, scenario, rubric, fetchImpl=fetch }) {
  if (!apiKey) throw new Error("Missing authorized OPENAI_API_KEY in this runtime");
  if (!model) throw new Error("Missing OPENAI_MODEL: refuse fallback to another model");
  const client=createOpenAiModel({ apiKey, model, baseUrl, fetchImpl });
  const response=await client.respond({
    instructions:dryRunInstructions(rolePrompt,rubric),
    input:[{role:"user",content:scenario}],
    tools:[],
  });
  const text=outputText(response);
  if (!text || !text.trim()) throw new Error("The production Responses API returned no output text");
  return {text, model:response.model||model, provider:"production-responses"};
}
