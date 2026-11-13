import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const prod = process.env.NODE_ENV !== "watch";

const client = {
  entryPoints: ["src/client/boot.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome124", "firefox125", "safari17"],
  outfile: "dist/client.js",
  minify: prod,
  legalComments: "none",
  sourcemap: false,
  define: {
    "process.env.KIP_MAP_DEBOUNCE_MS": JSON.stringify(process.env.KIP_MAP_DEBOUNCE_MS ?? "400"),
    "process.env.KIP_TYPE_DEBOUNCE_MS": JSON.stringify(process.env.KIP_TYPE_DEBOUNCE_MS ?? "200"),
    "process.env.KIP_TOAST_MS": JSON.stringify(process.env.KIP_TOAST_MS ?? "5000")
  }
};

const server = {
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "dist/server.js",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  external: ["pg", "pg-native"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  }
};

await rm("dist", { recursive: true, force: true });
await Promise.all([build(client), build(server)]);
if (!existsSync("dist/server.js") || !existsSync("dist/client.js")) throw new Error("build failed");
await mkdir("dist/public/fonts", { recursive: true });
await mkdir("dist/public/images", { recursive: true });
await cp("src/public/fonts", "dist/public/fonts", { recursive: true });
await cp("src/public/images", "dist/public/images", { recursive: true });
await cp("src/public/css", "dist/public/css", { recursive: true });
await cp("src/public/index.html", "dist/public/index.html");
console.log("build ok");
