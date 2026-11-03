// Bundles the client into dist/client: one script, one stylesheet, the fonts and the shell.
import { build } from "esbuild";
import { cp, mkdir, copyFile } from "node:fs/promises";

const out = new URL("../dist/client/", import.meta.url);
await mkdir(new URL("assets/", out), { recursive: true });
await build({
  entryPoints: [new URL("../client/main.ts", import.meta.url).pathname],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: new URL("assets/app.js", out).pathname,
  logLevel: "warning",
});
await copyFile(new URL("../client/styles.css", import.meta.url), new URL("assets/app.css", out));
await copyFile(new URL("../client/index.html", import.meta.url), new URL("index.html", out));
await cp(new URL("../client/fonts/", import.meta.url), new URL("fonts/", out), { recursive: true });
