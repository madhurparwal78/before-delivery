import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
rmSync(path.join(root, "dist"), { recursive: true, force: true });
mkdirSync(path.join(root, "dist"), { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
  packages: "external",
  minify: false,
};

const server = await build({
  ...common,
  entryPoints: [path.join(root, "src/server/api.ts")],
  outfile: path.join(root, "dist/server.js"),
  external: ["pg", "pg-native"],
  banner: {
    js: [
      "import { createRequire } from 'node:module';",
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
});

const client = await build({
  ...common,
  entryPoints: [path.join(root, "src/client/console.ts")],
  outfile: path.join(root, "public/assets/console.js"),
  platform: "browser",
  packages: "bundle",
  minify: true,
});

console.log("built server and client");
console.log("server metafile:", !!server);
console.log("client metafile:", !!client);
