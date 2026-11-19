import type { ReactNode } from 'react';
import { formatMoney } from '../../shared/money';
import { Dialog } from './Dialog';

interface ExchangeDialogProps {
  readonly oldLabel: string;
  readonly newLabel: string;
  readonly differenceCents: number;
  readonly pending: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function differenceLine(differenceCents: number): string {
  if (differenceCents > 0) return `You pay ${formatMoney(differenceCents)}`;
  if (differenceCents < 0) return `We refund ${formatMoney(-differenceCents)}`;
  return 'No price difference';
}

export function ExchangeDialog({
  oldLabel,
  newLabel,
  differenceCents,
  pending,
  onConfirm,
  onClose,
}: ExchangeDialogProps): ReactNode {
  return (
    <Dialog title="Confirm exchange" closable={!pending} onClose={onClose}>
      <h2>Confirm exchange</h2>
      <dl className="ledger">
        <div>
          <dt>Old seat</dt>
          <dd>{oldLabel}</dd>
        </div>
        <div>
          <dt>New seat</dt>
          <dd>{newLabel}</dd>
        </div>
        <div className="ledger-total">
          <dt>Difference</dt>
          <dd className="figures">{differenceLine(differenceCents)}</dd>
        </div>
      </dl>
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={onConfirm} disabled={pending}>
          {pending ? 'Confirming exchange' : 'Confirm exchange'}
        </button>
        <button type="button" onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
