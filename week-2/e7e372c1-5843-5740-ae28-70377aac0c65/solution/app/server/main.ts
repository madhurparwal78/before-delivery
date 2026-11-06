import { createApp } from "./app.ts";
import { startBackground } from "./background.ts";
import { loadCalendar } from "./calendar.ts";
import { loadConfig } from "./config.ts";
import { database, openPool } from "./db.ts";
import { prepareDatabase } from "./seed.ts";
import { SESSION_SECRET, TICK_SECRET, secretValue } from "./secrets.ts";
import { configureSessions } from "./sessions.ts";
import { loadStaticFiles } from "./staticFiles.ts";
import { startTapePlayer } from "./tape.ts";
import { configureTicks } from "./ticks.ts";
import { configureVault, probeVault } from "./vault.ts";

async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await database().query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("database is not reachable");
}

async function main(): Promise<void> {
  const config = loadConfig();
  openPool(config.databaseUrl);
  configureVault(config.vault);
  await waitForDatabase();
  await prepareDatabase();
  await loadCalendar(database());
  configureSessions(await secretValue(database(), SESSION_SECRET), config.staffSessionIdleSeconds);
  configureTicks(await secretValue(database(), TICK_SECRET));
  loadStaticFiles();
  await probeVault();
  createApp(config).listen(config.port, "0.0.0.0");
  await startBackground();
  startTapePlayer();
}

main().catch((error: unknown) => {
  process.stderr.write(`startup failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
});
