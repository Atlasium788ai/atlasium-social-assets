export const MAX_PROOF_DOCUMENT_BYTES = 10 * 1024 * 1024;

const ignoredWords = new Set([
  "about", "and", "atlasium", "brief", "capabilities", "case", "document", "for", "from",
  "overview", "proof", "services", "study", "the", "this", "with",
]);

export function safeProofFilename(value: string) {
  const clean = value.replace(/[\r\n"\\/]/g, "-").replace(/\s+/g, " ").trim();
  return (clean || "Atlasium-Proof.pdf").slice(0, 180);
}

export function deriveProofKeywords(name: string, description: string, supplied: string) {
  const explicit = supplied.split(/[\n,]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  const source = `${name.replace(/\.pdf$/i, "")} ${description}`.toLowerCase();
  const phrases = [
    "appointment booking", "contact centre", "facebook ads", "genesys architect", "genesys cloud",
    "google ads", "lead generation", "marketing automation", "meta ads", "paid media",
    "revenue operations", "sales operations", "tiktok ads",
  ].filter((phrase) => source.includes(phrase));
  const words = source.match(/[a-z][a-z0-9+.-]{2,}/g) ?? [];
  const derived = words.filter((word) => word.length >= 4 && !ignoredWords.has(word));
  return [...new Set([...explicit, ...phrases, ...derived])].slice(0, 40);
}

export function validateProofPdf(input: { name: string; size: number; bytes: Uint8Array }) {
  if (!input.name.toLowerCase().endsWith(".pdf")) return "Only PDF proof documents are allowed.";
  if (input.size < 1 || input.size > MAX_PROOF_DOCUMENT_BYTES) return "PDF must be 10 MB or smaller.";
  const signature = new TextDecoder("ascii").decode(input.bytes.slice(0, 5));
  if (signature !== "%PDF-") return "The uploaded file is not a valid PDF.";
  return null;
}
