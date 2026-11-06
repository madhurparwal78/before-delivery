import esbuild from "esbuild";
import { readdirSync, statSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const clientSrc = join(root, "src/client");
const out = join(root, "public");
const fontsOut = join(out, "fonts");
mkdirSync(fontsOut, { recursive: true });

await esbuild.build({
  entryPoints: [join(clientSrc, "main.ts")],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: "es2022",
  outfile: join(out, "app.js"),
  loader: { ".ts": "ts", ".tsx": "tsx" },
  legalComments: "none",
});

for (const f of readdirSync(join(root, "fonts"))) {
  if (f.endsWith(".woff2")) copyFileSync(join(root, "fonts", f), join(fontsOut, f));
}
for (const f of ["index.html"]) {
  copyFileSync(join(root, f), join(out, f));
}
for (const f of readdirSync(join(root, "client-static"))) {
  const from = join(root, "client-static", f);
  if (statSync(from).isFile()) copyFileSync(from, join(out, f));
}
console.log("client built");
