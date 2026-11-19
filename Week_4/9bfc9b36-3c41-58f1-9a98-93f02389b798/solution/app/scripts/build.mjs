import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const assets = path.join(dist, "public", "assets");

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

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

const client = await build({
  entryPoints: { app: path.join(root, "src/client/main.tsx"), styles: path.join(root, "src/client/styles.css") },
  outdir: assets,
  entryNames: "[name]-[hash]",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  external: ["/assets/*"],
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "warning",
});

const outputs = Object.keys(client.metafile.outputs).map((file) => path.basename(file));
const script = outputs.find((name) => name.startsWith("app-") && name.endsWith(".js"));
const style = outputs.find((name) => name.startsWith("styles-") && name.endsWith(".css"));
await cp(path.join(root, "public", "fonts"), path.join(assets, "fonts"), { recursive: true });
const fonts = (await readdir(path.join(assets, "fonts"))).filter((name) => name.endsWith(".woff2"));
const preload = fonts.map((name) => `<link rel="preload" href="/assets/fonts/${name}" as="font" type="font/woff2" crossorigin>`).join("\n    ");
const html = (await readFile(path.join(root, "src/client/index.html"), "utf8"))
  .replace("%STYLE%", `/assets/${style}`)
  .replace("%SCRIPT%", `/assets/${script}`)
  .replace("%PRELOAD%", preload);
await writeFile(path.join(dist, "public", "index.html"), html);
