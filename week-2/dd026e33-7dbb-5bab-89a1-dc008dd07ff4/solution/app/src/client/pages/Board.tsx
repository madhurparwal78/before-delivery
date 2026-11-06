// The house manager's board (brief: Screens and layout › Board): Occupancy, Overdue care and Unpaid
// invoices, re-read every 10 s. Record bank transfer outlives a re-read that changes its invoice.
import { useEffect, useRef, useState } from "react";
import type { Board as BoardData, Invoice } from "../../shared/api.js";
import { formatScaled, parseDecimal, toScaled } from "../../shared/decimal.js";
import { formatTimestampDay } from "../../shared/zurich.js";
import { HttpError, Interrupted, NoAnswer, errorCode, get, request } from "../api.js";
import { FloorPlan } from "../FloorPlan.js";
import { applyInPlace, useIdempotencyKey, usePoll } from "../hooks.js";
import { IDEMPOTENCY_CONFLICT, NO_ANSWER, SIGNED_IN_AGAIN, chf, outstandingLine } from "../labels.js";
import { navigate } from "../router.js";
import { Dialog } from "../ui/Dialog.js";
import { ErrorSummary, FieldError, StatusRegion, summaryOf, useNote } from "../ui/Feedback.js";
import { Icon } from "../ui/Icon.js";

function unpaidLine(board: BoardData): string {
  const line = `Unpaid: ${chf(board.unpaid.total)}`;
  const stale = board.unpaid.invoices.filter((invoice) => !invoice.balance_live).map((invoice) => invoice.status_confirmed_at).sort();
  return stale[0] ? `${line}, last confirmed ${formatTimestampDay(stale[0])}` : line;
}

