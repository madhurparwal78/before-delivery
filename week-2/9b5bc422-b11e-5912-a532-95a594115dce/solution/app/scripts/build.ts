import { createHash } from "node:crypto";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PUBLIC = join(DIST, "public");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(PUBLIC, { recursive: true });

await build({
  entryPoints: [join(ROOT, "src/server/main.ts")],
  outfile: join(DIST, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});

const client = await build({
  entryPoints: [join(ROOT, "src/client/main.tsx")],
  outdir: join(PUBLIC, "assets"),
  entryNames: "[name]-[hash]",
  assetNames: "[name]-[hash]",
  publicPath: "/assets",
  bundle: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  jsx: "automatic",
  loader: { ".woff2": "file" },
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "warning",
});

const built = Object.keys(client.metafile.outputs).map((file) => `/${file.slice(file.indexOf("dist/public/") + "dist/public/".length)}`);
const script = built.find((file) => file.endsWith(".js"));
const style = built.find((file) => file.endsWith(".css"));
const preloads = built
  .filter((file) => /(newsreader-latin-500-normal|atkinson-hyperlegible-latin-400-normal)-.*\.woff2$/.test(file))
  .map((file) => `<link rel="preload" href="${file}" as="font" type="font/woff2" crossorigin>`)
  .join("");

const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oddment Workspace</title>
<meta name="description" content="A local-first personal workspace for writing and records.">
<meta name="theme-color" content="#123B2E">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
${preloads}<link rel="stylesheet" href="${style}">
</head>
<body>
<div id="root"></div>
<div id="overlays"></div>
<script type="module" src="${script}"></script>
</body>
</html>
`;
writeFileSync(join(PUBLIC, "index.html"), shell);
cpSync(join(ROOT, "public/icon.svg"), join(PUBLIC, "icon.svg"));

const offlineFiles = ["/", "/icon.svg", ...built];
const version = createHash("sha256").update(shell).update(offlineFiles.join()).digest("hex").slice(0, 16);
await build({
  entryPoints: [join(ROOT, "src/client/sw.ts")],
  outfile: join(PUBLIC, "sw.js"),
  bundle: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  define: { __OFFLINE_FILES__: JSON.stringify(offlineFiles), __CACHE_NAME__: JSON.stringify(`oddment-${version}`) },
  logLevel: "warning",
});
