import { build } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";

const out = "dist/public";
await rm("dist", { recursive: true, force: true });
await mkdir(`${out}/assets/fonts`, { recursive: true });
await build({
  entryPoints: { app: "web/src/main.tsx", styles: "web/src/styles.css" },
  outdir: `${out}/assets`,
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  external: ["/assets/*"],
  legalComments: "none",
  logLevel: "warning",
});
await cp("web/fonts", `${out}/assets/fonts`, { recursive: true });
const shell = await readFile("web/index.html", "utf8");
await writeFile(`${out}/index.html`, shell);
