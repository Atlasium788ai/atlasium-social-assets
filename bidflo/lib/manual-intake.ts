/** Only direct Upwork job URLs. Never accept off-platform links or search pages. */
export function validUpworkJobUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" ||
      !["upwork.com", "www.upwork.com"].includes(url.hostname.toLowerCase()) ||
      !/^\/(?:jobs\/|nx\/search\/jobs\/details\/|freelance-jobs\/apply\/)/i.test(url.pathname)) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
