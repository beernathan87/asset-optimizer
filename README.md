# Asset Optimizer

Drop a folder, get an optimized copy and a report that says **why** each asset was wasteful and what the right target is - with presets for Unity, web, mobile, Discord, Steam and general use.

```bash
npx asset-optimizer ./Assets --preset unity
```

Produces `./Assets/.optimized/` (optimized copies, tree mirrored) plus `report.md` / `report.json`:

```
Images: 41.2 MB -> 9.8 MB (saved 31.4 MB, 76%)
Findings: 3 high, 7 medium, 12 low.

- hero.png - oversized (high): 4096x2048 exceeds the Unity project target of 2048px ...
- hero.png - unused-alpha (medium): the file carries an alpha channel but every pixel is opaque ...
- music.wav - lossless-large (high): 38 MB WAV: uncompressed audio is 5-10x larger than OGG ...
```

## What it checks

**Images** (PNG, JPEG, WebP - optimized): oversized dimensions for the preset, alpha channels that are fully opaque, non-power-of-two sizes (Unity), JPEG that would be smaller as WebP, print-DPI exports, Steam capsule sizes, Discord emoji/sticker limits and upload size caps. Optimization resizes to the preset's longest side, drops unused alpha, converts formats per preset (or `--keep-format`), preserves ICC colour profiles while stripping other metadata, applies EXIF orientation, and keeps real alpha lossless where the preset wants it.

**Audio** (WAV, MP3, OGG, FLAC, M4A, AAC, Opus - audit only in v1): large lossless files, sample rate above target, bitrate above target for music, stereo short SFX, near-empty clips. Transcoding is not built in yet (no ffmpeg dependency); the report tells you the target to export to.

## Presets

| Preset | Max side | Images become | Notes |
|---|---|---|---|
| `web` | 2048 | WebP | browsers decode WebP everywhere |
| `unity` | 2048 | PNG/JPEG kept | Unity re-encodes at import; wins are dimensions, alpha, POT |
| `mobile` | 1024 | WebP | memory/download dominate |
| `discord` | 1920 / 10 MB | kept | emoji 128px, stickers 320px |
| `steam` | 3840 | kept | exact capsule sizes flagged |
| `general` | 4096 | kept | conservative |

## CLI

```
asset-optimizer <folder> [--preset web|unity|mobile|discord|steam|general] [--out DIR] [--keep-format] [--dry-run] [--json]
```

`node_modules`, `.git`, Unity `Library`/`Temp`, `obj`, `bin` and dot-folders are skipped. Originals are never modified. Output must be a **new directory** with an existing parent; choose another `--out` for subsequent runs. Existing destinations (including symlinks) are rejected. Output filenames include the input extension (`a.png.webp`) to prevent conversion collisions. Symbolic links and the chosen output subtree are skipped. Files producing no byte savings are retained only at their original location; the output is not a complete replacement tree.

Animated images (including APNG), disguised unsupported formats, CMYK and images above 8-bit depth are audit-skipped, never flattened or reduced silently. Decoding is limited to 16 megapixels per image and concurrency to 1?8 (default 4). Corrupt files are reported as errors. PNG is lossless, without palette quantization; JPEG/WebP quality numbers are encoder settings, not equivalent perceptual scores. Resizing preserves aspect ratio and does not force power-of-two dimensions. Lossy encoding and resizing change pixels: review copies before using them.

Steam capsule checks only apply to capsule/library-art filenames. Discord emoji/sticker filename hints use 128px/256 KiB and exactly 320?320px/512 KiB respectively; other files use a 10 MiB preset budget, not a guarantee for every account or upload context. Audio duration is only a role heuristic, bitrate is the parser's reported rate (VBR estimates may vary), and recommendations require listening; retain lossless masters.

## Local UI

```bash
npm start   # http://localhost:3000 (binds 127.0.0.1 only)
```

Paste a folder path (browsers do not expose dropped folder paths), pick a preset, run, read the table. It calls the same code as the CLI. Requests require a matching localhost/127.0.0.1 Host and same Origin for POST, with an 8 KiB body cap and no-store responses. This blocks ordinary cross-site browser requests and DNS rebinding; it is not authentication against local processes or other users on the machine. Run only on a trusted workstation, never proxy it publicly.

Reference targets: [Steam graphical assets](https://partner.steamgames.com/doc/store/assets), [Discord stickers](https://support.discord.com/hc/en-us/articles/4402687377815-Tips-for-Sticker-Creators-FAQ), [sharp ICC handling](https://sharp.pixelplumbing.com/api-output/).

## Development

```bash
npm install     # sharp ships prebuilt binaries for Windows/macOS/Linux
npm test
```

## Not in v1 (on purpose)

Audio transcoding, Unity project scanner (import settings, duplicates, unused assets), model/mesh optimization, SVG/GIF/AVIF, perceptual quality scoring. Those are the expansion path.

MIT.
