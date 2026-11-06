/** Kills every Promptside server copy, found by its command line. */
import { readdirSync, readFileSync } from "node:fs";

for (const d of readdirSync("/proc")) {
  if (!/^\d+$/.test(d)) continue;
  if (d === String(process.pid)) continue;
  try {
    const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8");
    if (cmd.includes("dist/server.js")) {
      try { process.kill(Number(d), "SIGKILL") } catch { /* already gone */ }
    }
  } catch { /* not readable */ }
}
