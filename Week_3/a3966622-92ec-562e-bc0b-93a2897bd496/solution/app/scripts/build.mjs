// Bundles the server (Node) and the browser client, and copies the self-hosted fonts.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const client = path.join(dist, "client");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(client, "fonts"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src/server/main.ts")],
  outfile: path.join(dist, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});

const result = await build({
  entryPoints: { app: path.join(root, "src/client/main.tsx") },
  outdir: path.join(client, "assets"),
  entryNames: "[name]-[hash]",
  bundle: true,
  minify: true,
  format: "esm",
  target: ["chrome120", "firefox121", "safari17"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "css" },
  external: ["/fonts/*"],
  metafile: true,
  logLevel: "warning",
});

// Fonts are vendored from Fontsource under public/fonts (see assets.json and THIRD_PARTY_NOTICES.md).
await cp(path.join(root, "public", "fonts"), path.join(client, "fonts"), { recursive: true });

const outputs = Object.keys(result.metafile.outputs).map((p) => "/" + path.relative(client, path.resolve(root, p)));
const script = outputs.find((p) => p.endsWith(".js"));
const style = outputs.find((p) => p.endsWith(".css"));
const template = await readFile(path.join(root, "src/client/index.html"), "utf8");
const html = template.replace("%STYLE%", style).replace("%SCRIPT%", script);
await writeFile(path.join(client, "index.html"), html);
