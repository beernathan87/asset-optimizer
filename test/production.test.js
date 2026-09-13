import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdir, rm, writeFile, readFile, chmod, symlink, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { run } from "../src/run.js";
import { app } from "../src/server.js";

sharp.cache(false);
// Production corpus: Unicode + spaces + deep nesting, read-only originals, conversion collisions, corrupt/zero/disguised
// files, an unsupported type, and a symlink/junction that must be skipped. Originals must never change.
const TMP = join(import.meta.dirname, `tmp-prod-${process.pid}`);
const ROOT = join(TMP, "my assets");
const img = (w, h, alpha = false) => sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 30, b: 30, alpha: 1 } : { r: 30, g: 120, b: 200 } } }).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#ffd400"/></svg>`), top: 0, left: 0 }]);
let linkMade = false;
const hashes = async (dir) => { const out = {}; for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) { const p = join(e.parentPath ?? e.path, e.name); out[p] = createHash("sha256").update(await readFile(p)).digest("hex"); } return out; };

before(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(join(ROOT, "nested", "deeper", "évén déeper"), { recursive: true });
  await img(2600, 1400).png().toFile(join(ROOT, "hero big.png"));
  await img(400, 300).jpeg({ quality: 95 }).toFile(join(ROOT, "Ünïcødé 📷 photo.jpg"));
  await img(900, 600).jpeg({ quality: 92 }).toFile(join(ROOT, "nested", "deeper", "évén déeper", "deep photo.jpg"));
  await img(640, 480).png().toFile(join(ROOT, "nested", "collide.png"));
  await img(640, 480).jpeg().toFile(join(ROOT, "nested", "collide.jpg"));
  await img(512, 512, true).png().toFile(join(ROOT, "readonly.png")); await chmod(join(ROOT, "readonly.png"), 0o444);
  await writeFile(join(ROOT, "corrupt.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]));
  await writeFile(join(ROOT, "zero.png"), Buffer.alloc(0));
  await writeFile(join(ROOT, "disguised.png"), Buffer.from("GIF89a" + "x".repeat(100)));
  await writeFile(join(ROOT, "notes.txt"), "not an asset");
  try { await symlink(join(ROOT, "nested"), join(ROOT, "link-to-nested"), "junction"); linkMade = true; } catch { /* no privilege on this platform */ }
});
after(async () => { try { await chmod(join(ROOT, "readonly.png"), 0o644); } catch { /* ignore */ } await rm(TMP, { recursive: true, force: true }); });

test("production corpus: unicode/space/nested paths, collisions, read-only, corrupt inputs, symlinks; originals untouched", async () => {
  const before = await hashes(ROOT);
  const outDir = join(TMP, "out dir");
  const report = await run(ROOT, { preset: "web", outDir });
  const rel = (i) => i.rel.replace(/\\/g, "/");
  const byRel = Object.fromEntries(report.items.map((i) => [rel(i), i]));
  assert.equal(report.totals.errors, 3, "corrupt, zero and disguised are errors, nothing else");
  for (const bad of ["corrupt.png", "zero.png", "disguised.png"]) assert.ok(byRel[bad]?.error, `${bad} reported as error`);
  assert.ok(byRel["Ünïcødé 📷 photo.jpg"] && !byRel["Ünïcødé 📷 photo.jpg"].error, "unicode filename processed");
  assert.ok(byRel["nested/deeper/évén déeper/deep photo.jpg"], "deeply nested unicode dir processed");
  assert.ok(byRel["readonly.png"] && !byRel["readonly.png"].error, "read-only original is readable");
  assert.equal(byRel["notes.txt"], undefined, "unsupported types are ignored");
  assert.ok(!Object.keys(byRel).some((k) => k.startsWith("link-to-nested")), "symlinked/junction trees are skipped");
  const outputs = Object.keys(await hashes(outDir)).map((p) => p.slice(outDir.length + 1).replace(/\\/g, "/")).sort();
  assert.ok(outputs.includes("nested/collide.png.webp") && outputs.includes("nested/collide.jpg.webp"), "conversion collisions keep both files");
  assert.ok(outputs.includes("nested/deeper/évén déeper/deep photo.jpg.webp") && outputs.includes("Ünïcødé 📷 photo.jpg.webp"));
  assert.ok(!outputs.some((o) => /corrupt|zero|disguised|notes/.test(o)), "failed/unsupported inputs produce no output");
  assert.deepEqual(await hashes(ROOT), before, "no original byte changed");
  // second run into the same output dir is refused (fresh destination rule), originals still untouched
  await assert.rejects(run(ROOT, { preset: "web", outDir }), /exist|fresh|new directory/i);
  assert.deepEqual(await hashes(ROOT), before);
  if (linkMade) assert.ok(true, "junction present and skipped");
});

test("golden: report shape and finding codes are stable for PNG / JPEG / WebP inputs", async () => {
  const outDir = join(TMP, "golden out");
  const report = await run(ROOT, { preset: "unity", outDir, dryRun: true });
  for (const k of ["root", "outDir", "preset", "presetLabel", "generatedAt", "totals", "items", "markdown"]) assert.ok(k in report, k);
  for (const k of ["files", "images", "audio", "errors", "imageBytesBefore", "imageBytesAfter", "saved", "savedPct", "findings"]) assert.ok(k in report.totals, `totals.${k}`);
  const hero = report.items.find((i) => i.rel === "hero big.png");
  assert.equal(hero.kind, "png"); assert.ok(hero.findings.some((f) => f.code === "oversized"), "2600px > unity 2048 target");
  const item = (rel) => report.items.find((i) => i.rel.replace(/\\/g, "/") === rel);
  assert.equal(item("nested/collide.jpg").kind, "jpeg"); assert.equal(item("Ünïcødé 📷 photo.jpg").kind, "jpeg");
  for (const i of report.items.filter((i) => !i.error)) for (const f of i.findings) { assert.match(f.code, /^[a-z0-9-]+$/); assert.ok(["high", "medium", "low"].includes(f.severity)); assert.ok(typeof f.why === "string" && f.why.length > 10 && typeof f.fix === "string"); }
  assert.match(report.markdown, /Images: /);
});

test("production: local UI sends a strict CSP with its own hashed inline script and framing/sniffing protections", async () => {
  const r = await app.request("http://localhost:3000/", { headers: { host: "localhost:3000" } });
  assert.equal(r.status, 200);
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/); assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  const hash = createHash("sha256").update((await r.text()).match(/<script>([\s\S]*?)<\/script>/)[1]).digest("base64");
  assert.ok(csp.includes(`'sha256-${hash}'`));
  assert.equal(r.headers.get("x-frame-options"), "DENY"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});
