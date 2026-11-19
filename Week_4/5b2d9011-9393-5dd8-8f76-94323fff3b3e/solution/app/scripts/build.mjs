// Bundles the frontend into web/dist, which the Go binary embeds.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

rmSync("web/dist", { recursive: true, force: true });
mkdirSync("web/dist/assets", { recursive: true });

const result = await build({
  entryPoints: { app: "src/main.ts", styles: "src/styles.css" },
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outdir: "web/dist/assets",
  entryNames: "[name]-[hash]",
  external: ["/fonts/*"],
  metafile: true,
  legalComments: "none",
  logLevel: "warning",
});

const outputs = Object.keys(result.metafile.outputs).map((p) => p.replace(/^web\/dist/, ""));
const script = outputs.find((p) => p.endsWith(".js"));
const style = outputs.find((p) => p.endsWith(".css"));
cpSync("public/fonts", "web/dist/fonts", { recursive: true });
const html = readFileSync("index.html", "utf8").replace("%STYLE%", style).replace("%SCRIPT%", script);
writeFileSync("web/dist/index.html", html);
