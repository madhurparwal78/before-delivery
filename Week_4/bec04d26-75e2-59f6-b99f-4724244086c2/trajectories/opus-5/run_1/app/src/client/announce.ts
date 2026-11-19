export interface Line {
  text: string;
  priority: number;
  order?: number;
}

/** Announcement priorities, highest first, matching the server's order. */
export const PRIORITY = {
  conflict: 1,
  field_error: 2,
  extension_refused: 3,
  status_saved: 4,
  amounts_saved: 5,
  extension_granted: 6,
  band_opened: 7,
  own_action: 8,
  approval_seen: 9,
  went_overdue: 10,
  packet_ready: 11,
  reminder_sent: 12,
  banner: 13,
} as const;

/**
 * Writes a batch lowest priority first, so the highest-priority line is the
 * one that stays. Equal priorities keep their given order.
 */
export function orderLines(lines: readonly Line[]): Line[] {
  return [...lines].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}
