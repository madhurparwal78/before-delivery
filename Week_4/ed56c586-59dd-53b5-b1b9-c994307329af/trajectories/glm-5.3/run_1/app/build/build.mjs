import { build } from "esbuild";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

mkdirSync(join(dist, "assets"), { recursive: true });

// server: node-compatible bundles, one per entry
await build({
  entryPoints: [join(root, "src/server/start.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(dist, "start.js"),
  external: ["node:*"],
});

// client: one browser bundle, no animation library, no external origin
const client = await build({
  entryPoints: [join(root, "src/client/main.ts")],
  bundle: true,
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  format: "iife",
  minify: true,
  outfile: join(dist, "assets/site.js"),
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

copyFileSync(join(root, "public-src/site.css"), join(dist, "assets/site.css"));
copyFileSync(join(root, "public-src/favicon.svg"), join(dist, "assets/favicon.svg"));

for (const file of ["fraunces-var.ttf", "plexsans-var.ttf", "plexmono-regular.ttf", "plexmono-medium.ttf", "plexmono-semibold.ttf"]) {
  copyFileSync(join(root, "public-src/fonts", file), join(dist, "assets", file));
}

writeFileSync(join(dist, "assets/build.json"), JSON.stringify({ built: true }));
console.log(`built client (${client.outputFiles?.length ?? 1} chunk)`);
