// Bookings: search, CSV export, and each booking's legal next steps.
import { Download } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Booking, PolicyTerms, Station, User } from "../../shared/api";
import { cancellationCharge, feeRefundable, type CancellationCharge } from "../../shared/charges";
import { BOOKING_STATUS_WORDS, HOLDOVER_MAX_MINUTES, type PayWith } from "../../shared/kitchen";
import { dollars, hhmm, hmm, kitchenParts } from "../../shared/time";
import { api, download, serverNow, type ApiFailure } from "../api";
import { useStations } from "../data";
import { BILLING_NOTHING_CHARGED, act, fieldError, showProblem } from "../feedback";
import { Dialog, useCloseDialog } from "../ui/Dialog";
import { EmptyRow, Eyebrow, Field, PendingLine, describedBy, nextFieldId } from "../ui/parts";

type Mode = "load" | "search" | "refresh";
type Open = { kind: "cancel" | "checkout"; booking: Booking; opener: HTMLElement } | null;

export function BookingsScreen({ user }: { user: User }) {
  const stations = useStations();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const sequence = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef("");
  const isOperator = user.role === "operator";

  const search = async (text: string, mode: Mode): Promise<void> => {
    const mine = ++sequence.current;
    const pending = mode === "load" ? "Loading…" : mode === "search" ? "Searching…" : undefined;
    const outcome = await act({ pending }, () =>
      api<{ bookings: Booking[] }>("GET", `/api/bookings${text ? `?q=${encodeURIComponent(text)}` : ""}`),
    );
    if (outcome.ok && mine === sequence.current) setRows(outcome.value.bookings);
  };
  const refresh = (): void => void search(queryRef.current, "refresh");

  useEffect(() => {
    void search("", "load");
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  const onQuery = (text: string): void => {
    setQuery(text);
    queryRef.current = text;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(text, "search"), 250);
  };

  const exportCsv = (): void => {
    void act({ pending: "Preparing export…", success: () => "Export downloaded." }, () =>
      download(`/api/bookings/export${query ? `?q=${encodeURIComponent(query)}` : ""}`, "bookings.csv"),
    );
  };

  const stationName = (b: Booking): string => stations.get(b.station_id)?.name ?? b.station_id;

  const checkIn = async (b: Booking): Promise<void> => {
    const outcome = await act(
      {
        pending: "Checking in…",
        success: (done: Booking) =>
          `Checked in to ${stationName(done)} at ${hhmm(kitchenParts(Date.parse(done.checked_in_at ?? done.start)).minute)}.`,
        error: (f) => {
          if (f.code === "outside_check_in_window") return "Check-in isn't open for this booking yet, or it has ended.";
          if (f.code === "tenant_not_active") return "Check-in is blocked: a required document has expired.";
          return null;
        },
      },
      () => api<Booking>("POST", `/api/bookings/${b.id}/check-in`, { body: {} }),
    );
    if (outcome.ok) refresh();
  };

  const noShow = async (b: Booking): Promise<void> => {
    const outcome = await act(
      {
        pending: "Saving…",
        success: () => `Booking ${b.ref} marked as a no-show.`,
        error: (f) => (f.code === "not_started" ? "This booking hasn't started yet." : null),
      },
      () => api<Booking>("POST", `/api/bookings/${b.id}/no-show`, { body: {} }),
    );
    if (outcome.ok) refresh();
  };

  const refundFee = async (b: Booking): Promise<void> => {
    const outcome = await act(
      {
        pending: "Refunding fee…",
        services: ["billing"],
        success: () => `Late fee on ${b.ref} refunded.`,
        error: (f) => {
          if (f.code === "invalid_transition" || f.code === "fee_invoiced") return "That fee is already refunded or invoiced.";
          if (f.code === "billing_unavailable") return "Billing is unreachable. Nothing was refunded; try again in a moment.";
          return null;
        },
      },
      () => api<Booking>("POST", `/api/bookings/${b.id}/refund-fee`, { body: {} }),
    );
    if (outcome.ok) refresh();
  };

  const columns = isOperator ? 10 : 9;

  return (
    <div class="sheet">
      <PendingLine />
      <header class="screen-head">
        <h1 class="screen-title">Bookings</h1>
        <div class="screen-tools">
          <input
            type="search"
            class="search"
            aria-label="Search bookings"
            placeholder={isOperator ? "Ref, notes or business" : "Ref or notes"}
            value={query}
            onInput={(e) => onQuery(e.currentTarget.value)}
          />
          <button type="button" class="btn" onClick={exportCsv}>
            <Download size={16} aria-hidden="true" />
            Export CSV
          </button>
        </div>
      </header>
      <Eyebrow n={1} label="Bookings" />
      <div class="table-wrap">
        <table class="data cards" role="table" aria-label="Bookings">
          <thead>
            <tr role="row">
              <th role="columnheader">Ref</th>
              {isOperator && <th role="columnheader">Tenant</th>}
              <th role="columnheader">Station</th>
              <th role="columnheader">Date</th>
              <th role="columnheader">Time</th>
              <th role="columnheader">Status</th>
              <th role="columnheader">Payment</th>
              <th role="columnheader" class="num">
                Amount
              </th>
              <th role="columnheader">Policy</th>
              <th role="columnheader">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && <EmptyRow columns={columns} text="No bookings match." />}
            {rows?.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                user={user}
                station={stations.get(b.station_id) ?? null}
                onCheckIn={() => void checkIn(b)}
                onNoShow={() => void noShow(b)}
                onRefund={() => void refundFee(b)}
                onOpen={(kind, opener) => setOpen({ kind, booking: b, opener })}
              />
            ))}
          </tbody>
        </table>
      </div>
      {open?.kind === "cancel" && (
        <Dialog title={`Cancel booking ${open.booking.ref}`} opener={open.opener} onClose={() => setOpen(null)}>
          <CancelBody booking={open.booking} onDone={refresh} />
        </Dialog>
      )}
      {open?.kind === "checkout" && (
        <Dialog title={`Check out ${open.booking.ref}`} opener={open.opener} onClose={() => setOpen(null)}>
          <CheckOutBody booking={open.booking} onDone={refresh} />
        </Dialog>
      )}
    </div>
  );
}

