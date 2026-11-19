/** The one delivery-state chip derivation for a person's own message. */
export type DeliveryChip =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'sent' }
  | { state: 'delivered' }
  | { state: 'read'; count: number };

export function chipForCounts(deliveredCount: number, readCount: number): DeliveryChip {
  if (readCount > 0) return { state: 'read', count: readCount };
  if (deliveredCount > 0) return { state: 'delivered' };
  return { state: 'sent' };
}

export function chipLabel(chip: DeliveryChip): string {
  switch (chip.state) {
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    case 'sent':
      return 'Sent';
    case 'delivered':
      return 'Delivered';
    case 'read':
      return `Read · ${chip.count}`;
  }
}
