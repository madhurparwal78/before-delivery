import { build } from "esbuild";
import { build as buildClient } from "vite";

await buildClient({ configFile: "vite.config.ts" });
await build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/server.cjs",
  external: ["pg-native"],
  logLevel: "info",
});
