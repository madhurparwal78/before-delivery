import { build } from "esbuild";
import { mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";

await rm("web/dist", { recursive: true, force: true });
await mkdir("web/dist/assets", { recursive: true });

await build({
  entryPoints: ["web/src/main.tsx"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  outdir: "web/dist/assets",
  entryNames: "app-[hash]",
  assetNames: "[name]-[hash]",
  loader: { ".woff2": "file", ".woff": "file" },
  legalComments: "none",
  logLevel: "warning",
});

const files = await readdir("web/dist/assets");
const js = files.find((f) => f.endsWith(".js"));
const css = files.find((f) => f.endsWith(".css"));
const fonts = files.filter((f) => f.endsWith(".woff2") && /latin-wght-normal/.test(f));
let html = await readFile("web/index.html", "utf8");
html = html
  .replace("<!--css-->", `<link rel="stylesheet" href="/assets/${css}">`)
  .replace("<!--js-->", `<script type="module" src="/assets/${js}"></script>`)
  .replace("<!--preload-->", fonts.map((f) => `<link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin>`).join("\n    "));
await writeFile("web/dist/index.html", html);
