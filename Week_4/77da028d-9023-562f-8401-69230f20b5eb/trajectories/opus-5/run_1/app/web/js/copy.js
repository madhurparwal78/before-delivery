/* Published copy that more than one screen prints, kept in one place. */

export const UNSENT_PUSH = 'Push not sent yet. Darkframe will retry.';

export function staleWarningFor(maxAgeDays) {
  return (
    `Warning: this set is older than ${maxAgeDays} days. It still calibrates, ` +
    'but consider a fresh library.'
  );
}
