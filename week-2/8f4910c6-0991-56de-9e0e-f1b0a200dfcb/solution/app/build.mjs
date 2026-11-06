// Bundles the server (dist/server.mjs) and the browser app (dist/public) with esbuild.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const root = new URL(".", import.meta.url).pathname;

await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist/public/assets`, { recursive: true });

await build({
  entryPoints: [`${root}src/server/main.ts`],
  outfile: `${root}dist/server.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});

await build({
  entryPoints: { app: `${root}src/client/main.tsx`, styles: `${root}src/client/styles/app.css` },
  outdir: `${root}dist/public/assets`,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  jsx: "automatic",
  minify: true,
  loader: { ".woff2": "file" },
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

await cp(`${root}public`, `${root}dist/public`, { recursive: true });
await cp(`${root}src/client/index.html`, `${root}dist/public/index.html`);
