import { build } from "esbuild";
import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const pub = join(dist, "public");

const only = process.argv.includes("--client") ? "client" : process.argv.includes("--server") ? "server" : "both";

if (only === "both") await rm(dist, { recursive: true, force: true });

if (only !== "client") {
  await build({
    entryPoints: [join(root, "src/server/main.ts")],
    outfile: join(dist, "server.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    packages: "external",
    sourcemap: false,
  });
}

if (only !== "server") {
  await rm(pub, { recursive: true, force: true });
  await mkdir(join(pub, "assets"), { recursive: true });
  await build({
    entryPoints: [join(root, "src/client/main.tsx")],
    outfile: join(pub, "assets/app.js"),
    bundle: true,
    platform: "browser",
    target: ["chrome120", "firefox120", "safari17"],
    format: "esm",
    minify: true,
    sourcemap: false,
    jsx: "automatic",
    external: ["/fonts/*"],
  loader: { ".svg": "dataurl" },
    assetNames: "[name]-[hash]",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await cp(join(root, "src/client/index.html"), join(pub, "index.html"));
  for (const name of await readdir(join(root, "public"))) {
    await cp(join(root, "public", name), join(pub, name), { recursive: true });
  }
}
