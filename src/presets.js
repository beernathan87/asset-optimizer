/**
 * Presets describe what "appropriate" means for a target, so the report can explain *why* an asset is wasteful.
 * maxDim: longest side allowed; formats: preferred output per input type; quality: encoder settings.
 */
export const PRESETS = {
  web: {
    label: "Web (sites, apps)", maxDim: 2048,
    png: { out: "webp", quality: 82, losslessIfAlpha: false }, jpeg: { out: "webp", quality: 80 }, webp: { out: "webp", quality: 80 },
    notes: ["Browsers decode WebP everywhere now; it is 25-35% smaller than PNG/JPEG at equal quality.", "Nothing on a web page needs more than 2048px on its longest side unless it is a zoomable image."],
    audio: { maxSampleRate: 48000, musicMaxBitrate: 160, wavMaxBytes: 300_000 },
  },
  unity: {
    label: "Unity project", maxDim: 2048, pot: true,
    png: { out: "png", quality: 90, losslessIfAlpha: true }, jpeg: { out: "jpeg", quality: 88 }, webp: { out: "png", quality: 90 },
    notes: ["Unity re-encodes textures at import (DXT/ASTC/ETC), so source files should stay PNG/JPEG; the win is smaller dimensions, no wasted alpha, and power-of-two sizes for mipmaps/compression.", "Set 'Alpha Is Transparency' off and RGB compression for textures without a real alpha channel."],
    audio: { maxSampleRate: 48000, musicMaxBitrate: 192, wavMaxBytes: 1_000_000 },
  },
  mobile: {
    label: "Mobile app", maxDim: 1024,
    png: { out: "webp", quality: 80 }, jpeg: { out: "webp", quality: 76 }, webp: { out: "webp", quality: 76 },
    notes: ["Device screens rarely need more than 1024px per asset; memory and download size dominate."],
    audio: { maxSampleRate: 44100, musicMaxBitrate: 128, wavMaxBytes: 200_000 },
  },
  discord: {
    label: "Discord (emoji, stickers, embeds)", maxDim: 1920, maxBytes: 8 * 1024 * 1024,
    png: { out: "png", quality: 85 }, jpeg: { out: "jpeg", quality: 85 }, webp: { out: "webp", quality: 85 },
    notes: ["Emoji are shown at 32px (128px upload max); stickers at 160px (320px, 512 KB max). Anything larger is thrown away by Discord."],
    audio: { maxSampleRate: 48000, musicMaxBitrate: 128, wavMaxBytes: 500_000 },
  },
  steam: {
    label: "Steam store assets", maxDim: 3840,
    png: { out: "png", quality: 90 }, jpeg: { out: "jpeg", quality: 90 }, webp: { out: "png", quality: 90 },
    notes: ["Steam wants exact capsule sizes (header 920x430, small 462x174, main 1232x706, vertical 748x896, library 600x900, hero 3840x1240, logo 1280x720). Anything else is resized by Steam - supply exact sizes."],
    audio: { maxSampleRate: 48000, musicMaxBitrate: 192, wavMaxBytes: 1_000_000 },
  },
  general: {
    label: "General", maxDim: 4096,
    png: { out: "png", quality: 90, losslessIfAlpha: true }, jpeg: { out: "jpeg", quality: 85 }, webp: { out: "webp", quality: 85 },
    notes: [],
    audio: { maxSampleRate: 48000, musicMaxBitrate: 192, wavMaxBytes: 1_000_000 },
  },
};

export const STEAM_SIZES = { header: [920, 430], small_capsule: [462, 174], main_capsule: [1232, 706], vertical_capsule: [748, 896], library_capsule: [600, 900], library_hero: [3840, 1240], library_logo: [1280, 720] };
export const DISCORD_SIZES = { emoji: 128, sticker: 320 };
