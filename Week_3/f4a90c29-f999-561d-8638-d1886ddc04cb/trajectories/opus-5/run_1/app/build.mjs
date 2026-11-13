import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const out = "web/dist";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: ["web/src/main.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  sourcemap: false,
  outfile: `${out}/app.js`,
});

await cp("web/index.html", `${out}/index.html`);
await cp("web/styles.css", `${out}/styles.css`);
await cp("web/fonts", `${out}/fonts`, { recursive: true });
