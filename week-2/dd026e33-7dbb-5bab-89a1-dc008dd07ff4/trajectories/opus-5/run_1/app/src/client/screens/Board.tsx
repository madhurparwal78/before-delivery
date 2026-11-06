import { useRef, useState, type ReactNode } from 'react';
import type { BoardResponse, Invoice } from '../../shared/types';
import {
  IDEMPOTENCY_CONFLICT,
  NO_ANSWER,
  occupancyLine,
  outstandingLine,
  startupLabel,
  unpaidLine,
} from '../copy';
import { api, errorCode, fieldErrors } from '../lib/api';
import { useFirstLoad, useReread, useStatus, useSubmit, type StatusHandle } from '../lib/hooks';
import { Link } from '../lib/router';
import { Dialog } from '../components/Dialog';
import { FloorPlan } from '../components/FloorPlan';
import {
  AlertMark,
  ErrorSummary,
  FieldMessage,
  StatusRegion,
  type FieldError,
} from '../components/Status';

interface OpenTransfer {
  readonly invoiceId: string;
  readonly number: string;
  readonly balance: string;
}

export function BoardScreen(): ReactNode {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [transfer, setTransfer] = useState<OpenTransfer | null>(null);
  const invoiceStatus = useStatus();
  const unpaidHeading = useRef<HTMLHeadingElement | null>(null);

  const load = async (): Promise<void> => {
    const outcome = await api<BoardResponse>('/api/board');
    if (outcome.kind === 'ok') setBoard(outcome.body);
  };

  useFirstLoad(load);
  useReread(load, 10_000);

  if (board === null) return <p>Loading…</p>;

  const notLive = board.unpaid.invoices.filter((invoice) => !invoice.balance_live);
  const earliestConfirmed =
    notLive.length === 0
      ? null
      : notLive
          .map((invoice) => invoice.status_confirmed_at)
          .sort((left, right) => left.localeCompare(right))[0] ?? null;

  return (
    <div className="screen board-screen">
      <h1>Board</h1>
      <div className="three-panes">
        <section className="pane" aria-label="Occupancy">
          <h2 className="pane-heading">Occupancy</h2>
          <p className="mono">{occupancyLine(board.occupancy.occupied, board.occupancy.total)}</p>
          <FloorPlan bays={board.bays} mode="browse" onActivate={() => undefined} />
        </section>
        <section className="pane" aria-label="Overdue care">
          <h2 className="pane-heading">Overdue care</h2>
          <ul className="entry-list">
            {board.overdue.map((entry) => (
              <li key={entry.car.id}>
                <Link to={`/cars/${entry.car.id}`}>{entry.car.name}</Link>{' '}
                <span className="mono">{entry.bay_code}</span>{' '}
                <span className="chip chip-flag">{startupLabel(entry.startup)}</span>
              </li>
            ))}
            {board.overdue.length === 0 ? <li>No overdue start-ups.</li> : null}
          </ul>
        </section>
        <section className="pane" aria-label="Unpaid invoices">
          <h2 className="pane-heading" tabIndex={-1} ref={unpaidHeading}>
            Unpaid invoices
          </h2>
          <p className="unpaid-line">
            <AlertMark />
            <span className="mono">
              {unpaidLine(board.unpaid.total, board.unpaid.live, earliestConfirmed)}
            </span>
          </p>
          <ul className="entry-list">
            {board.unpaid.invoices.map((invoice) => (
              <li key={invoice.id}>
                <span className="mono">{invoice.number}</span> <span>{invoice.car.name}</span>
                <span className="mono">
                  <span className="label">Outstanding</span> {outstandingLine(invoice)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setTransfer({
                      invoiceId: invoice.id,
                      number: invoice.number,
                      balance: invoice.balance,
                    })
                  }
                >
                  {`Record bank transfer for ${invoice.number}`}
                </button>
              </li>
            ))}
            {board.unpaid.invoices.length === 0 ? <li>Every invoice is paid.</li> : null}
          </ul>
        </section>
      </div>
      {transfer === null ? null : (
        <TransferDialog
          key={transfer.invoiceId}
          open={transfer}
          status={invoiceStatus}
          onClose={() => setTransfer(null)}
          onDone={() => {
            setTransfer(null);
            void load();
          }}
          fallbackFocus={() => unpaidHeading.current}
        />
      )}
      <StatusRegion name="Invoice updates" status={invoiceStatus} />
    </div>
  );
}

function TransferDialog({
  open,
  status,
  onClose,
  onDone,
  fallbackFocus,
}: {
  open: OpenTransfer;
  status: StatusHandle;
  onClose: () => void;
  onDone: () => void;
  fallbackFocus: () => HTMLElement | null;
}): ReactNode {
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState(open.balance);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = useSubmit<{ invoice: Invoice }>({
    status,
    pendingText: 'Recording transfer...',
    idempotent: true,
    noAnswerText: NO_ANSWER.recordTransfer,
    onOk: (body) => {
      if (body.invoice.status === 'paid') {
        status.success(`Invoice ${body.invoice.number} is paid.`);
      } else {
        status.success(
          `Payment of CHF ${amount} recorded. CHF ${body.invoice.balance} outstanding.`,
        );
      }
      onDone();
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'already_paid') {
        status.error('This invoice is already paid.');
        onClose();
        return;
      }
      if (code === 'billing_unavailable') {
        status.error('Billing is unreachable. Nothing was recorded; try again when the notice clears.');
        return;
      }
      if (code === 'idempotency_conflict') {
        status.error(IDEMPOTENCY_CONFLICT);
        return;
      }
      if (outcome.kind === 'error' && outcome.status === 422) {
        setErrors(fieldErrors(outcome.body));
        status.error('Check the form and try again.');
        return;
      }
      status.error('That could not be recorded.');
    },
  });

  const summary: FieldError[] = Object.entries(errors).map(([field, message]) => ({
    field,
    message,
    inputId: `transfer-${field}`,
  }));

  return (
    <Dialog name="Record bank transfer" onClose={onClose} fallbackFocus={fallbackFocus}>
      <ErrorSummary errors={summary} />
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          void submit.run((key) =>
            api<{ invoice: Invoice }>(`/api/invoices/${open.invoiceId}/payments`, {
              body: { reference, amount },
              idempotencyKey: key,
            }),
          );
        }}
      >
        <label htmlFor="transfer-reference">Bank reference</label>
        <input
          id="transfer-reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
        <FieldMessage id="transfer-reference-error" message={errors.reference} />
        <label htmlFor="transfer-amount">Amount (CHF)</label>
        <input
          id="transfer-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <FieldMessage id="transfer-amount-error" message={errors.amount} />
        <button type="submit" className="primary" disabled={submit.busy}>
          Record transfer
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Dialog>
  );
}
