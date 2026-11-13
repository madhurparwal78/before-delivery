// Scoped labels (see "Issues, labels and planning"): the one rule for what counts as `key::value`, used by the server and the chip.

/** The key of a scoped label: everything before the last `::`, or null for an ordinary label. */
export function scopedKey(label: string): string | null {
  const at = label.lastIndexOf("::");
  return at > 0 && at + 2 < label.length ? label.slice(0, at) : null;
}
