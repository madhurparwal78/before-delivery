import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const srcDir = join(root, "src");
const distDir = join(root, "dist");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(join(distDir, "client"), { recursive: true });
mkdirSync(join(distDir, "assets", "fonts"), { recursive: true });

function* walk(p) {
  for (const e of readdirSync(p)) {
    const f = join(p, e);
    if (statSync(f).isDirectory()) yield* walk(f);
    else yield f;
  }
}

// Server and shared: one output file per input, ESM for Node.
const serverFiles = [
  ...[...walk(join(srcDir, "server"))].filter((f) => f.endsWith(".ts")),
  ...[...walk(join(srcDir, "shared"))].filter((f) => f.endsWith(".ts")),
];
for (const f of serverFiles) {
  const rel = f.slice(srcDir.length + 1);
  await build({
    entryPoints: [f],
    outfile: join(distDir, rel.replace(/\.ts$/, ".js")),
    platform: "node",
    format: "esm",
    target: "es2022",
    packages: "external",
    legalComments: "none",
    sourcemap: false,
    logLevel: "error",
  });
}

// Client: one bundle per page.
const pages = readdirSync(join(srcDir, "client", "pages")).filter((f) => f.endsWith(".ts"));
const cssFiles = [...walk(join(srcDir, "client"))].filter((f) => f.endsWith(".css"));
let css = "";
for (const f of cssFiles) css += readFileSync(f, "utf8") + "\n";

for (const page of pages) {
  const res = await build({
    entryPoints: [join(srcDir, "client", "pages", page)],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    minify: true,
    legalComments: "none",
    outdir: "/out",
    logLevel: "error",
  });
  const code = res.outputFiles[0].text;
  const name = page.replace(/\.ts$/, "");
  writeFileSync(join(distDir, "client", `${name}.js`), code);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Due Coin</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/client/${name}.js"></script>
</body>
</html>
`;
  writeFileSync(join(distDir, "client", `${name}.html`), html);
}

writeFileSync(join(distDir, "app.css"), css);

// Assets: fonts and icons.
if (existsSync(join(root, "assets"))) {
  for (const f of [...walk(join(root, "assets"))]) {
    const rel = f.slice(join(root, "assets").length + 1);
    const target = join(distDir, "assets", rel);
    mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    copyFileSync(f, target);
  }
}

console.log(`built ${pages.length} client pages and ${serverFiles.length} server files`);
