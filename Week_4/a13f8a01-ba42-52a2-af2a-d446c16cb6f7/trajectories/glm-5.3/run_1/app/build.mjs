import { build } from "esbuild";
import { mkdirSync, copyFileSync, readdirSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
mkdirSync("dist/assets", { recursive: true });

// Server: bundled to one file, Node platform, npm packages left external.
await build({
  entryPoints: ["src/server/server.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/server.js",
  packages: "external",
  sourcemap: false,
  legalComments: "none",
});

// Preview harness: served as plain JS inside the sandboxed iframe.
await build({
  entryPoints: ["src/server/harness.ts"],
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "iife",
  outfile: "dist/harness.js",
  sourcemap: false,
  legalComments: "none",
});

// Client app.
await build({
  entryPoints: ["src/client/main.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  outfile: "dist/assets/app.js",
  sourcemap: false,
  legalComments: "none",
  minify: true,
});

// Client styles: esbuild inlines the @imports; font URLs stay as written.
const keepAbsoluteUrls = {
  name: "keep-absolute-urls",
  setup(b) {
    b.onResolve({ filter: /^\// }, (args) => ({ path: args.path, external: true }));
  },
};
await build({
  entryPoints: ["src/client/styles/base.css"],
  bundle: true,
  outfile: "dist/assets/app.css",
  sourcemap: false,
  minify: true,
  plugins: [keepAbsoluteUrls],
});

// Runtime assets the server reads from disk.
mkdirSync("dist/client/public", { recursive: true });
for (const f of readdirSync("src/client/public")) {
  copyFileSync(`src/client/public/${f}`, `dist/client/public/${f}`);
}
mkdirSync("dist/assets/fonts", { recursive: true });
for (const f of readdirSync("src/seed/fonts")) {
  copyFileSync(`src/seed/fonts/${f}`, `dist/assets/fonts/${f}`);
}
mkdirSync("dist/shelf", { recursive: true });
for (const f of readdirSync("src/seed/shelf")) {
  copyFileSync(`src/seed/shelf/${f}`, `dist/shelf/${f}`);
}
mkdirSync("dist/starters", { recursive: true });
for (const dir of ["courses", "grid", "type", "physics"]) {
  mkdirSync(`dist/starters/${dir}`, { recursive: true });
  for (const f of ["index.html", "style.css", "script.js"]) {
    copyFileSync(`src/seed/starters/${dir}/${f}`, `dist/starters/${dir}/${f}`);
  }
}
writeFileSync("dist/built.txt", new Date().toISOString());
console.log("build done");
