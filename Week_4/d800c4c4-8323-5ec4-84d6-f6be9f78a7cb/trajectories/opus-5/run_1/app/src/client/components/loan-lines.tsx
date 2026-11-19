import { overdueLine } from '../../shared/format';
import type { Loan } from '../../shared/types';

/**
 * The overdue line is built only from the figures the API returns. The browser
 * never counts days or works out money from its own clock.
 */
export function OverdueLine({ loan }: { readonly loan: Loan }): JSX.Element | null {
  if (
    loan.status !== 'out' ||
    loan.open_days_late === null ||
    loan.open_days_late <= 0 ||
    loan.late_fee_so_far_cents === null
  ) {
    return null;
  }
  return (
    <span className="overdue numerals">
      {overdueLine(loan.open_days_late, loan.late_fee_so_far_cents)}
    </span>
  );
}

export function DueLine({ loan }: { readonly loan: Loan }): JSX.Element | null {
  if (loan.due_date === null) return null;
  return (
    <span className="due-line">
      <span className="numerals">
        Due {loan.due_date} by {loan.due_by ?? ''}
      </span>{' '}
      <OverdueLine loan={loan} />
    </span>
  );
}
