// The client build: bundle, icon sprite, schema and shell.

import { build } from "esbuild";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);

// Bundle the client with the shared modules.
const result = await build({
  entryPoints: [path.join(root, "src/client/main.ts")],
  bundle: true,
  format: "esm",
  minify: true,
  write: false,
  target: ["es2022", "chrome120", "firefox120", "safari17"],
  outdir: path.join(root, "public"),
  entryNames: "app",
  logLevel: "error",
});

const appJs = result.outputFiles[0];
writeFileSync(path.join(root, "public/app.js"), appJs.text);

// The schema, so a clean build produces a runnable dist.
mkdirSync(path.join(root, "dist/server"), { recursive: true });
copyFileSync(
  path.join(root, "src/server/schema.sql"),
  path.join(root, "dist/server/schema.sql")
);

// The icon sprite: every Lucide outline icon as one inline symbol sheet.
const icons = readdirSync(path.join(root, "public/icons")).filter((name) => name.endsWith(".svg"));
const symbols = icons
  .map((name) => {
    const text = readFileSync(path.join(root, "public/icons", name), "utf8")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<svg[^>]*>/, "")
      .replace(/<\/svg>/, "")
      .trim();
    return `<symbol id="icon-${name.replace(/\.svg$/, "")}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${text}</symbol>`;
  })
  .join("");

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`;

const css = readFileSync(path.join(root, "src/client/styles.css"), "utf8");
writeFileSync(path.join(root, "public/styles.css"), css);

const index = readFileSync(path.join(root, "src/client/index.template.html"), "utf8")
  .replace("<!--ICON_SPRITE-->", sprite);
writeFileSync(path.join(root, "public/index.html"), index);

console.log(`client built: ${appJs.text.length} bytes of script, ${symbols.length} bytes of sprite`);
