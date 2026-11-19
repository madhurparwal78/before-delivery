// Serve the app on 0.0.0.0:${APP_PUBLIC_PORT:-4173}.
// dist/ is built by `npm run build`; this script only starts the server.
const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
process.env.APP_PUBLIC_PORT = String(port);
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { cpSync } from "node:fs";
try { cpSync("static", "dist/static", { recursive: true }); } catch {}
try { cpSync("src/server/schema.sql", "dist/schema.sql"); } catch {}
if (!existsSync("dist/main.js")) {
  // Pre-compile out-of-band if the build output is missing (fresh clone).
  const tsc = spawn("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"], { stdio: "inherit" });
  tsc.on("exit", (code) => {
    if (code === 0) start();
    else process.exit(code ?? 1);
  });
} else {
  start();
}

function start() {
  const child = spawn(process.execPath, ["dist/main.js"], { stdio: "inherit", env: process.env });
  const kill = () => child.kill("SIGTERM");
  process.on("SIGTERM", kill);
  process.on("SIGINT", kill);
  child.on("exit", (c) => process.exit(c ?? 0));
}
