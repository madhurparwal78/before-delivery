import { startServer } from "./http";
import { waitForDatabase } from "./db";
import { startIndexer } from "./indexer";
import { startLiveHub } from "./live";
import { startNotifier } from "./notifications";
import { applySchemaAndSeed } from "./seed";
import { lapseExpiredHolds } from "./stock";

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchemaAndSeed();
  startIndexer();
  startNotifier();
  startLiveHub();
  setInterval(() => void lapseExpiredHolds().catch(() => undefined), 5000);
  startServer();
}

main().catch((failure) => {
  console.error("startup failed", failure instanceof Error ? failure.message : failure);
  process.exit(1);
});
