import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdir, rm, writeFile, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../src/run.js";
import { analyseImage } from "../src/images.js";
import { analyseAudio } from "../src/audio.js";

const TMP = join(import.meta.dirname, "tmp");

/** Minimal valid 16-bit PCM WAV with the given seconds/channels/rate (silence). */
function wav({ seconds = 1, channels = 2, rate = 48000 }) {
  const frames = Math.round(seconds * rate), data = frames * channels * 2;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(data, 40);
  return b;
}

before(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(join(TMP, "src", "ui"), { recursive: true });
  await mkdir(join(TMP, "src", "node_modules"), { recursive: true });
  // 3000x1500 photographic-style PNG (gradients + shapes) carrying an alpha channel that is fully opaque (wasteful).
  const heroSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="1500"><defs><radialGradient id="g"><stop offset="0" stop-color="#ffd27f"/><stop offset="1" stop-color="#2b1b3d"/></radialGradient></defs><rect width="3000" height="1500" fill="url(#g)"/>${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 733) % 3000}" cy="${(i * 421) % 1500}" r="${60 + (i % 7) * 40}" fill="hsl(${i * 37},70%,50%)" opacity="0.6"/>`).join("")}</svg>`;
  await sharp(Buffer.from(heroSvg)).ensureAlpha().png().toFile(join(TMP, "src", "hero.png"));
  // 100x100 icon with real alpha (transparent circle): must stay lossless-alpha in unity preset.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="#f00"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(join(TMP, "src", "ui", "icon.png"));
  // 500x300 JPEG (non-POT).
  await sharp({ create: { width: 500, height: 300, channels: 3, background: "#3366cc" } }).jpeg({ quality: 95 }).toFile(join(TMP, "src", "photo.jpg"));
  await writeFile(join(TMP, "src", "music.wav"), wav({ seconds: 30, channels: 2, rate: 96000 }));
  await writeFile(join(TMP, "src", "click.wav"), wav({ seconds: 0.4, channels: 2, rate: 44100 }));
  await writeFile(join(TMP, "src", "node_modules", "ignored.png"), Buffer.from("not really a png"));
  await writeFile(join(TMP, "src", "notes.txt"), "ignored");
});
after(() => rm(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}));

test("image analysis explains oversized, unused alpha, non-POT", async () => {
  const hero = await analyseImage(join(TMP, "src", "hero.png"), "unity");
  assert.equal(hero.width, 3000);
  assert.equal(hero.unusedAlpha, true);
  const codes = hero.findings.map((f) => f.code);
  assert.ok(codes.includes("oversized") && codes.includes("unused-alpha") && codes.includes("non-pot"), codes.join());
  for (const f of hero.findings) { assert.ok(f.why.length > 20); assert.ok(f.fix.length > 5); }
  const icon = await analyseImage(join(TMP, "src", "ui", "icon.png"), "unity");
  assert.equal(icon.unusedAlpha, false);
  assert.ok(!icon.findings.some((f) => f.code === "unused-alpha"));
});

test("audio audit flags 96 kHz stereo WAV music and stereo short SFX, with reasons", async () => {
  const music = await analyseAudio(join(TMP, "src", "music.wav"), "web");
  assert.equal(music.sampleRate, 96000);
  const codes = music.findings.map((f) => f.code);
  assert.ok(codes.includes("lossless-large") && codes.includes("sample-rate"), codes.join());
  const click = await analyseAudio(join(TMP, "src", "click.wav"), "web");
  assert.ok(click.findings.some((f) => f.code === "stereo-sfx"));
});

test("first milestone: drop a folder -> optimized copy + savings report", async () => {
  const report = await run(join(TMP, "src"), { preset: "web", outDir: join(TMP, "out") });
  assert.equal(report.totals.images, 3);
  assert.equal(report.totals.audio, 2);
  assert.equal(report.totals.errors, 0, "node_modules and non-assets are skipped");
  assert.ok(report.totals.saved > 0 && report.totals.savedPct > 30, `saved ${report.totals.savedPct}%`);
  const hero = report.items.find((x) => x.rel === "hero.png");
  assert.ok(hero.result.actions.some((a) => a.includes("resized")));
  assert.ok(hero.result.actions.some((a) => a.includes("removed unused alpha")));
  const out = await sharp(hero.result.outFile).metadata();
  assert.equal(out.width, 2048);
  assert.equal(out.format, "webp");
  assert.equal(out.hasAlpha, false);
  assert.ok((await stat(join(TMP, "out", "ui", "icon.webp"))).size > 0, "tree is mirrored");
  const md = await readFile(join(TMP, "out", "report.md"), "utf8");
  assert.match(md, /Images: .* -> .* \(saved/);
  assert.match(md, /What is wasteful and why/);
  assert.match(md, /music\.wav.*lossless-large/);
  const json = JSON.parse(await readFile(join(TMP, "out", "report.json"), "utf8"));
  assert.equal(json.items.length, 5);
});

test("keepFormat keeps PNG; unity preset keeps alpha lossless; dry run writes nothing", async () => {
  const r = await run(join(TMP, "src"), { preset: "unity", outDir: join(TMP, "out2"), keepFormat: true });
  const icon = r.items.find((x) => x.rel.endsWith("icon.png"));
  const meta = await sharp(icon.result?.outFile ?? icon.file).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.hasAlpha, true);
  const dry = await run(join(TMP, "src"), { preset: "mobile", outDir: join(TMP, "out3"), dryRun: true });
  assert.equal(dry.outDir, null);
  await assert.rejects(stat(join(TMP, "out3")));
  await assert.rejects(run(join(TMP, "src"), { preset: "nope" }), /unknown preset/);
});
