import { config } from './config';
import { query, transaction } from './db';
import { recordAlert, sendRecordedAlert } from './repo/alerts';

const PASS_INTERVAL_MS = 2_000;

/** Persists lapses on the server's clock and sends one lapse warning per offer. */
const runPass = async (): Promise<void> => {
  await query(
    "UPDATE offer SET status = 'lapsed' WHERE status IN ('open','needs_reread') AND lapses_at <= now()",
  );

  const warnings = await transaction(async (tx) => {
    const due = await tx.query<{ id: string; car_id: string }>(
      `UPDATE offer SET lapsing_alerted = true
       WHERE status IN ('open','needs_reread')
         AND lapsing_alerted = false
         AND lapses_at > now()
         AND lapses_at - now() <= make_interval(secs => $1)
       RETURNING id, car_id`,
      [config.offerWarningSeconds],
    );
    const raised: string[] = [];
    for (const offer of due) raised.push(await recordAlert(tx, offer.car_id, 'offer_lapsing'));
    return raised;
  });

  for (const alertId of warnings) await sendRecordedAlert(alertId, 'offer_lapsing');
};

export const startBackgroundPass = (): void => {
  const tick = (): void => {
    runPass().catch((error) => console.error('The background pass failed', error));
  };
  setInterval(tick, PASS_INTERVAL_MS).unref();
  tick();
};
