import { pool } from './db.mjs';

let started = false;

/**
 * Move generations along on their own, whether or not any browser is open:
 * Queued becomes Rendering within two seconds of the start, and Rendering
 * becomes Ready at least eight and at most thirty seconds after the start.
 */
export function startScheduler() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await pool.query(
        `UPDATE generations SET status = 'rendering', render_started_at = NOW()
          WHERE status = 'queued' AND created_at < NOW() - INTERVAL '1500 milliseconds'`);
      await pool.query(
        `UPDATE generations SET status = 'ready', finished_at = NOW()
          WHERE status = 'rendering'
            AND COALESCE(render_started_at, created_at) < NOW() - INTERVAL '10 seconds'`);
    } catch (e) {
      console.log(`[scheduler] ${e.message}`);
    }
  };
  setInterval(tick, 1000).unref();
}
