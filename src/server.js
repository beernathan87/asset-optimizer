import { pathToFileURL } from "node:url";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./run.js";
import { PRESETS } from "./presets.js";

// Local-only helper UI: it runs on your machine and optimizes folders on your disk.
const PORT = Number(process.env.PORT) || 3000;
const HTML = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
export const app = new Hono();
app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  const host = c.req.header("host");
  const allowed = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
  if (!allowed.has(host)) return c.json({ error: "invalid host" }, 403);
  if (c.req.method !== "GET" && (c.req.header("origin") !== `http://${host}` || c.req.header("sec-fetch-site") === "cross-site")) return c.json({ error: "same-origin requests required" }, 403);
  await next();
});
app.use("/api/*", bodyLimit({ maxSize: 8192 }));
app.get("/", (c) => c.html(HTML));
app.get("/api/presets", (c) => c.json(Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, maxDim: v.maxDim, notes: v.notes }]))));

let busy = false;
app.post("/api/run", async (c) => {
  if (busy) return c.json({ error: "a run is already in progress" }, 409);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b.folder !== "string" || !b.folder.trim() || b.folder.length > 4096 || (b.out !== undefined && typeof b.out !== "string") || [b.keepFormat, b.dryRun].some(v => v !== undefined && typeof v !== "boolean")) return c.json({ error: "folder is required" }, 400);
  const folder = resolve(b.folder);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return c.json({ error: "folder does not exist" }, 400);
  if (b.preset !== undefined && (typeof b.preset !== "string" || !Object.hasOwn(PRESETS, b.preset))) return c.json({ error: "unknown preset" }, 400);
  if (busy) return c.json({ error: "a run is already in progress" }, 409);
  busy = true;
  try {
    const report = await run(folder, { preset: b.preset || "general", outDir: b.out || undefined, keepFormat: !!b.keepFormat, dryRun: !!b.dryRun });
    return c.json(report);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  } finally { busy = false; }
});

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => console.log(`asset-optimizer UI on http://localhost:${info.port} (local only)`));
