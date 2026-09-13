import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./run.js";
import { PRESETS } from "./presets.js";

// Local-only helper UI: it runs on your machine and optimizes folders on your disk.
const PORT = Number(process.env.PORT) || 3000;
const HTML = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = new Hono();
app.get("/", (c) => c.html(HTML));
app.get("/api/presets", (c) => c.json(Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, maxDim: v.maxDim, notes: v.notes }]))));

let busy = false;
app.post("/api/run", async (c) => {
  if (busy) return c.json({ error: "a run is already in progress" }, 409);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b.folder !== "string") return c.json({ error: "folder is required" }, 400);
  const folder = resolve(b.folder);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return c.json({ error: "folder does not exist" }, 400);
  if (b.preset && !PRESETS[b.preset]) return c.json({ error: "unknown preset" }, 400);
  busy = true;
  try {
    const report = await run(folder, { preset: b.preset || "general", outDir: b.out || undefined, keepFormat: !!b.keepFormat, dryRun: !!b.dryRun });
    return c.json(report);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  } finally { busy = false; }
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => console.log(`asset-optimizer UI on http://localhost:${info.port} (local only)`));
