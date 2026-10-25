/**
 * A stop-contact request must come from the client's message, never a
 * staff guess, a stale deal, or an email-service unsubscribe footer.
 * Conservative matching: only a standalone, unambiguous client request.
 */
export function isExplicitClientStopRequest(raw: string): boolean {
  const normalized = raw.replace(/\r/g, "").trim();
  const candidates = [normalized.split("\n").find(line => line.trim()) ?? ""];
  for (const label of [/\b(?:client message|message body|message):\s*(?:\n|$)/i, /\bwrote:\s*\n/i]) {
    const match = label.exec(normalized);
    if (match) candidates.push(normalized.slice(match.index + match[0].length).split("\n").find(line => line.trim()) ?? "");
  }
  const request = /^(?:stop|unsubscribe|unsubscribe me|please unsubscribe me|please stop (?:contacting|messaging) me|do not (?:contact|message) me(?: again)?|don't (?:contact|message) me(?: again)?|no (?:more|further) (?:messages|follow[ -]?ups|contact))(?:[.!\s]*)$/i;
  return candidates.some(line => request.test(line.trim()));
}
