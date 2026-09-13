import sharp from "sharp";
import { stat, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { PRESETS, STEAM_SIZES, DISCORD_SIZES } from "./presets.js";

export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const kindOf = (ext) => (ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg");
const isPot = (n) => n > 0 && (n & (n - 1)) === 0;
const pct = (before, after) => (before ? Math.round((1 - after / before) * 1000) / 10 : 0);

/** True when the alpha channel is present but every pixel is fully opaque (or nearly so). */
export async function alphaIsUnused(img, meta) {
  if (!meta.hasAlpha) return false;
  const { data } = await img.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = meta.channels ?? 4;
  for (let i = ch - 1; i < data.length; i += ch) if (data[i] < 250) return false;
  return true;
}

/** Analyse one image; never throws for unreadable files - returns { error }. */
export async function analyseImage(file, presetName) {
  const preset = PRESETS[presetName];
  const ext = extname(file).toLowerCase();
  const kind = kindOf(ext);
  const size = (await stat(file)).size;
  let meta;
  const img = sharp(file, { failOn: "none" });
  try { meta = await img.metadata(); } catch (e) { return { file, type: "image", error: `unreadable: ${e.message}` }; }
  const { width = 0, height = 0 } = meta;
  const longest = Math.max(width, height);
  const findings = [];
  const unusedAlpha = await alphaIsUnused(img, meta);

  if (longest > preset.maxDim) findings.push({ code: "oversized", severity: "high", why: `${width}x${height} exceeds the ${preset.label} target of ${preset.maxDim}px on the longest side; the extra pixels are decoded and held in memory but never shown.`, fix: `Resize to ${preset.maxDim}px longest side.` });
  if (unusedAlpha) findings.push({ code: "unused-alpha", severity: "medium", why: "The file carries an alpha channel but every pixel is fully opaque, so the channel costs bytes (and a heavier GPU format in engines) for nothing.", fix: "Flatten to RGB." });
  if (preset.pot && !(isPot(width) && isPot(height))) findings.push({ code: "non-pot", severity: "low", why: `${width}x${height} is not power-of-two; Unity cannot use the most efficient compressed formats or mipmaps without padding.`, fix: "Author textures at 256/512/1024/2048 sizes (or use a sprite atlas)." });
  if (kind === "png" && !meta.hasAlpha && width * height > 250_000) findings.push({ code: "png-photo", severity: "medium", why: "Large opaque PNG: PNG is lossless and inefficient for photographic/gradient content.", fix: `Encode as ${preset.jpeg.out.toUpperCase()}.` });
  if (kind === "jpeg" && preset.png.out === "webp") findings.push({ code: "jpeg-to-webp", severity: "low", why: "WebP encodes the same visual quality in ~25% fewer bytes than JPEG.", fix: "Convert to WebP." });
  if (meta.density && meta.density > 300) findings.push({ code: "print-dpi", severity: "low", why: `${meta.density} DPI metadata suggests a print export; screens ignore DPI, the pixel count is what matters.`, fix: "Export at the pixel size you need." });
  if (presetName === "steam") {
    const hit = Object.entries(STEAM_SIZES).find(([, [w, h]]) => w === width && h === height);
    if (!hit) findings.push({ code: "steam-size", severity: "medium", why: `${width}x${height} is not a Steam capsule size.`, fix: `Use one of: ${Object.entries(STEAM_SIZES).map(([k, [w, h]]) => `${k} ${w}x${h}`).join(", ")}.` });
  }
  if (presetName === "discord" && /emoji|sticker/i.test(basename(file))) {
    const lim = /emoji/i.test(basename(file)) ? DISCORD_SIZES.emoji : DISCORD_SIZES.sticker;
    if (longest > lim) findings.push({ code: "discord-size", severity: "high", why: `Discord displays this at most ${lim}px; anything larger is downscaled on upload.`, fix: `Resize to ${lim}px.` });
  }
  if (preset.maxBytes && size > preset.maxBytes) findings.push({ code: "too-large", severity: "high", why: `${(size / 1048576).toFixed(1)} MB exceeds the ${(preset.maxBytes / 1048576).toFixed(0)} MB upload limit.`, fix: "Downscale and recompress." });

  return { file, type: "image", kind, width, height, hasAlpha: !!meta.hasAlpha, unusedAlpha, size, findings };
}

/** Write an optimized copy per preset. Returns { outFile, outSize, actions } or { skipped } when the original is already better. */
export async function optimizeImage(analysis, outDir, root, presetName, { keepFormat = false } = {}) {
  const preset = PRESETS[presetName];
  const rule = preset[analysis.kind];
  const outKind = keepFormat ? analysis.kind : rule.out;
  const actions = [];
  let img = sharp(analysis.file, { failOn: "none" }).rotate(); // apply EXIF orientation, then strip metadata by default
  const longest = Math.max(analysis.width, analysis.height);
  if (longest > preset.maxDim) { img = img.resize({ width: analysis.width >= analysis.height ? preset.maxDim : null, height: analysis.height > analysis.width ? preset.maxDim : null, withoutEnlargement: true }); actions.push(`resized to ${preset.maxDim}px longest side`); }
  if (analysis.unusedAlpha) { img = img.flatten({ background: "#ffffff" }).removeAlpha(); actions.push("removed unused alpha"); }
  const lossless = !!rule.losslessIfAlpha && analysis.hasAlpha && !analysis.unusedAlpha;
  if (outKind === "webp") img = img.webp({ quality: rule.quality, lossless, effort: 4 });
  else if (outKind === "png") img = img.png({ compressionLevel: 9, palette: !lossless && !analysis.hasAlpha ? false : false, effort: 7 });
  else img = img.jpeg({ quality: rule.quality, mozjpeg: true });
  if (outKind !== analysis.kind) actions.push(`converted ${analysis.kind} -> ${outKind}`);
  actions.push(lossless ? "lossless" : `quality ${rule.quality}`);

  const rel = analysis.file.slice(root.length).replace(/^[\\/]/, "");
  const outFile = join(outDir, dirname(rel), basename(rel, extname(rel)) + "." + (outKind === "jpeg" ? "jpg" : outKind));
  await mkdir(dirname(outFile), { recursive: true });
  const buf = await img.toBuffer();
  if (buf.length >= analysis.size && outKind === analysis.kind && actions.length <= 1) return { skipped: true, reason: "already optimal" };
  await writeFile(outFile, buf);
  return { outFile, outSize: buf.length, saved: analysis.size - buf.length, savedPct: pct(analysis.size, buf.length), actions };
}
