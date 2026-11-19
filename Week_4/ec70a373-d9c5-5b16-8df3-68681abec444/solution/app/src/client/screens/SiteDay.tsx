// Site day: the manager's bookings for one date with check-in, no-show, cancel and check-out.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Booking, Me } from "../../shared/api.ts";
import { NO_SHOW_AFTER_MINUTES, hoursToQuarters, lateMinutes } from "../../shared/rules.ts";
import { STATUS_WORDS, money, quartersText } from "../../shared/format.ts";
import { formatWall, wallClock, type IsoDate } from "../../shared/time.ts";
import { api, errorCopy, newKey, serverNow, DROPPED } from "../api.ts";
import { reloadsPaused } from "../session.ts";
import { useSites } from "../useSites.ts";
import { Rail } from "../Rail.tsx";
import { ActionButton, Dialog, EmptyState, Status, tint, useFieldErrors, useLatestRequest, useStatusRegion, useTick, type Say } from "../ui.tsx";
import { CancellationOutcome, ROW_CHANGED, managerCancelled } from "../copy.tsx";

const RELOAD_MS = 30_000;
const REASON_COPY = "Give a reason the member can act on.";

function resultText(b: Booking): string {
  const by = b.checked_out_by?.name ?? "";
  if (!b.late_quarter_hours) return `On time · by ${by}`;
  return `Late ${quartersText(b.late_quarter_hours)} h · ${quartersText(hoursToQuarters(b.pack_hours_applied ?? 0))} pack h · Overage $${money(b.overage?.total_cents ?? 0)} · by ${by}`;
}

function StatusCell({ booking, cellRef }: { booking: Booking; cellRef: (element: HTMLTableCellElement | null) => void }): ReactNode {
  const ref = useRef<HTMLTableCellElement | null>(null);
  const previous = useRef(booking.status);
  useLayoutEffect(() => {
    if (previous.current !== booking.status) tint(ref.current);
    previous.current = booking.status;
  }, [booking.status]);
  return (
    <td
      role="cell"
      data-label="Status"
      tabIndex={-1}
      ref={(element) => {
        ref.current = element;
        cellRef(element);
      }}
      className={`status-cell status-${booking.status}`}
    >
      <span className="stamp-word">{STATUS_WORDS[booking.status]}</span>
      {booking.status === "checked_out" && <span className="row-result mono">{resultText(booking)}</span>}
    </td>
  );
}

type RowAction = "check-in" | "no-show";
type FocusAfter = { bookingId: string; target: "status" | "check-out" };

