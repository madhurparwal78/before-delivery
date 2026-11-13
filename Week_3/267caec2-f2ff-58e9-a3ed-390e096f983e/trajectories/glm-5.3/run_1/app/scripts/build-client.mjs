import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;
const out = `${root}dist/client`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [`${root}src/client/main.ts`],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  outfile: `${out}/app.js`,
  sourcemap: false,
  logLevel: "info",
});

await cp(`${root}src/client/styles.css`, `${out}/styles.css`);
await cp(`${root}src/client/index.html`, `${out}/index.html`);
await cp(`${root}assets`, `${out}/assets`, { recursive: true });
console.log("client built");
