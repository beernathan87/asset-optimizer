import sharp from "sharp";
import { stat, mkdir, writeFile, open } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { PRESETS, STEAM_SIZES, DISCORD_SIZES } from "./presets.js";

export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const INPUT = { failOn: "warning", limitInputPixels: 16_777_216 };
const kindOf = (ext) => (ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg");
const isPot = (n) => n > 0 && (n & (n - 1)) === 0;
const pct = (before, after) => (before ? Math.round((1 - after / before) * 1000) / 10 : 0);

// Read PNG chunk headers without loading the compressed image into memory.
async function isApng(file) {
  const f = await open(file, "r");
  try {
    const header = Buffer.alloc(8);
    let pos = 8;
    while ((await f.read(header, 0, 8, pos)).bytesRead === 8) {
      const type = header.toString("ascii", 4);
      if (type === "acTL") return true;
      if (type === "IDAT" || type === "IEND") return false;
      pos += 12 + header.readUInt32BE(0);
    }
    return false;
  } finally { await f.close(); }
}

/** Only exactly opaque alpha may be removed. High-depth inputs are skipped. */
export async function alphaIsUnused(img, meta) {
  if (!meta.hasAlpha || meta.depth !== "uchar") return false;
  const { data } = await img.clone().extractChannel("alpha").raw().toBuffer({ resolveWithObject: true });
  return data.every((v) => v === 255);
}

/** Analyse one image; never throws for unreadable files - returns { error }. */
export async function analyseImage(file, presetName) {
  try {
  const preset = PRESETS[presetName];
  const ext = extname(file).toLowerCase();
  const kind = kindOf(ext);
  const size = (await stat(file)).size;
  let meta;
  const img = sharp(file, INPUT);
  try { meta = await img.metadata(); } catch (e) { return { file, type: "image", error: `unreadable: ${e.message}` }; }
  if (!["png", "jpeg", "webp"].includes(meta.format) || (meta.pages || 1) > 1 || (meta.format === "png" && await isApng(file)) || meta.depth !== "uchar" || meta.space === "cmyk") {
    return { file, type: "image", kind: meta.format, size, findings: [], skipReason: "Unsupported animation, colour space, format or bit depth; original retained." };
  }
  let { width = 0, height = 0 } = meta;
  if (meta.orientation >= 5) [width, height] = [height, width];
  const longest = Math.max(width, height);
  const findings = [];
  const unusedAlpha = await alphaIsUnused(img, meta);

  if (longest > preset.maxDim) findings.push({ code: "oversized", severity: "high", why: `${width}x${height} exceeds the ${preset.label} target of ${preset.maxDim}px on the longest side; larger textures use more decoded memory. This is a preset budget, not a universal display limit.`, fix: `Resize to ${preset.maxDim}px longest side.` });
  if (unusedAlpha) findings.push({ code: "unused-alpha", severity: "medium", why: "The file carries an alpha channel but every pixel is fully opaque, so the channel costs bytes (and a heavier GPU format in engines) for nothing.", fix: "Remove the fully opaque alpha channel." });
  if (preset.pot && !(isPot(width) && isPot(height))) findings.push({ code: "non-pot", severity: "low", why: `${width}x${height} is not power-of-two; compression and mipmap requirements depend on the Unity import settings and target GPU.`, fix: "Author textures at 256/512/1024/2048 sizes (or use a sprite atlas)." });
  if (kind === "jpeg" && preset.png.out === "webp") findings.push({ code: "jpeg-to-webp", severity: "low", why: "WebP encodes the same visual quality in ~25% fewer bytes than JPEG.", fix: "Convert to WebP." });
  if (meta.density && meta.density > 300) findings.push({ code: "print-dpi", severity: "low", why: `${meta.density} DPI metadata suggests a print export; screens ignore DPI, the pixel count is what matters.`, fix: "Export at the pixel size you need." });
  if (presetName === "steam") {
    const hit = Object.entries(STEAM_SIZES).find(([, [w, h]]) => w === width && h === height);
    if (!hit && /capsule|library_hero|library_logo/i.test(basename(file))) findings.push({ code: "steam-size", severity: "medium", why: `${width}x${height} is not a Steam capsule size.`, fix: `Use one of: ${Object.entries(STEAM_SIZES).map(([k, [w, h]]) => `${k} ${w}x${h}`).join(", ")}.` });
  }
  if (presetName === "discord" && /emoji|sticker/i.test(basename(file))) {
    const lim = /emoji/i.test(basename(file)) ? DISCORD_SIZES.emoji : DISCORD_SIZES.sticker;
    if (/sticker/i.test(basename(file)) ? width !== lim || height !== lim : longest > lim) findings.push({ code: "discord-size", severity: "high", why: `Filename suggests a Discord ${lim === 128 ? "emoji" : "sticker"}; target ${lim}x${lim}px. Confirm the intended role.`, fix: `Resize to ${lim}px.` });
  }
  const maxBytes = presetName === "discord" && /emoji|sticker/i.test(basename(file)) ? (/emoji/i.test(basename(file)) ? 256 : 512) * 1024 : preset.maxBytes;
  if (maxBytes && size > maxBytes) findings.push({ code: "too-large", severity: "high", why: `${(size / 1048576).toFixed(1)} MB exceeds the ${(maxBytes / 1048576).toFixed(2)} MB preset budget.`, fix: "Downscale and recompress." });

  return { file, type: "image", kind, width, height, hasAlpha: !!meta.hasAlpha, unusedAlpha, size, findings };
  } catch (e) { return { file, type: "image", error: `unreadable: ${e.message}` }; }
}

/** Write an optimized copy per preset. Returns { outFile, outSize, actions } or { skipped } when the original is already better. */
export async function optimizeImage(analysis, outDir, root, presetName, { keepFormat = false } = {}) {
  if (analysis.skipReason) return { skipped: true, reason: analysis.skipReason };
  const preset = PRESETS[presetName];
  const rule = preset[analysis.kind];
  const outKind = keepFormat ? analysis.kind : rule.out;
  const actions = [];
  let img = sharp(analysis.file, INPUT).rotate().keepIccProfile(); // apply EXIF orientation, then strip metadata by default
  const longest = Math.max(analysis.width, analysis.height);
  if (longest > preset.maxDim) { img = img.resize({ width: preset.maxDim, height: preset.maxDim, fit: "inside", withoutEnlargement: true }); actions.push(`resized to ${preset.maxDim}px longest side`); }
  if (analysis.unusedAlpha) { img = img.removeAlpha(); actions.push("removed unused alpha"); }
  const lossless = !!rule.losslessIfAlpha && analysis.hasAlpha && !analysis.unusedAlpha;
  if (outKind === "webp") img = img.webp({ quality: rule.quality, lossless, effort: 4 });
  else if (outKind === "png") img = img.png({ compressionLevel: 9, palette: false, effort: 7 });
  else img = img.jpeg({ quality: rule.quality, mozjpeg: true });
  if (outKind !== analysis.kind) actions.push(`converted ${analysis.kind} -> ${outKind}`);
  actions.push(lossless || outKind === "png" ? "lossless" : `quality ${rule.quality}`);

  const rel = analysis.file.slice(root.length).replace(/^[\\/]/, "");
  const outFile = join(outDir, dirname(rel), basename(rel) + "." + (outKind === "jpeg" ? "jpg" : outKind));
  await mkdir(dirname(outFile), { recursive: true });
  const buf = await img.toBuffer();
  if (buf.length >= analysis.size) return { skipped: true, reason: "already optimal" };
  await writeFile(outFile, buf, { flag: "wx" });
  return { outFile, outSize: buf.length, saved: analysis.size - buf.length, savedPct: pct(analysis.size, buf.length), actions };
}