export function SiteDay({ me }: { me: Me }): ReactNode {
  const sites = useSites();
  const [date, setDate] = useState<IsoDate>("");
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [status, say] = useStatusRegion();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [checkingOut, setCheckingOut] = useState<Booking | null>(null);
  const statusCells = useRef(new Map<string, HTMLTableCellElement>());
  const checkOutButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<FocusAfter | null>(null);
  const focusBeforeReload = useRef<{ element: Element; bookingId: string } | null>(null);
  const beginLoad = useLatestRequest();
  const dateRef = useRef(date);
  dateRef.current = date;
  const opener = useRef<HTMLElement | null>(null);
  const dialogResult = useRef<"status" | null>(null);
  const [timerRestart, setTimerRestart] = useState(0);
  const siteId = me.user.site_id ?? "";
  const site = sites.find((s) => s.id === siteId);

  // The date field starts on the site's current local date, on every visit.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !site) return;
    started.current = true;
    setDate(site.local_date);
  }, [site]);

  /** Each load makes every earlier one stale; a reload replaces row contents only. */
  const load = useCallback(async () => {
    const shown = dateRef.current;
    if (!shown) return;
    const isLatest = beginLoad();
    setTimerRestart((n) => n + 1);
    const result = await api<{ bookings: Booking[] }>(`/api/sites/${siteId}/bookings?date=${shown}`);
    if (!isLatest() || !result.ok) return;
    const active = document.activeElement;
    const row = active?.closest<HTMLElement>("[data-booking]");
    focusBeforeReload.current = active && row?.dataset.booking ? { element: active, bookingId: row.dataset.booking } : null;
    setBookings(result.data.bookings);
  }, [siteId, beginLoad]);

  useEffect(() => {
    setBookings(null);
    void load();
  }, [date, load]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (reloadsPaused()) setTimerRestart((n) => n + 1);
      else void load();
    }, RELOAD_MS);
    return () => clearTimeout(id);
  }, [timerRestart, load]);

  // Focus after an answer, and the Status cell when a reload removed the focused button.
  useLayoutEffect(() => {
    const after = focusAfter.current;
    if (after) {
      const target = after.target === "status" ? statusCells.current.get(after.bookingId) : checkOutButtons.current.get(after.bookingId);
      if (target) {
        focusAfter.current = null;
        target.focus();
      }
    }
    const before = focusBeforeReload.current;
    focusBeforeReload.current = null;
    if (before && !before.element.isConnected) statusCells.current.get(before.bookingId)?.focus();
  }, [bookings]);

  const replace = useCallback((booking: Booking) => {
    setBookings((list) => (list ?? []).map((b) => (b.id === booking.id ? booking : b)));
  }, []);

  /** A 409 means the booking changed first: re-request it and redraw only that row. */
  const followServer = useCallback(
    async (bookingId: string) => {
      const fresh = await api<{ booking: Booking }>(`/api/bookings/${bookingId}`);
      focusAfter.current = { bookingId, target: "status" };
      dialogResult.current = "status";
      if (fresh.ok) replace(fresh.data.booking);
    },
    [replace],
  );

  const act = async (b: Booking, action: RowAction): Promise<void> => {
    say(action === "check-in" ? "Checking in…" : "Saving…");
    const mark = `${b.id}:${action}`;
    setPending((now) => new Set(now).add(mark));
    const result = await api<{ booking: Booking }>(`/api/bookings/${b.id}/${action}`, { method: "POST" });
    setPending((now) => new Set([...now].filter((m) => m !== mark)));
    if (!result.ok) {
      const errors: Record<string, string> =
        action === "check-in"
          ? {
              too_early: "Too early to check in. Check-in opens 15 minutes before the start.",
              too_late: "This booking has ended and can no longer be checked in.",
              certificate_expired: `${b.business_name}'s certificate of insurance has expired. They can't use the kitchen until a current one is verified.`,
              invalid_transition: ROW_CHANGED,
            }
          : {
              too_early: `A no-show can be marked from ${formatWall(wallClock(Date.parse(b.start_at) + NO_SHOW_AFTER_MINUTES * 60_000, site?.time_zone ?? "UTC").minutes)}, 30 minutes after the start.`,
              invalid_transition: ROW_CHANGED,
            };
      say(errorCopy(result, errors), "error");
      if (result.error?.code === "invalid_transition") await followServer(b.id);
      return;
    }
    focusAfter.current = { bookingId: b.id, target: action === "check-in" ? "check-out" : "status" };
    replace(result.data.booking);
    say(
      action === "check-in"
        ? `Checked in ${b.business_name} on ${b.station_name}.`
        : `Marked ${b.business_name} as a no-show. ${quartersText(hoursToQuarters(b.hours))} pack hours forfeited.`,
    );
    void load();
  };

  const dialogReturn = (bookingId: string) => (): HTMLElement | null => {
    if (dialogResult.current === "status" || !opener.current?.isConnected) {
      dialogResult.current = null;
      return statusCells.current.get(bookingId) ?? null;
    }
    return null;
  };

  return (
    <div className="screen site-day">
      {sites.length > 0 && date && <Rail sites={sites} siteId={siteId} date={date} onDate={setDate} />}
      <h1 className="screen-title">Site day</h1>
      <Status name="Site day status" message={status} />
      <table role="table" aria-label="Bookings" className="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Time</th>
            <th role="columnheader" scope="col">Station</th>
            <th role="columnheader" scope="col">Member</th>
            <th role="columnheader" scope="col">Status</th>
            <th role="columnheader" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {(bookings ?? []).map((b) => (
            <tr role="row" key={b.id} data-booking={b.id}>
              <td role="cell" data-label="Time" className="mono">
                <span className="mono">{b.start}–{b.end}</span>
              </td>
              <td role="cell" data-label="Station">{b.station_name}</td>
              <td role="cell" data-label="Member">{b.business_name}</td>
              <StatusCell
                booking={b}
                cellRef={(element) => {
                  if (element) statusCells.current.set(b.id, element);
                  else statusCells.current.delete(b.id);
                }}
              />
              <td role="cell" data-label="Actions">
                <div className="row-actions">
                  {b.status === "confirmed" && (
                    <>
                      <ActionButton pending={pending.has(`${b.id}:check-in`)} className="button button-small button-primary" onPress={() => void act(b, "check-in")}>
                        Check in
                      </ActionButton>
                      <ActionButton pending={pending.has(`${b.id}:no-show`)} className="button button-small" onPress={() => void act(b, "no-show")}>
                        Mark no-show
                      </ActionButton>
                      <button
                        type="button"
                        className="button button-small"
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          setCancelling(b);
                        }}
                      >
                        Cancel booking
                      </button>
                    </>
                  )}
                  {b.status === "checked_in" && (
                    <button
                      ref={(element) => {
                        if (element) checkOutButtons.current.set(b.id, element);
                        else checkOutButtons.current.delete(b.id);
                      }}
                      type="button"
                      className="button button-small button-primary"
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setCheckingOut(b);
                      }}
                    >
                      Check out
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bookings === null && date && <p className="loading">Loading bookings…</p>}
      {bookings !== null && bookings.length === 0 && <EmptyState drawing="clipboard">No bookings on this date.</EmptyState>}
      {cancelling && (
        <ManagerCancelDialog
          booking={cancelling}
          onClose={() => setCancelling(null)}
          returnFocus={dialogReturn(cancelling.id)}
          say={say}
          onDone={(booking) => {
            dialogResult.current = "status";
            replace(booking);
            void load();
          }}
          onChangedElsewhere={followServer}
        />
      )}
      {checkingOut && (
        <CheckOutDialog
          booking={checkingOut}
          onClose={() => setCheckingOut(null)}
          returnFocus={dialogReturn(checkingOut.id)}
          say={say}
          onDone={(booking) => {
            dialogResult.current = "status";
            replace(booking);
            void load();
          }}
          onChangedElsewhere={followServer}
        />
      )}
    </div>
  );
}

