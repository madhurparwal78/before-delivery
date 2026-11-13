// The station dialog and the check-out dialog: native modal <dialog> (../modal.tsx), Escape or
// Close returns focus to the control that opened it.

import type { JSX, Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Booking, DoorEntry, Interval } from "../../shared/api.js";
import { api } from "../api.js";
import { doorCopy, GENERIC } from "../copy.js";
import { hhmm } from "../kitchen.js";
import { Modal } from "../modal.js";
import { Icon, Notice, tell, type NoticeState } from "../ui.js";

export interface ShelfChoice {
  id: string;
  name: string;
  label: string;
  disabled: boolean;
}

/** `shelves` is null on a cooler shelf's own dialog, where the claim is always for the shelf alone. */
export function StationDialog({ name, opener, intervals, span, claimable, hint, shelves, busy, notice, claimButton, onClaim, onClose }: {
  name: string; opener: SVGElement; intervals: readonly Interval[]; span: string; claimable: boolean; hint: string | null;
  shelves: readonly ShelfChoice[] | null; busy: boolean; notice: NoticeState | null; claimButton: Ref<HTMLButtonElement>;
  onClaim: (shelfId: string | null) => void; onClose: () => void;
}): JSX.Element {
  const [shelfId, setShelfId] = useState<string | null>(null);
  const shelf = shelves?.find((s) => s.id === shelfId && !s.disabled) ?? null;
  return (
    <Modal label={name} opener={opener} onClose={onClose}>
      <header class="dialog__head">
        <h2>{name}</h2>
        <p class="mono">{span}</p>
      </header>
      <ul class="intervals" role="list" aria-label="Bookings in span" tabIndex={0}>
        {intervals.length === 0 ? <li class="intervals__empty">Nothing booked in this span.</li> : null}
        {intervals.flatMap((i) => {
          const who = "mine" in i ? (i.mine ? " · Yours" : "") : ` · ${i.tenantName}`;
          const held = "status" in i && i.status === "held";
          return [
            <li key={`${i.start}b`} class={held ? "intervals__row intervals__row--held" : "intervals__row"}>
              <span>Booked {hhmm(i.start)}–{hhmm(i.end)}{who}</span>{held ? <span class="held-text">Held</span> : null}
            </li>,
            <li key={`${i.start}c`} class="intervals__row intervals__row--cleanup">Cleanup {hhmm(i.end)}–{hhmm(i.bufferEnd)}{who}</li>,
          ];
        })}
      </ul>
      {claimable && shelves ? (
        <div class="field">
          <label for="shelf-pick">Walk-in shelf</label>
          <select id="shelf-pick" value={shelf?.id ?? ""} onChange={(e) => setShelfId(e.currentTarget.value || null)}>
            <option value="">No shelf</option>
            {shelves.map((s) => <option key={s.id} value={s.id} disabled={s.disabled}>{s.name}, {s.label}</option>)}
          </select>
        </div>
      ) : null}
      <div class="actions">
        {claimable ? (
          <button type="button" ref={claimButton} class="button button--claim"
            aria-disabled={hint === null && !busy ? undefined : "true"} aria-describedby={hint === null ? undefined : "dialog-span-hint"}
            onClick={() => { if (hint === null && !busy) onClaim(shelf?.id ?? null); }}>
            {shelf ? `Claim ${name} and ${shelf.name} ${span}` : `Claim ${name} ${span}`}
          </button>
        ) : null}
        <button type="button" class="button" onClick={onClose}><Icon name="x" />Close</button>
      </div>
      {claimable && hint !== null ? <p class="hint" id="dialog-span-hint">{hint}</p> : null}
      {claimable ? <Notice notice={notice} /> : null}
    </Modal>
  );
}

/** What the card needs from the check-out dialog's request: the booking after a 200, a 409 to re-read, or nothing. */
export type CheckOutOutcome = { kind: "done"; booking: Booking } | { kind: "refused" };

export function CheckOutDialog({ entry, opener, onBusy, onFinish, onClose }: {
  entry: DoorEntry; opener: HTMLElement; onBusy: (busy: boolean) => void; onFinish: (outcome: CheckOutOutcome) => void; onClose: () => void;
}): JSX.Element {
  const [cleaned, setCleaned] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const checkbox = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    checkbox.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    setBusy(true);
    onBusy(true);
    setFieldError(null);
    setNotice(tell(doorCopy.checkOutPending));
    const result = await api<Booking>("POST", `/api/bookings/${entry.bookingId}/check-out`, { json: { cleanupDone: cleaned, note } });
    setBusy(false);
    if (result.ok) {
      onFinish({ kind: "done", booking: result.data });
      return;
    }
    onBusy(false);
    if (result.status === 422) {
      const sentence = result.error.fields?.note ?? doorCopy.cleanupRequired;
      setFieldError(sentence);
      setNotice(tell(sentence, "conflict"));
      checkbox.current?.focus();
    } else if (result.status === 409) {
      onFinish({ kind: "refused" });
    } else {
      setNotice(tell(GENERIC, "outage"));
    }
  };

  return (
    <Modal label="Check out" opener={opener} onClose={onClose}>
      <header class="dialog__head">
        <h2>Check out</h2>
        <p>{entry.tenantName} · {entry.stationName}</p>
      </header>
      <div class="field field--check">
        <input id="cleanup-done" type="checkbox" ref={checkbox} checked={cleaned} aria-invalid={fieldError && !cleaned ? "true" : undefined}
          aria-describedby={fieldError ? "cleanup-error" : undefined} onChange={(e) => setCleaned(e.currentTarget.checked)} />
        <label for="cleanup-done">Station cleaned and sanitised</label>
      </div>
      {fieldError ? <p class="field__error" id="cleanup-error">{fieldError}</p> : null}
      <div class="field">
        <label for="cleanup-note">Cleanup note</label>
        <textarea id="cleanup-note" rows={3} maxLength={500} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="actions">
        <button type="button" class="button button--ink" disabled={busy} onClick={() => void submit()}>Log cleanup and check out</button>
        <button type="button" class="button" onClick={onClose}><Icon name="x" />Close</button>
      </div>
      <Notice notice={notice} />
    </Modal>
  );
}
