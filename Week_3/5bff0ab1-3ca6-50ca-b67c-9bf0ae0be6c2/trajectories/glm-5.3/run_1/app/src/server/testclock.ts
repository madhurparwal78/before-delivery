// The test clock: sets the app clock and applies everything due at that instant.
// The reply comes only after expiries, ledger trims, price steps and sequence
// changes due at that instant are applied.
import { setAppClock, appNowMs } from "./clock";
import { pool } from "./db";
import { runSweepOnce } from "./sweep";

export async function applyTestClock(atMs: number, freeze: boolean): Promise<number> {
  // Persist the bias so every copy of the server on this database agrees, and the
  // frozen instant with it.
  await pool.query(
    `INSERT INTO app_state (key, value) VALUES ('clock_bias_ms', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [String(atMs - Date.now())]
  );
  if (freeze) {
    await pool.query(
      `INSERT INTO app_state (key, value) VALUES ('clock_frozen_ms', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(atMs)]
    );
  } else {
    await pool.query(`DELETE FROM app_state WHERE key = 'clock_frozen_ms'`, []);
  }
  setAppClock(atMs, freeze);
  await runSweepOnce();
  return appNowMs();
}