export function Board(): JSX.Element {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [transfer, setTransfer] = useState<Invoice | null>(null);
  const [note, say] = useNote();
  const unpaidHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    get<BoardData>("/api/board", true).then(setBoard, () => undefined);
  }, []);

  const reread = async (): Promise<void> => {
    const fresh = await get<BoardData>("/api/board");
    if (JSON.stringify(fresh) !== JSON.stringify(board)) applyInPlace(() => setBoard(fresh), () => unpaidHeading.current);
  };
  usePoll(reread, 10_000);

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Board</h1>
      </header>
      {/* The panes land whole once the board answers, so nothing already shown moves. */}
      {board === null ? (
        <div className="placeholder" aria-hidden="true" />
      ) : (
      <div className="panes">
        <section className="pane" aria-labelledby="occupancy-heading">
          <h2 id="occupancy-heading" className="pane-heading">
            Occupancy
          </h2>
          <p className="lead-line mono-text">{`${board.occupancy.occupied} of ${board.occupancy.total} bays occupied`}</p>
          <FloorPlan bays={board.bays} onActivate={(bay) => bay.car && navigate(`/cars/${bay.car.id}`)} />
        </section>
        <section className="pane" aria-labelledby="overdue-heading">
          <h2 id="overdue-heading" className="pane-heading">
            Overdue care
          </h2>
          {board.overdue.length === 0 ? (
            <p className="empty empty-drawn">
              <Icon name="fileCheck" size={32} />
              Every scheduled start-up is on time.
            </p>
          ) : null}
          <ul className="plain-list ruled-list">
            {board.overdue.map((row) => (
              <li key={row.car.id}>
                <a href={`/cars/${row.car.id}`} onClick={(event) => {
                  event.preventDefault();
                  navigate(`/cars/${row.car.id}`);
                }}>
                  {row.car.name}
                </a>
                <span className="mono-text">{`Bay ${row.bay_code}`}</span>
                <span className="badge badge-alert">
                  <Icon name="alert" size={16} />
                  Start-up overdue
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="pane" aria-labelledby="unpaid-heading">
          <h2 id="unpaid-heading" ref={unpaidHeading} tabIndex={-1} className="pane-heading">
            Unpaid invoices
          </h2>
          <StatusRegion name="Invoice updates" note={note} />
          <p className={board.unpaid.invoices.length === 0 ? "unpaid-line unpaid-clear mono-text" : "unpaid-line mono-text"}>
            <Icon name="alert" />
            <span>{unpaidLine(board)}</span>
          </p>
          {board.unpaid.invoices.length === 0 ? (
            <p className="empty empty-drawn">
              <Icon name="fileCheck" size={32} />
              Every invoice is paid.
            </p>
          ) : null}
          <ul className="plain-list ruled-list">
            {board.unpaid.invoices.map((invoice) => (
              <li key={invoice.id} className="unpaid-invoice">
                <p>
                  <span className="mono-text">{invoice.number}</span> · {invoice.car.name}
                </p>
                <p className="sub">{invoice.owner.name}</p>
                <p className="outstanding mono-text" role="group" aria-label="Outstanding">
                  {outstandingLine(invoice)}
                </p>
                <button type="button" className="button" onClick={() => setTransfer(invoice)}>
                  {`Record bank transfer for ${invoice.number}`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      )}
      {transfer ? (
        <RecordTransfer
          invoice={transfer}
          say={say}
          fallbackFocus={() => unpaidHeading.current}
          onClose={() => setTransfer(null)}
          onRecorded={() => {
            setTransfer(null);
            void reread().catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function RecordTransfer({
  invoice,
  say,
  onClose,
  onRecorded,
  fallbackFocus,
}: {
  invoice: Invoice;
  say: (text: string, tone?: "info" | "error") => void;
  onClose: () => void;
  onRecorded: () => void;
  fallbackFocus: () => HTMLElement | null;
}): JSX.Element {
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(invoice.balance);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useIdempotencyKey();

  const record = async (): Promise<void> => {
    say("Recording transfer...");
    try {
      const answer = await request<{ invoice: Invoice }>(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        body: { reference, amount },
        idempotencyKey: key.take(),
      });
      key.discard();
      const paid = answer.data.invoice;
      const entered = parseDecimal(amount);
      onRecorded();
      say(
        paid.status === "paid"
          ? `Invoice ${paid.number} is paid.`
          : `Payment of ${chf(entered ? formatScaled(toScaled(entered, 2), 2) : amount)} recorded. ${chf(paid.balance)} outstanding.`,
      );
    } catch (error) {
      if (error instanceof NoAnswer) {
        say(NO_ANSWER.transfer, "error");
        return;
      }
      key.discard();
      const code = errorCode(error);
      if (code === "already_paid") {
        onClose();
        say("This invoice is already paid.", "error");
      } else if (code === "billing_unavailable") say("Billing is unreachable. Nothing was recorded; try again when the notice clears.", "error");
      else if (code === "idempotency_conflict") say(IDEMPOTENCY_CONFLICT, "error");
      else if (error instanceof HttpError && error.status === 422) {
        setErrors(error.fields);
        say(Object.values(error.fields)[0] ?? "", "error");
      } else if (error instanceof Interrupted) say(SIGNED_IN_AGAIN);
    }
  };

  return (
    <Dialog title="Record bank transfer" onClose={onClose} fallbackFocus={fallbackFocus}>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void record();
        }}
      >
        <p className="sub">
          <span className="mono-text">{invoice.number}</span> · {invoice.car.name} · {invoice.owner.name}
        </p>
        <ErrorSummary items={summaryOf(errors, ["reference", "amount"])} idFor={(field) => `transfer-${field}`} />
        <div className="field">
          <label htmlFor="transfer-reference">Bank reference</label>
          <input id="transfer-reference" type="text" value={reference} onChange={(event) => setReference(event.target.value)} />
          <FieldError id="transfer-reference-error" message={errors.reference} />
        </div>
        <div className="field">
          <label htmlFor="transfer-amount">Amount (CHF)</label>
          <input id="transfer-amount" type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <FieldError id="transfer-amount-error" message={errors.amount} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Record transfer
          </button>
        </div>
      </form>
    </Dialog>
  );
}
