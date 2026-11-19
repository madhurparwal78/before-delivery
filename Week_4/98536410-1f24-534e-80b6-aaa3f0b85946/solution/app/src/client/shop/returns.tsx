import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { PausedButton } from "../controls";
import { formatEuro } from "../lib/format";
import { Overlay } from "../lib/overlay";
import { PAUSE_COPY, useStorageDown } from "../storage";
import { RETURN_TRANSITIONS, type ReturnStatus } from "../../shared/transitions";
import type { Order, ReturnRecord } from "../types";

const RETURN_ACTIONS: { to: ReturnStatus; label: string }[] = [
  { to: "received", label: "Receive" }, { to: "settled", label: "Settle" }, { to: "declined", label: "Decline" },
];
import type { ReturnMemory } from "./orders";

export function ReturnsTable({ returns, labels, tableRef, onAct, onLabel, onPaused }: {
  returns: ReturnRecord[]; labels: Record<string, string>; tableRef: RefObject<HTMLDivElement | null>;
  onAct: (record: ReturnRecord, to: ReturnStatus) => void;
  onLabel: (record: ReturnRecord) => void; onPaused: (copy: string) => void;
}) {
  const down = useStorageDown();
  return (
    <div className={`charcoal-panel scroll-x${returns.length === 0 ? " table-empty" : ""}`} ref={tableRef} role="table" aria-label="Returns" tabIndex={-1}>
      <div role="rowgroup">
        <div role="row" className="rrow thead">
          {["Return", "Status", "Refund", "Actions"].map((name) => <div key={name} role="columnheader">{name}</div>)}
        </div>
      </div>
      {returns.length === 0 ? <p className="table-blank">No returns yet.</p> : null}
      <div role="rowgroup">
        {returns.map((record) => (
          <div key={record.id} role="row" className="rrow" data-return-id={record.id}>
            <div role="cell" className="strong">{record.number}</div>
            <div role="cell"><span className="word">{record.status}</span></div>
            <div role="cell">{formatEuro(record.refund_cents)}</div>
            <div role="cell" className="actions">
              {RETURN_ACTIONS.map(({ to, label }) => (
                RETURN_TRANSITIONS[record.status].includes(to) ? (
                  <button key={to} type="button" className="btn" aria-label={`${label} ${record.number}`} onClick={() => onAct(record, to)}>{label}</button>
                ) : null
              ))}
              {record.status === "requested" || record.status === "received" ? (
                <PausedButton className="btn" aria-label={`Return label ${record.number}`} paused={down} pauseCopy={PAUSE_COPY.label} onPaused={onPaused} onPress={() => onLabel(record)}>
                  Return label
                </PausedButton>
              ) : null}
            </div>
            {labels[record.id] ? <pre className="label-text">{labels[record.id]}</pre> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReturnDialog({ order, open, restored, memory, opener, onClose, onChange, submit }: {
  order: Order | null; open: boolean; restored: boolean; memory: ReturnMemory | null; opener: RefObject<HTMLElement | null>;
  onClose: () => void; onChange: (patch: Partial<ReturnMemory>) => void;
  submit: (lines: { sku: string; quantity: number }[], reason: string) => Promise<Record<string, string> | null>;
}) {
  const quantities = memory?.quantities ?? {};
  const reason = memory?.reason ?? "";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => setBody(node), []);
  const focused = useRef(false);

  useEffect(() => {
    if (!open || !order || !body || focused.current) return;
    focused.current = true;
    const root = body;
    const wanted = memory?.focus ? root.querySelector<HTMLElement>(`[data-focus-id="${memory.focus}"]`) : null;
    (wanted ?? root.querySelector<HTMLElement>("input"))?.focus();
    if (restored && memory?.scroll && root.parentElement) root.parentElement.scrollTop = memory.scroll;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order, body]);
  useEffect(() => {
    if (!open) focused.current = false;
  }, [open]);

  useEffect(() => {
    const scroller = body?.parentElement;
    if (!open || !scroller) return undefined;
    const record = () => onChange({ scroll: scroller.scrollTop });
    scroller.addEventListener("scroll", record);
    window.addEventListener("pagehide", record);
    return () => {
      scroller.removeEventListener("scroll", record);
      window.removeEventListener("pagehide", record);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order, body]);

  async function request() {
    if (!order || busy) return;
    const lines = order.lines.flatMap((line) => (Number(quantities[line.sku] ?? 0) > 0 ? [{ sku: line.sku, quantity: Number(quantities[line.sku]) }] : []));
    setBusy(true);
    const problems = await submit(lines, reason.trim());
    setBusy(false);
    setErrors(problems ?? {});
  }

  return (
    <Overlay open={open} restored={restored} role="dialog" label="Return items" onClose={onClose} opener={opener} className="dialog" initialFocus={null} keepFocus>
      <div ref={attach} onFocusCapture={(event) => onChange({ focus: (event.target as HTMLElement).dataset.focusId ?? null })}>
        <h2>Return items</h2>
        <p>{order?.number}</p>
        {(order?.lines ?? []).map((line) => (
          <div key={line.sku}>
            <label className="field-label" htmlFor={`return-${line.sku}`}>{`${line.sku} ${line.name}`}</label>
            <input
              id={`return-${line.sku}`} className="field" type="number" min={0} max={line.quantity - line.returned_quantity} aria-label={`Return quantity ${line.sku}`}
              data-focus-id={`q:${line.sku}`} value={quantities[line.sku] ?? ""} aria-invalid={errors[`lines.${line.sku}`] ? true : undefined}
              onChange={(event) => onChange({ quantities: { ...quantities, [line.sku]: event.target.value } })}
            />
            {errors[`lines.${line.sku}`] ? <p className="field-error">{errors[`lines.${line.sku}`]}</p> : null}
          </div>
        ))}
        <label className="field-label" htmlFor="return-reason">Reason</label>
        <input
          id="return-reason" className="field" type="text" data-focus-id="reason" value={reason} aria-invalid={errors.reason ? true : undefined}
          onChange={(event) => onChange({ reason: event.target.value })}
        />
        {errors.reason ? <p className="field-error">{errors.reason}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn" data-focus-id="request" aria-disabled={busy} onClick={() => void request()}>Request return</button>
          <button type="button" className="btn" data-focus-id="cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </Overlay>
  );
}
