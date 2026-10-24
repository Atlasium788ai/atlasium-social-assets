import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("ECHO generated media uses JPEG compatible with Meta Instagram publishing", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /output_format: "jpeg"/);
  assert.match(source, /\.output\(\{ format: "image\/jpeg", quality: 90 \}\)/);
  assert.match(source, /ai-\$\{crypto\.randomUUID\(\)\}-\$\{variant\}\.jpg/);
  assert.match(source, /contentType: "image\/jpeg"/);
});

test("manual PNG uploads convert for Instagram, with safe rejection if conversion is unavailable", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /chosen\.some\(\(channel\) => channel\.service === "instagram"\)/);
  assert.match(source, /Instagram requires a JPEG image/);
  assert.match(source, /instagramImageUrl =/);
  assert.match(source, /channel\.service === "instagram" \? instagramImageUrl : imageUrl/);
});
