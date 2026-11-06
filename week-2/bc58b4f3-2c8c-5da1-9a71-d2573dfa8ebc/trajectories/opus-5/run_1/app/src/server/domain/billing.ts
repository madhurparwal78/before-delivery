import type { ChargeKind } from '../../shared/contract.js';
import type { AssignmentRecord } from './records.js';

/** Verified work bills as a service; a cancellation bills only when it carried a fee. */
export function billableKindOf(record: AssignmentRecord): ChargeKind | null {
  if (record.status === 'verified' || record.status === 'invoiced') {
    return 'service';
  }
  if (record.status === 'cancelled' && record.fee_applies === true) {
    return 'late_cancellation';
  }
  return null;
}

export function chargeDescriptionOf(number: string, kind: ChargeKind): string {
  return kind === 'service' ? `${number} service` : `${number} late cancellation`;
}
