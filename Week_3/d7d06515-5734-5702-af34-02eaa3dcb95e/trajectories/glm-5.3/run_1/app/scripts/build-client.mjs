import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const outdir = path.resolve(root, "dist/client");
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
    app: path.resolve(root, "src/client/main.tsx"),
    style: path.resolve(root, "src/client/style.css"),
  },
  publicPath: "/",
  external: [],
  outdir,
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  loader: { ".woff2": "file", ".svg": "file", ".ttf": "file" },
  assetNames: "assets/[name]-[hash]",
  minify: true,
  metafile: false,
  define: { "process.env.NODE_ENV": '"production"' },
});

const html = fs
  .readFileSync(path.resolve(root, "src/client/index.html"), "utf8")
  .replace("{{STYLE}}", "/style.css")
  .replace("{{APP}}", "/app.js");
fs.writeFileSync(path.join(outdir, "index.html"), html);
for (const dir of ["brand", "fonts"]) {
  fs.cpSync(path.resolve(root, "src/client", dir), path.join(outdir, dir), { recursive: true });
}
fs.copyFileSync(path.resolve(root, "src/client/fonts/OFL.txt"), path.join(outdir, "fonts", "OFL.txt"));
for (const page of ["reference.html", "shortcuts.html"]) {
  fs.copyFileSync(path.resolve(root, "src/client", page), path.join(outdir, page));
}
console.log("client built to", outdir);
