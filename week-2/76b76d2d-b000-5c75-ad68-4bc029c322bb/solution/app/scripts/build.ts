import { build } from "esbuild";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const publicDir = join(dist, "public");

const fonts = [
  "instrument-serif-latin-400-normal.woff2",
  "instrument-serif-latin-400-italic.woff2",
  "inter-latin-400-normal.woff2",
  "inter-latin-600-normal.woff2",
  "ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-500-normal.woff2",
] as const;

await rm(dist, { recursive: true, force: true });
await mkdir(join(publicDir, "fonts"), { recursive: true });

await build({
  entryPoints: [join(root, "src/server/main.ts")],
  outfile: join(dist, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});

const client = await build({
  entryPoints: { app: join(root, "src/client/main.tsx"), styles: join(root, "src/client/styles.css") },
  outdir: join(publicDir, "assets"),
  entryNames: "[name]-[hash]",
  bundle: true,
  minify: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  jsx: "automatic",
  jsxImportSource: "preact",
  external: ["/fonts/*"],
  metafile: true,
  logLevel: "warning",
});

for (const file of fonts) {
  await copyFile(join(root, "src/client/fonts", file), join(publicDir, "fonts", file));
}

const outputs = Object.keys(client.metafile.outputs).map((path) => path.slice(path.indexOf("/assets/")));
const script = outputs.find((path) => path.endsWith(".js"));
const style = outputs.find((path) => path.endsWith(".css") && path.includes("styles-"));
if (!script || !style) throw new Error("client build produced no bundle");
await writeFile(join(dist, "manifest.json"), JSON.stringify({ script, style, fonts: fonts.map((file) => `/fonts/${file}`) }));
console.log("built", (await readdir(join(publicDir, "assets"))).join(", "));
