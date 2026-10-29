import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const legacyBrand = ["Bid", "Flo"].join("");
const userFacingRoots = ["app", "components", "public"];
const textExtensions = new Set([".css", ".html", ".json", ".md", ".svg", ".ts", ".tsx"]);

async function textFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(fullPath);
    return textExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
  }));
  return files.flat();
}

test("user-facing Visez files contain no retired product branding", async () => {
  const projectRoot = process.cwd();
  const files = (await Promise.all(
    userFacingRoots.map((root) => textFiles(path.join(projectRoot, root))),
  )).flat();

  const offenders: string[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    // Lowercase `bidflo_` database identifiers are deliberately preserved for
    // production compatibility; this guard targets the retired display brand.
    if (content.includes(legacyBrand)) {
      offenders.push(path.relative(projectRoot, file));
    }
  }

  assert.deepEqual(offenders, [], `Retired product branding found in: ${offenders.join(", ")}`);
});