interface RowProps {
  booking: Booking;
  user: User;
  station: Station | null;
  onCheckIn: () => void;
  onNoShow: () => void;
  onRefund: () => void;
  onOpen: (kind: "cancel" | "checkout", opener: HTMLElement) => void;
}

function BookingRow({ booking: b, user, station, onCheckIn, onNoShow, onRefund, onOpen }: RowProps) {
  const operator = user.role === "operator";
  const c = b.cancellation;
  const refundable =
    operator && c !== null && feeRefundable({ cancelled: b.status === "cancelled", feeCents: c.fee_cents, feeMinutes: c.fee_minutes, refunded: c.fee_refunded });
  return (
    <tr role="row">
      <td role="cell" data-label="Ref" class="mono strong">
        {b.ref}
      </td>
      {operator && (
        <td role="cell" data-label="Tenant">
          {b.tenant_name}
        </td>
      )}
      <td role="cell" data-label="Station">
        {station?.name ?? b.station_id}
      </td>
      <td role="cell" data-label="Date" class="mono">
        {b.date}
      </td>
      <td role="cell" data-label="Time" class="mono">
        <span class="start-time">{b.start_local}</span>–<span>{b.end_local}</span>
      </td>
      <td role="cell" data-label="Status">
        <span class={`status status-${b.status}`}>{BOOKING_STATUS_WORDS[b.status]}</span>
        {b.holdover && (
          <span class="cell-note">
            Hold-over <span class="mono">{b.holdover.billed_minutes}</span> min billed (
            <span class="mono">{b.holdover.reported_minutes}</span> reported)
          </span>
        )}
        {c && (
          <span class="cell-note">
            {c.late ? "Late" : "Free"} cancellation
            {c.fee_cents > 0 && (
              <>
                , fee <span class="mono">{dollars(c.fee_cents)}</span>
              </>
            )}
            {c.fee_minutes > 0 && (
              <>
                , <span class="mono">{hmm(c.fee_minutes)}</span> kept
              </>
            )}
            {c.fee_refunded && ", refunded"}
          </span>
        )}
      </td>
      <td role="cell" data-label="Payment">
        {b.pay_with === "account" ? "Account" : b.pay_with === "hour_pack" ? "Hour pack" : "—"}
      </td>
      <td role="cell" data-label="Amount" class="mono num">
        {b.amount_cents !== null ? dollars(b.amount_cents) : b.pay_with === "hour_pack" ? `${hmm(b.elapsed_minutes)} h` : "—"}
      </td>
      <td role="cell" data-label="Policy" class="mono">
        {b.policy ? <span class="mono">v{b.policy.version}</span> : "—"}
      </td>
      <td role="cell" data-label="Actions" class="row-actions">
        {b.status === "confirmed" && (
          <button type="button" class="btn btn-small" aria-label={`Check in ${b.ref}`} onClick={onCheckIn}>
            Check in
          </button>
        )}
        {b.status === "checked_in" && (
          <button
            type="button"
            class="btn btn-small"
            aria-label={`Check out ${b.ref}`}
            onClick={(e) => onOpen("checkout", e.currentTarget)}
          >
            Check out
          </button>
        )}
        {b.status === "confirmed" && user.role !== "cook" && (
          <button type="button" class="btn btn-small" aria-label={`Cancel ${b.ref}`} onClick={(e) => onOpen("cancel", e.currentTarget)}>
            Cancel
          </button>
        )}
        {operator && b.status === "confirmed" && (
          <button type="button" class="btn btn-small" aria-label={`Mark no-show ${b.ref}`} onClick={onNoShow}>
            Mark no-show
          </button>
        )}
        {refundable && (
          <button type="button" class="btn btn-small" aria-label={`Refund fee ${b.ref}`} onClick={onRefund}>
            Refund fee
          </button>
        )}
      </td>
    </tr>
  );
}

