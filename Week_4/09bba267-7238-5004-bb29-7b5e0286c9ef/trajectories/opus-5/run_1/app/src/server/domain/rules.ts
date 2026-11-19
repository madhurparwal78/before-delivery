/**
 * The SQL that decides the time and seat-state rules of the brief. Every query that needs one of
 * them uses the fragment from here, so each rule is written once.
 *
 * `p` is a row of `performances` and `s` a row of `seats`.
 */

/** Sales close at the start instant. */
export const SALES_OPEN_SQL = 'p.starts_at > now()';

/** Exchanges and refunds close 24 hours before the start instant. */
export const CHANGES_OPEN_SQL = "p.starts_at - interval '24 hours' > now()";

/**
 * A hold counts as released from its expiry instant, whatever has or has not been swept yet.
 * A seat whose payment is waiting for Kill Bill keeps its hold until that answer arrives.
 */
export const EFFECTIVE_SEAT_STATE_SQL = `case
  when s.state = 'held' and s.hold_expires_at <= now() and s.pending_order_id is null then 'on_sale'
  else s.state end`;
