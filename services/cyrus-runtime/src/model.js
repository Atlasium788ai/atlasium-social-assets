export function createOpenAiModel({ apiKey, model, baseUrl = "https://api.openai.com/v1", maxOutputTokens = 1_200, fetchImpl = fetch }) {
  return {
    async respond({ instructions, input, tools }) {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, instructions, input, tools, tool_choice: "auto", parallel_tool_calls: false, max_output_tokens: maxOutputTokens }),
        signal: AbortSignal.timeout(60_000),
      });
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`Model service returned invalid JSON (${response.status})`);
      }
      if (!response.ok) throw new Error(body?.error?.message || `Model request failed: ${response.status}`);
      return body;
    },
  };
}

export function outputText(response) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n");
}

export function toolCalls(response) {
  return (response.output || []).filter((item) => item.type === "function_call");
}
