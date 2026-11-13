// Build the browser bundle with esbuild. The server serves it from /assets/app.js.
const { build } = require("esbuild");
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const outdir = path.join(root, "dist", "front");
fs.mkdirSync(outdir, { recursive: true });

const sharedDir = path.join(root, "src", "shared");

build({
  entryPoints: [path.join(root, "src", "front", "main.ts")],
  bundle: true,
  format: "iife",
  target: ["chrome119", "firefox121", "safari17.4"],
  outfile: path.join(outdir, "app.js"),
  minify: true,
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
})
  .then(() => {
    const bytes = fs.statSync(path.join(outdir, "app.js")).size;
    console.log(`front bundle: ${bytes} bytes`);
  })
  .catch(() => process.exit(1));
