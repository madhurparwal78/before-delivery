// Build: type-check and compile the server, bundle the browser entries, and assemble dist/public.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules/typescript/bin/tsc");

function run(args) {
  const result = spawnSync(process.execPath, [tsc, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(join(root, "dist"), { recursive: true, force: true });
run(["-p", "tsconfig.json"]);
run(["-p", "tsconfig.client.json"]);

const entries = readdirSync(join(root, "src/client/entries")).filter((name) => name.endsWith(".ts"));
await build({
  entryPoints: entries.map((name) => join(root, "src/client/entries", name)),
  outdir: join(root, "dist/public"),
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "none",
});

// Static files: copy, expanding the breakpoint placeholders in stylesheets from the one breakpoint definition.
const breakpoints = JSON.parse(readFileSync(join(root, "src/shared/breakpoints.json"), "utf8"));
const publicOut = join(root, "dist/public");
mkdirSync(publicOut, { recursive: true });
cpSync(join(root, "public"), publicOut, { recursive: true });
function expand(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) expand(path);
    else if (name.endsWith(".css")) {
      let css = readFileSync(path, "utf8");
      css = css.replace(/\{\{rail-inline\}\}/g, `${breakpoints.railInline}px`)
        .replace(/\{\{cards-two-across\}\}/g, `${breakpoints.cardsTwoAcross}px`)
        .replace(/\{\{cards-two-across-below\}\}/g, `${breakpoints.cardsTwoAcross - 1}px`)
        .replace(/\{\{compact\}\}/g, `${breakpoints.compact}px`)
        .replace(/\{\{compact-below\}\}/g, `${breakpoints.compact - 1}px`);
      writeFileSync(path, css);
    }
  }
}
expand(join(publicOut, "css"));
