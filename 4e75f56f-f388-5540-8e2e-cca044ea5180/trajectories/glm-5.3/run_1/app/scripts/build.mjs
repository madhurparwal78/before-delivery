import { build } from "esbuild";
import { mkdirSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

mkdirSync(join(dist, "public"), { recursive: true });

const serverDir = join(root, "src/server");
const serverEntries = readdirSync(serverDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(serverDir, f));

await build({
  entryPoints: [join(root, "src/client/main.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: join(dist, "public/app.js"),
  loader: { ".woff2": "file" },
  assetNames: "assets/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"' },
});

await build({
  entryPoints: serverEntries,
  bundle: false,
  platform: "node",
  format: "esm",
  outdir: join(dist, "server"),
  packages: "external",
  outExtension: { ".js": ".js" },
});

for (const f of ["index.html", "styles.css"]) {
  copyFileSync(join(root, "src/client", f), join(dist, "public", f));
}

for (const fontSource of ["@fontsource/bodoni-moda", "@fontsource/instrument-sans"]) {
  const files = readdirSync(join(root, "node_modules", fontSource, "files"));
  for (const f of files) {
    if (f.endsWith(".woff2") && f.includes("normal") && !f.includes("italic")) {
      copyFileSync(join(root, "node_modules", fontSource, "files", f), join(dist, "public", f));
    }
  }
}

if (!existsSync(join(dist, "public", "app.js"))) throw new Error("bundle missing");
console.log("build done");