function ManagerCancelDialog({
  booking,
  onClose,
  returnFocus,
  say,
  onDone,
  onChangedElsewhere,
}: {
  booking: Booking;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
  say: Say;
  onDone: (booking: Booking) => void;
  onChangedElsewhere: (bookingId: string) => Promise<void>;
}): ReactNode {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();
  return (
    <Dialog title={`Cancel booking ${booking.reference}`} onClose={onClose} returnFocus={returnFocus} interruptible>
      {(close) => (
        <>
          <CancellationOutcome booking={booking} />
          <div className="field">
            <label htmlFor="cancel-reason">Reason</label>
            <textarea
              id="cancel-reason"
              data-autofocus
              rows={3}
              value={reason}
              {...errors.attrs("reason")}
              onChange={(e) => {
                setReason(e.target.value);
                errors.clear("reason");
              }}
            />
            {errors.node("reason")}
          </div>
          <div className="dialog-actions">
            <ActionButton
              pending={busy}
              className="button button-primary"
              onPress={async () => {
                setBusy(true);
                errors.clearAll();
                say("Cancelling…");
                const result = await api<{ booking: Booking; refunded_hours: number; forfeited_hours: number }>(`/api/bookings/${booking.id}/cancel`, {
                  method: "POST",
                  body: { reason },
                  resumable: true,
                });
                setBusy(false);
                if (result.ok) {
                  say(managerCancelled(booking.reference, booking.business_name, hoursToQuarters(result.data.refunded_hours), hoursToQuarters(result.data.forfeited_hours)));
                  onDone(result.data.booking);
                  close();
                  return;
                }
                if (result.error?.code === "validation") {
                  errors.set("reason", REASON_COPY);
                  say(REASON_COPY, "error");
                  return;
                }
                say(errorCopy(result, { invalid_transition: ROW_CHANGED }), "error");
                if (result.error?.code === "invalid_transition") {
                  await onChangedElsewhere(booking.id);
                  close();
                }
              }}
            >
              Confirm cancellation
            </ActionButton>
            <button type="button" className="button" onClick={close}>
              Keep booking
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

const CHECK_OUT_ERRORS: Record<string, string> = {
  billing_unavailable: "Billing is unreachable, so this check-out was not recorded. Try again in a moment.",
  idempotency_conflict: "This check-out request was already used for another booking. Close the dialog and try again.",
  invalid_transition: ROW_CHANGED,
};
const CHECK_OUT_IN_PROGRESS = "This check-out is still being processed. Wait a moment.";

function CheckOutDialog({
  booking,
  onClose,
  returnFocus,
  say,
  onDone,
  onChangedElsewhere,
}: {
  booking: Booking;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
  say: Say;
  onDone: (booking: Booking) => void;
  onChangedElsewhere: (bookingId: string) => Promise<void>;
}): ReactNode {
  useTick(60_000);
  const key = useRef(newKey()).current;
  const awaited = useRef(0);
  const settled = useRef(false);
  const late = lateMinutes(Date.parse(booking.end_at), serverNow());
  return (
    <Dialog title={`Check out ${booking.business_name}`} onClose={onClose} returnFocus={returnFocus} interruptible>
      {(close) => (
        <>
          <p className="dialog-text">
            Booked until <span className="mono">{booking.end}</span>. Late by <span className="mono">{late}</span> min.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              data-autofocus
              className="button button-primary"
              onClick={async () => {
                if (settled.current) return;
                if (awaited.current === 0) say("Checking out…");
                awaited.current += 1;
                const result = await api<{ booking: Booking }>(`/api/bookings/${booking.id}/check-out`, { method: "POST", idempotencyKey: key, resumable: true });
                awaited.current -= 1;
                if (settled.current) return;
                if (result.ok) {
                  settled.current = true;
                  const b = result.data.booking;
                  say(
                    b.late_quarter_hours
                      ? `Checked out ${b.business_name}. Late ${quartersText(b.late_quarter_hours)} h; ${quartersText(hoursToQuarters(b.pack_hours_applied ?? 0))} pack hours applied; overage $${money(b.overage?.total_cents ?? 0)}.`
                      : `Checked out ${b.business_name} on time.`,
                  );
                  onDone(b);
                  close();
                  return;
                }
                if (result.error === null) {
                  if (awaited.current === 0) say(DROPPED, "error");
                  return;
                }
                if (result.error.code === "idempotency_in_progress") {
                  if (awaited.current === 0) say(CHECK_OUT_IN_PROGRESS, "error");
                  return;
                }
                say(errorCopy(result, CHECK_OUT_ERRORS), "error");
                if (result.error.code === "invalid_transition") {
                  settled.current = true;
                  await onChangedElsewhere(booking.id);
                  close();
                }
              }}
            >
              Confirm check-out
            </button>
            <button type="button" className="button" onClick={close}>
              Keep checked in
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
