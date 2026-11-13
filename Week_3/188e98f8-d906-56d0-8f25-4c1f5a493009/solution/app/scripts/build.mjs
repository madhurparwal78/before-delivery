import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const out = path.join(dist, "public");
const tokens = JSON.parse(readFileSync(path.join(root, "src/shared/tokens.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(out, "assets"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src/server/main.ts")],
  outfile: path.join(dist, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});

const client = await build({
  entryPoints: { app: path.join(root, "src/client/main.tsx") },
  outdir: path.join(out, "assets"),
  bundle: true,
  minify: true,
  format: "esm",
  target: ["chrome110", "firefox110", "safari16"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  external: ["/fonts/*"],
  metafile: true,
});
if (Object.keys(client.metafile.outputs).length === 0) throw new Error("client build produced nothing");

// Motion tokens live in tokens.json once; the stylesheet receives them as custom properties.
const root_vars = [
  `--ease:${tokens.ease}`,
  ...Object.entries(tokens.ms).map(([name, value]) => `--ms-${name}:${value}ms`),
].join(";");
const css = readFileSync(path.join(out, "assets/app.css"), "utf8");
writeFileSync(path.join(out, "assets/app.css"), `:root{${root_vars}}\n${css}`);

cpSync(path.join(root, "public/fonts"), path.join(out, "fonts"), { recursive: true });
writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f3ede2">
<title>Roundkeeper · Snug Thursday League</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="root"></div>
<div id="layers"></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`,
);
