// The booking version (brief: Booking version). Each event raises the stored number by one; from the chart instant
// the reported number already counts the chart, and the chart job later records that same step.

export function reportedVersion(stored: number, chartDue: boolean, chartRecorded: boolean): number {
  return stored + (chartDue && !chartRecorded ? 1 : 0);
}

/** One step per event, however many fields the event changes. */
export const VERSION_STEP = 1;
