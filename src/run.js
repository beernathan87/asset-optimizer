import { readdir, mkdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { IMAGE_EXT, analyseImage, optimizeImage } from "./images.js";
import { AUDIO_EXT, analyseAudio } from "./audio.js";
import { PRESETS } from "./presets.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "Library", "Temp", "obj", "bin", ".optimized"]);

export async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) yield* walk(join(dir, e.name)); }
    else yield join(dir, e.name);
  }
}

const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/**
 * Audit + optimize a folder. Writes optimized copies to outDir (mirroring structure), plus report.json / report.md.
 * @param {string} root
 * @param {{ preset?: string, outDir?: string, keepFormat?: boolean, dryRun?: boolean, concurrency?: number, onProgress?: (item) => void }} opts
 */
export async function run(root, { preset = "general", outDir, keepFormat = false, dryRun = false, concurrency = 4, onProgress } = {}) {
  if (!PRESETS[preset]) throw new Error(`unknown preset '${preset}'; use one of ${Object.keys(PRESETS).join(", ")}`);
  root = resolve(root);
  outDir = resolve(outDir || join(root, ".optimized"));
  const files = [];
  for await (const f of walk(root)) {
    const ext = extname(f).toLowerCase();
    if (IMAGE_EXT.has(ext) || AUDIO_EXT.has(ext)) files.push(f);
  }
  if (!dryRun) await mkdir(outDir, { recursive: true });

  const items = [];
  let i = 0;
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++];
      const ext = extname(f).toLowerCase();
      let item;
      if (IMAGE_EXT.has(ext)) {
        item = await analyseImage(f, preset);
        if (!item.error && !dryRun) {
          try { item.result = await optimizeImage(item, outDir, root, preset, { keepFormat }); }
          catch (e) { item.result = { error: e.message }; }
        }
      } else item = await analyseAudio(f, preset);
      item.rel = relative(root, f);
      items.push(item);
      onProgress?.(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, worker));
  items.sort((a, b) => a.rel.localeCompare(b.rel));

  const images = items.filter((x) => x.type === "image" && !x.error);
  const before = images.reduce((s, x) => s + x.size, 0);
  const after = images.reduce((s, x) => s + (x.result?.outSize ?? x.size), 0);
  const findings = items.flatMap((x) => (x.findings || []).map((f) => ({ ...f, file: x.rel })));
  const bySeverity = { high: findings.filter((f) => f.severity === "high").length, medium: findings.filter((f) => f.severity === "medium").length, low: findings.filter((f) => f.severity === "low").length };
  const report = {
    root, outDir: dryRun ? null : outDir, preset, presetLabel: PRESETS[preset].label, generatedAt: new Date().toISOString(),
    totals: { files: items.length, images: images.length, audio: items.filter((x) => x.type === "audio").length, errors: items.filter((x) => x.error).length, imageBytesBefore: before, imageBytesAfter: after, saved: before - after, savedPct: before ? Math.round((1 - after / before) * 1000) / 10 : 0, findings: bySeverity },
    items,
  };
  report.markdown = toMarkdown(report);
  if (!dryRun) {
    await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(outDir, "report.md"), report.markdown);
  }
  return report;
}

export function toMarkdown(r) {
  const t = r.totals;
  const lines = [`# Asset report - ${r.presetLabel}`, "", `Scanned ${t.files} files (${t.images} images, ${t.audio} audio) under \`${r.root}\`.`, "",
    `**Images: ${fmtBytes(t.imageBytesBefore)} -> ${fmtBytes(t.imageBytesAfter)} (saved ${fmtBytes(Math.max(t.saved, 0))}, ${t.savedPct}%)**${r.outDir ? ` - optimized copies in \`${r.outDir}\`` : " (dry run)"}`, "",
    `Findings: ${t.findings.high} high, ${t.findings.medium} medium, ${t.findings.low} low.`, ""];
  const notes = PRESETS[r.preset].notes;
  if (notes.length) lines.push("## Why these targets", "", ...notes.map((n) => `- ${n}`), "");
  lines.push("## Files", "", "| File | Before | After | Findings |", "|---|---|---|---|");
  for (const x of r.items) {
    if (x.error) { lines.push(`| ${x.rel} | - | - | error: ${x.error} |`); continue; }
    const after = x.result?.outSize != null ? `${fmtBytes(x.result.outSize)} (-${x.result.savedPct}%)` : x.result?.skipped ? "kept" : x.type === "audio" ? "audit only" : "-";
    const f = (x.findings || []).map((f) => `**${f.code}**`).join(", ") || "ok";
    lines.push(`| ${x.rel} | ${fmtBytes(x.size)} | ${after} | ${f} |`);
  }
  const explained = r.items.flatMap((x) => (x.findings || []).map((f) => ({ ...f, rel: x.rel })));
  if (explained.length) {
    lines.push("", "## What is wasteful and why", "");
    for (const f of explained) lines.push(`- \`${f.rel}\` - **${f.code}** (${f.severity}): ${f.why} _Fix: ${f.fix}_`);
  }
  return lines.join("\n") + "\n";
}
