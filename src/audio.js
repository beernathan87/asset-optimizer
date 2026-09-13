import { parseFile } from "music-metadata";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { PRESETS } from "./presets.js";

export const AUDIO_EXT = new Set([".wav", ".mp3", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus"]);

/** Audit only (no transcoding in v1): explains what is wasteful and the right target. */
export async function analyseAudio(file, presetName) {
  try {
  const rules = PRESETS[presetName].audio;
  const size = (await stat(file)).size;
  const ext = extname(file).toLowerCase();
  let fmt;
  try { fmt = (await parseFile(file, { duration: true, skipCovers: true })).format; } catch (e) { return { file, type: "audio", error: `unreadable: ${e.message}` }; }
  const { sampleRate = 0, numberOfChannels = 0, bitrate = 0, duration = 0, codec = ext.slice(1) } = fmt;
  const kbps = Math.round(bitrate / 1000);
  const findings = [];
  const lossless = fmt.lossless === true;
  const isMusic = duration >= 20;

  if (lossless && size > rules.wavMaxBytes) findings.push({ code: "lossless-large", severity: isMusic ? "high" : "medium", why: `${(size / 1048576).toFixed(1)} MB ${ext.slice(1).toUpperCase()}: lossless audio may be larger than a lossy delivery encode. ${isMusic ? "This long clip may be music or ambience; confirm its role before converting." : "Retain lossless masters and check runtime requirements."}`, fix: isMusic ? `Encode as OGG Vorbis ~${rules.musicMaxBitrate} kbps (or MP3).` : "Encode as OGG Vorbis, or keep WAV only if it is < 1 s." });
  if (sampleRate > rules.maxSampleRate) findings.push({ code: "sample-rate", severity: "medium", why: `${sampleRate} Hz exceeds ${rules.maxSampleRate} Hz; this exceeds the preset delivery budget.`, fix: `Resample to ${rules.maxSampleRate >= 48000 ? "48000" : "44100"} Hz.` });
  if (!lossless && isMusic && kbps > rules.musicMaxBitrate) findings.push({ code: "bitrate", severity: "low", why: `${kbps} kbps is above the ${rules.musicMaxBitrate} kbps target; audition a lower-bitrate export from the lossless master before replacing it.`, fix: `Export from the master at ${rules.musicMaxBitrate} kbps.` });
  if (numberOfChannels === 2 && duration > 0 && duration < 3) findings.push({ code: "stereo-sfx", severity: "low", why: "This short stereo clip may be positional SFX. Mono can save space if stereo imaging is unnecessary.", fix: "Export as mono." });
  if (duration > 0 && duration < 0.05) findings.push({ code: "near-empty", severity: "low", why: `Only ${Math.round(duration * 1000)} ms of audio.`, fix: "Check the export; this may be silence or a broken clip." });

  return { file, type: "audio", codec, sampleRate, channels: numberOfChannels, kbps, duration: Math.round(duration * 100) / 100, size, findings };
  } catch (e) { return { file, type: "audio", error: `unreadable: ${e.message}` }; }
}
