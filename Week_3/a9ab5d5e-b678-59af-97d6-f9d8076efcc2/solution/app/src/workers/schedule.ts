/** Timings the brief fixes for background work, in one place. */

/** Every process runs the relay, the sweep and the record worker at least this often. */
export const WORKER_INTERVAL_MS = 2000;

/** A claim holds its row this long before another process may take it over. */
export const LEASE_SECONDS = 30;

/** A failed hand-off is retried after this delay... */
export const RETRY_DELAY_SECONDS = 2;

/** ...and the process that failed leaves the row alone for this long. */
export const FAILING_PROCESS_WAIT_MS = 6000;

/** How many due rows one pass of a worker takes. */
export const PASS_LIMIT = 20;