/** What cancelling now would keep, under the booking's own policy version (the server applies the same rule). */
function cancellationTerms(b: Booking): CancellationCharge {
  return cancellationCharge(
    { startMs: Date.parse(b.start), payWith: b.pay_with as PayWith, amountCents: b.amount_cents ?? 0, elapsedMinutes: b.elapsed_minutes },
    b.policy as PolicyTerms,
    serverNow(),
  );
}

function CancelBody({ booking: b, onDone }: { booking: Booking; onDone: () => void }) {
  const close = useCloseDialog();
  const [busy, setBusy] = useState(false);
  const terms = cancellationTerms(b);
  const policy = b.policy;
  const kept = terms.feeCents > 0 ? `Late cancellation charge: ${dollars(terms.feeCents)}.` : terms.feeMinutes > 0 ? `${hmm(terms.feeMinutes)} kept from your hour pack.` : "No charge.";

  const submit = async (): Promise<void> => {
    setBusy(true);
    const outcome = await act(
      {
        pending: "Cancelling…",
        services: b.pay_with === "account" ? ["billing"] : [],
        success: (done: Booking) => {
          const c = done.cancellation;
          const tail =
            c && c.fee_cents > 0
              ? `Late cancellation charge: ${dollars(c.fee_cents)}.`
              : c && c.fee_minutes > 0
                ? `${hmm(c.fee_minutes)} kept from your hour pack.`
                : "No charge.";
          return `Booking ${b.ref} cancelled. ${tail}`;
        },
        error: (f) => {
          if (f.code === "already_started") return "This booking has started and can't be cancelled.";
          if (f.code === "billing_unavailable") return BILLING_NOTHING_CHARGED;
          return null;
        },
      },
      () => api<Booking>("POST", `/api/bookings/${b.id}/cancel`, { body: {} }),
    );
    setBusy(false);
    if (outcome.ok) {
      onDone();
      close();
    }
  };

  return (
    <div class="dialog-form">
      {policy && (
        <p class="dialog-lede">
          Booked under policy <span class="mono">v{policy.version}</span>: free until <span class="mono">{policy.free_window_hours}</span>{" "}
          hours before start, then <span class="mono">{policy.late_fee_percent}</span>% charge.
        </p>
      )}
      <p class="dialog-terms">
        {terms.late ? "Cancelling now is late. " : "Cancelling now is free. "}
        {kept}
      </p>
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={close}>
          Keep booking
        </button>
        <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          Cancel booking
        </button>
      </div>
    </div>
  );
}

const MINUTES_COPY = `Enter whole minutes from 0 to ${HOLDOVER_MAX_MINUTES}.`;

function CheckOutBody({ booking: b, onDone }: { booking: Booking; onDone: () => void }) {
  const close = useCloseDialog();
  const [minutes, setMinutes] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useRef(nextFieldId("holdover")).current;

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const text = minutes.trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || value > HOLDOVER_MAX_MINUTES) {
      setError(MINUTES_COPY);
      showProblem(MINUTES_COPY);
      return;
    }
    setError(null);
    setBusy(true);
    const outcome = await act(
      {
        pending: "Checking out…",
        services: ["billing", "mail"],
        success: (done: Booking) =>
          done.holdover && done.holdover.billed_minutes > 0
            ? `Checked out. Hold-over billed: ${done.holdover.billed_minutes} min (${dollars(done.holdover.amount_cents)}).`
            : "Checked out. No hold-over billed.",
        error: (f: ApiFailure) => {
          if (f.code === "validation_failed") return MINUTES_COPY;
          if (f.code === "billing_unavailable") return BILLING_NOTHING_CHARGED;
          if (f.code === "mail_unavailable") return "Email is unreachable. Nothing was recorded; try again in a moment.";
          return null;
        },
      },
      () => api<Booking>("POST", `/api/bookings/${b.id}/check-out`, { body: { holdover_minutes: value } }),
    );
    setBusy(false);
    if (outcome.ok) {
      onDone();
      close();
    } else if (fieldError(outcome.failure, "holdover_minutes")) {
      setError(MINUTES_COPY);
    }
  };

  return (
    <form class="dialog-form" onSubmit={(e) => void submit(e)}>
      <p class="dialog-lede">
        Booked end <span class="mono">{b.end_local}</span>. Report the minutes you stayed past it; up to 10 minutes are not billed.
      </p>
      <Field id={id} label="Minutes past booked end" error={error}>
        <input
          id={id}
          type="number"
          class="mono"
          min={0}
          max={HOLDOVER_MAX_MINUTES}
          step={1}
          inputMode="numeric"
          value={minutes}
          aria-describedby={describedBy(id, error)}
          aria-invalid={error ? "true" : undefined}
          onInput={(e) => setMinutes(e.currentTarget.value)}
        />
      </Field>
      <div class="dialog-actions">
        <button type="submit" class="btn btn-primary" disabled={busy}>
          Check out
        </button>
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
