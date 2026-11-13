import { formatTimestamp } from '../shared/clock.js';
import type { ConflictReport, ObservationFieldName } from '../shared/types.js';

export interface FieldEditState {
  edited_at: Date;
  device: string;
  set_at_version: number;
}

export interface FieldDecision {
  apply: boolean;
  conflict: ConflictReport | null;
}

/**
 * The one place a field-level conflict is decided. An incoming value applies when
 * its edit time is the same as or later than the stored one. Only an edit by
 * another device is reported.
 */
export function decideField(
  field: ObservationFieldName,
  incomingEditedAt: Date,
  incomingDevice: string,
  stored: FieldEditState | undefined,
  baseVersion: number | null,
): FieldDecision {
  if (!stored) return { apply: true, conflict: null };
  const byAnotherDevice = stored.device !== incomingDevice;
  const report = (outcome: 'kept' | 'replaced'): ConflictReport => ({
    field,
    outcome,
    other_device: stored.device,
    other_edited_at: formatTimestamp(stored.edited_at),
  });

  if (incomingEditedAt.getTime() >= stored.edited_at.getTime()) {
    const replacedLaterEdit =
      byAnotherDevice && baseVersion !== null && stored.set_at_version > baseVersion;
    return { apply: true, conflict: replacedLaterEdit ? report('replaced') : null };
  }
  return { apply: false, conflict: byAnotherDevice ? report('kept') : null };
}

export type FieldEditMap = Map<ObservationFieldName, FieldEditState>;
