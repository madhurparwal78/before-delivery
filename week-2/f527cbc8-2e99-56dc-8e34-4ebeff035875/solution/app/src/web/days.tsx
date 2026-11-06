// Barn day screens: the farrier's and apprentice's day sheet, the barn manager's ready sheet and the owner's day view,
// each following its barn day's live stream, plus the New barn day dialog (brief: Screens and layout; Public screens
// and controls; Interactions, Booking, Offers, Cancelling, Live rows; Feedback states; Motion).
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Allocation, type BarnDay, type Barn, type Booking, type ErrorBody, type Horse, type SheetRow, type WaitlistEntry, get, request } from "./api";
import {
  BOOKING_LABELS,
  CARDS,
  DAY_LABELS,
  centsToDollarText,
  clockSeconds,
  dollars,
  parseDollars,
  tripInvoiceText,
  visitStatusText,
  wallClock,
} from "./format";
import { type DayAction as SharedDayAction, bookingActionAllowed, dayActionAllowed, dayIsWorking } from "../shared/transitions";
import { Count, type LiveRow, rowMotion, useLiveRows, useSequence } from "./motion";
import { horsePath, navigate } from "./router";
import { useSession } from "./session";
import {
  AppLink,
  Button,
  Empty,
  Field,
  Modal,
  NETWORK_COPY,
  NotAvailable,
  Skeleton,
  StatusTag,
  billingCopy,
  focusFirstInvalid,
  focusKey,
  focusWhenReady,
  isNetwork,
  useAction,
  useAnnounce,
  useDialog,
  useEventStream,
  useNotify,
  usePendingFlag,
  useReconciled,
  useRefresh,
} from "./ui";

/** The failure line for an error: the action's own copy, the 429 copy, else the network or server copy. */
export function failure(error: ErrorBody, copies: Record<string, string> = {}, retryAfter: number | null = null): string {
  if (isNetwork(error)) return NETWORK_COPY;
  if (error.error === "rate_limited") return `Too many attempts. Try again in ${retryAfter ?? 1} seconds.`;
  return copies[error.error] ?? "Clinchline could not finish that. Try again.";
}

const DAY_NOT_AVAILABLE = "This barn day isn't available.";

/** Loads a barn day by id and shows the screen the caller's role gets for it. */
export function DayScreen({ id }: { id: string }) {
  const { user } = useSession();
  const { tick } = useRefresh();
  const [day, setDay] = useState<BarnDay | null | "missing">(null);
  const [epoch, setEpoch] = useState(0);
  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    void get<BarnDay>(`/api/barn-days/${encodeURIComponent(id)}`).then((result) => {
      if (!live) return;
      if (result.ok) setDay(result.data);
      else if (result.status === 404) setDay("missing");
    });
    return () => {
      live = false;
    };
  }, [id, tick, epoch]);
  if (day === "missing") return <NotAvailable copy={DAY_NOT_AVAILABLE} />;
  if (day === null) return <Skeleton rows={6} />;
  if (user.role === "owner") return <OwnerDay day={day} />;
  if (user.role === "barn_manager") return <ReadySheet day={day} onDayChanged={reload} />;
  return <DaySheet day={day} onDayChanged={reload} />;
}

function DayHeader({ day, live, children }: { day: BarnDay; live?: boolean; children?: ReactNode }) {
  const { user, practice } = useSession();
  return (
    <header className="day-header">
      <div className="day-title">
        <h1>{day.barn.name}</h1>
        <StatusTag status={day.status}>{DAY_LABELS[day.status]}</StatusTag>
        {live ? (
          <span className="chip chip-live" data-live="true">
            Live
          </span>
        ) : null}
      </div>
      <dl className="facts">
        <div>
          <dt>Date</dt>
          <dd className="num">{day.business_date}</dd>
        </div>
        <div>
          <dt>Start</dt>
          <dd className="num">{day.start_time}</dd>
        </div>
        <div>
          <dt>Slots</dt>
          <dd className="num">
            {day.booked_count}/{day.slot_count} · {day.slot_minutes} min
          </dd>
        </div>
        {user.role === "farrier" && day.trip_fee_cents !== undefined ? (
          <div>
            <dt>Trip fee</dt>
            <dd className="num">{dollars(day.trip_fee_cents)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="cutoff num">Cancel by {wallClock(day.cancellation_cutoff_at, practice.time_zone)}</p>
      {children}
    </header>
  );
}

// ---- Live booking rows ----

const rowKey = (row: SheetRow): string => row.booking_id ?? `${row.slot_time}|${row.horse_name}|${row.stall}`;

/**
 * The day's booking rows for this role: fetched on every refresh and changed in place by the barn day's event
 * stream; a reset or a status change fetches again.
 */
function useSheetRows(day: BarnDay, onDayChanged: () => void): { rows: SheetRow[] | null; live: boolean } {
  const { tick } = useRefresh();
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    void get<SheetRow[]>(`/api/barn-days/${encodeURIComponent(day.id)}/bookings`).then((result) => {
      if (live && result.ok) setRows(result.data);
    });
    return () => {
      live = false;
    };
  }, [day.id, tick, epoch]);
  const live = useEventStream(`/api/barn-days/${encodeURIComponent(day.id)}/events`, (event, data) => {
    if (event === "reset") setEpoch((value) => value + 1);
    else if (event === "day_status" || event === "allocation_fixed" || event === "allocation_adjusted") onDayChanged();
    else if (event === "booking_added" || event === "booking_moved" || event === "booking_removed") {
      const row = data as SheetRow;
      const key = rowKey(row);
      // A removed row takes focus with it only if it held focus; then focus moves to the table.
      const holder = rowElement(key)();
      if (event === "booking_removed" && holder?.contains(document.activeElement)) holder.closest("table")?.focus();
      setRows((current) => {
        const list = (current ?? []).filter((item) => rowKey(item) !== key);
        if (event === "booking_removed") return list;
        return [...list, row].sort((a, b) => a.slot_time.localeCompare(b.slot_time) || (a.number ?? 0) - (b.number ?? 0));
      });
      onDayChanged();
    }
  });
  return { rows, live };
}

function SheetTable({
  label,
  columns,
  list,
  rowRef,
  render,
}: {
  label: string;
  columns: string[];
  list: LiveRow<SheetRow>[];
  rowRef: (key: string) => (element: HTMLElement | null) => void;
  render: (row: SheetRow) => ReactNode;
}) {
  return (
    <div className="table-scroll">
      <table className="ledger" aria-label={label} tabIndex={-1}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className={column === "Share" ? "amount-col" : undefined}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((entry) => (
            <tr key={entry.key} ref={rowRef(entry.key)} data-row={entry.key} data-status={entry.row.status} {...rowMotion(entry)}>
              {render(entry.row)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** An email that wraps after its `@` before anywhere else. */
function emailWithBreak(email: string): ReactNode {
  const at = email.indexOf("@");
  if (at < 0) return email;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}

const rowElement = (key: string) => (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`);

// ---- Day sheet (farrier, apprentice) ----

type DayAction = Exclude<SharedDayAction, "edit">;
const ACTIONS: Record<DayAction, { label: string; success: string }> = {
  publish: { label: "Publish day", success: "Day published." },
  start: { label: "Start day", success: "Day started. Trip shares are fixed." },
  close: { label: "Close day", success: "Day closed." },
  cancel: { label: "Cancel day", success: "Day cancelled." },
};

/** The day controls in header order; each shows only while its edge is legal. */
const DAY_CONTROLS: DayAction[] = ["publish", "start", "close", "cancel"];

const tripRow = (row: SheetRow): boolean => row.status === "cancelled_late" || row.status === "no_show";

/** The farrier's Visit column: the visit status and invoice total, or a cancelled-late or no-show row's trip invoice. */
function VisitCell({ row, farrier }: { row: SheetRow; farrier: boolean }) {
  const invoiced = farrier && (row.invoice_status === "unpaid" || row.invoice_status === "paid");
  const total = invoiced && row.invoice_total_cents != null ? row.invoice_total_cents : undefined;
  if (row.visit_status) {
    const text = visitStatusText(row.visit_status, farrier ? row.invoice_status != null : true);
    return <VisitState text={farrier ? text : text === "Billed before Clinchline" ? "Invoiced" : text} total={total} />;
  }
  if (farrier && tripRow(row) && row.invoice_status) return <VisitState text={tripInvoiceText({ status: row.invoice_status })} total={total} />;
  return null;
}

function VisitState({ text, total }: { text: string; total?: number | undefined }) {
  return (
    <span className="visit-state">
      <span className="chip" data-live={text === "Invoice pending" ? "pending" : undefined} data-state={text}>
        {text}
      </span>
      {total !== undefined ? <span className="num amount">{dollars(total)}</span> : null}
    </span>
  );
}

function DaySheet({ day, onDayChanged }: { day: BarnDay; onDayChanged: () => void }) {
  const { user } = useSession();
  const { tick, refresh } = useRefresh();
  const notify = useNotify();
  const play = useSequence();
  const reconciled = useReconciled();
  const farrier = user.role === "farrier";
  const { rows, live } = useSheetRows(day, onDayChanged);
  const { list, ref } = useLiveRows(rows, rowKey);
  const [cycles, setCycles] = useState<Record<string, number>>({});
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [split, setSplit] = useState<Allocation | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [, run] = useAction();
  const excuseDialog = useDialog<ExcuseState>();
  const [dialogBusy, setDialogBusy] = useState(false);
  const visitStates = useRef(new Map<string, string | null>());
  const started = day.status === "in_progress" || day.status === "closed";

  useEffect(() => {
    let live_ = true;
    const dayPath = `/api/barn-days/${encodeURIComponent(day.id)}`;
    void Promise.all([
      get<Horse[]>("/api/horses"),
      farrier ? get<WaitlistEntry[]>(`${dayPath}/waitlist`) : null,
      farrier && started ? get<Allocation>(`${dayPath}/allocation`) : null,
    ]).then(([horses, entries, allocation]) => {
      if (!live_) return;
      if (horses.ok) setCycles(Object.fromEntries(horses.data.map((horse) => [horse.id, horse.cycle_weeks])));
      if (entries?.ok) setWaitlist(entries.data);
      setSplit(allocation?.ok ? allocation.data : null);
    });
    return () => {
      live_ = false;
    };
  }, [day.id, tick, farrier, started, rows]);

  useEffect(() => {
    if (!rows || !farrier) return;
    reconciled(
      rows
        .filter((row) => row.invoice_status)
        .map((row) => ({
          id: row.booking_id ?? "",
          pending: row.invoice_status === "pending",
          copy: billingCopy(tripRow(row) ? "trip" : "visit", row.horse_name, row.invoice_total_cents ?? 0),
          element: rowElement(rowKey(row)),
        })),
    );
    for (const row of rows) {
      const key = rowKey(row);
      const before = visitStates.current.get(key);
      const now = row.visit_status ?? null;
      if (before === "open" && now !== null && now !== "open") {
        const copy =
          row.invoice_status === "unpaid" || row.invoice_status === "paid"
            ? `Visit closed and invoiced: ${dollars(row.invoice_total_cents ?? 0)}.`
            : "Visit closed — invoice pending. It will be invoiced when billing is back.";
        requestAnimationFrame(() => play("visit-closed", rowElement(key)(), copy));
      }
      visitStates.current.set(key, now);
    }
  }, [rows, farrier, reconciled, play]);

  const pending = (rows ?? []).some((row) => row.invoice_status === "pending" || row.visit_status === "invoice_pending" || row.visit_status === "closed");
  usePendingFlag("day-sheet", pending);

  function transition(action: DayAction): void {
    setBusyAction(action);
    void run("Saving…", async () => {
      const result = await request<BarnDay>("POST", `/api/barn-days/${encodeURIComponent(day.id)}/${action}`);
      setBusyAction(null);
      if (result.ok) notify(ACTIONS[action].success, "success");
      else
        notify(
          result.error.error === "illegal_transition"
            ? `That change is not allowed for a ${result.error.from ?? day.status} day.`
            : failure(result.error, {
                unresolved_bookings: "Some horses are still open. Close each visit or mark the horse no-show before closing the day.",
                too_early: `This barn day can't start before ${day.business_date}.`,
                date_passed: `${day.business_date} has passed, so this barn day can't be published.`,
              }),
          "error",
        );
      onDayChanged();
      refresh();
    });
  }

  function rowAction(row: SheetRow, kind: "visit" | "no-show"): void {
    const bookingId = row.booking_id ?? "";
    setBusyAction(`${kind}-${bookingId}`);
    void run(kind === "visit" ? "Opening visit…" : "Saving…", async () => {
      const result = await request("POST", `/api/bookings/${encodeURIComponent(bookingId)}/${kind}`);
      setBusyAction(null);
      if (!result.ok) {
        notify(
          failure(result.error, {
            day_not_in_progress: "This barn day is not in progress.",
            illegal_transition: `${row.horse_name}'s booking is already ${result.error.from ? BOOKING_LABELS[result.error.from as Booking["status"]].toLowerCase() : "settled"}.`,
          }),
          "error",
        );
        focusWhenReady(focusKey(`${kind}-${bookingId}`));
      } else if (kind === "visit") {
        notify(`Visit opened for ${row.horse_name}.`, "success");
        navigate(horsePath(row.horse_id ?? ""));
      } else {
        notify(`${row.horse_name} marked no-show.`, "success");
        focusWhenReady(() => document.querySelector<HTMLElement>(`[aria-label="Day sheet"]`));
      }
      refresh();
    });
  }

  async function openExcuse(row: SheetRow): Promise<void> {
    const bookingId = row.booking_id ?? "";
    excuseDialog.show({ row, depositCents: null });
    const preview = await get<Preview>(`/api/bookings/${encodeURIComponent(bookingId)}/cancellation-preview`);
    if (preview.ok) excuseDialog.show({ row, depositCents: preview.data.deposit_cents });
    else {
      excuseDialog.hide();
      notify(failure(preview.error), "error");
      focusWhenReady(focusKey(`excuse-${bookingId}`));
    }
  }

  function keepHorse(state: ExcuseState): void {
    excuseDialog.hide();
    focusWhenReady(focusKey(`excuse-${state.row.booking_id ?? ""}`));
  }

  async function confirmExcuse(state: ExcuseState): Promise<void> {
    if (dialogBusy) return;
    const bookingId = state.row.booking_id ?? "";
    const horse = state.row.horse_name;
    setDialogBusy(true);
    notify("Excusing horse…", "pending");
    const result = await request<{ allocation: Allocation }>("POST", `/api/bookings/${encodeURIComponent(bookingId)}/excuse`, { body: {} });
    setDialogBusy(false);
    excuseDialog.hide();
    if (result.ok) {
      const others = result.data.allocation.adjustments.filter((a) => a.cause_booking_id === bookingId && a.booking_id !== bookingId).length;
      setSplit(result.data.allocation);
      notify(`${horse} excused. Trip shares adjusted for ${others} horses.`, "success");
      focusWhenReady(focusKey(`horse-${bookingId}`));
    } else {
      notify(
        failure(result.error, {
          no_share_recipient: `Every other counting horse is already invoiced. Mark ${horse} no-show instead.`,
          illegal_transition: "This horse can no longer be excused.",
          day_not_in_progress: "Start the day before excusing a horse.",
        }),
        "error",
      );
      focusWhenReady(focusKey(`excuse-${bookingId}`));
    }
    refresh();
  }

  const excuseState = excuseDialog.data;
  const legalControls = DAY_CONTROLS.filter((action) => dayActionAllowed(day.status, action));
  const columns = farrier
    ? ["Time", "Horse", "Stall", "Owner", "Cycle (weeks)", "Status", "Share", "Visit"]
    : ["Time", "Horse", "Stall", "Cycle (weeks)", "Status", "Visit"];

  return (
    <section className="sheet" aria-labelledby="day-sheet-title">
      <DayHeader day={day} live={live}>
        {farrier && legalControls.length ? (
          <div className="day-controls">
            {legalControls.map((action) => (
              <Button key={action} variant={action === "cancel" ? "secondary" : "primary"} busy={busyAction === action} onClick={() => transition(action)}>
                {ACTIONS[action].label}
              </Button>
            ))}
          </div>
        ) : null}
      </DayHeader>
      <h2 id="day-sheet-title" className="section-title">
        Day sheet
      </h2>
      {rows === null ? (
        <Skeleton rows={Math.min(day.slot_count, 6)} />
      ) : rows.length === 0 && list.length === 0 ? (
        <Empty>No horses are booked on this day yet.</Empty>
      ) : (
        <SheetTable
          label="Day sheet"
          columns={columns}
          list={list}
          rowRef={ref}
          render={(row) => {
            const canWork = farrier && dayIsWorking(day.status) && row.status !== undefined && bookingActionAllowed(row.status, "open_visit");
            return (
              <>
                <td data-label="Time" className="num">
                  {row.slot_time}
                </td>
                <td data-label="Horse">
                  <AppLink href={horsePath(row.horse_id ?? "")} data-focus={`horse-${row.booking_id ?? ""}`}>
                    {row.horse_name}
                  </AppLink>
                </td>
                <td data-label="Stall" className="num">
                  {row.stall}
                </td>
                {farrier ? (
                  <td data-label="Owner">
                    <span className="owner-cell">
                      <span>{row.owner_name}</span>
                      <span className="muted wrap">{emailWithBreak(row.owner_email ?? "")}</span>
                      <span className="muted num">{row.owner_phone}</span>
                    </span>
                  </td>
                ) : null}
                <td data-label="Cycle (weeks)" className="num">
                  {row.horse_id ? cycles[row.horse_id] : ""}
                </td>
                <td data-label="Status">
                  <StatusTag status={row.status ?? ""}>{row.status ? BOOKING_LABELS[row.status] : ""}</StatusTag>
                </td>
                {farrier ? (
                  <td data-label="Share" className="num amount-col">
                    {row.trip_share_cents == null ? "—" : <Count value={row.trip_share_cents} format={dollars} />}
                  </td>
                ) : null}
                <td data-label="Visit" className="visit-cell">
                  {canWork ? (
                    <span className="row-actions">
                      <Button
                        variant="primary"
                        data-focus={`visit-${row.booking_id}`}
                        busy={busyAction === `visit-${row.booking_id}`}
                        aria-label={`Open visit for ${row.horse_name}`}
                        onClick={() => rowAction(row, "visit")}
                      >
                        Open visit
                      </Button>
                      <Button
                        data-focus={`no-show-${row.booking_id}`}
                        busy={busyAction === `no-show-${row.booking_id}`}
                        aria-label={`Mark ${row.horse_name} no-show`}
                        onClick={() => rowAction(row, "no-show")}
                      >
                        No-show
                      </Button>
                      <Button
                        data-focus={`excuse-${row.booking_id}`}
                        aria-label={`Excuse ${row.horse_name}`}
                        onClick={() => void openExcuse(row)}
                      >
                        Excuse
                      </Button>
                    </span>
                  ) : (
                    <VisitCell row={row} farrier={farrier} />
                  )}
                </td>
              </>
            );
          }}
        />
      )}
      {farrier ? (
        <section className="subsection" aria-labelledby="waitlist-title">
          <h2 id="waitlist-title" className="section-title">
            Waitlist
          </h2>
          {waitlist.length ? (
            <div className="table-scroll">
              <table className="ledger" aria-label="Waitlist">
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col">Horse</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {waitlist.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Position" className="num">
                        {entry.position}
                      </td>
                      <td data-label="Horse">{entry.horse.name}</td>
                      <td data-label="Joined" className="num">
                        {entry.joined_at.slice(0, 10)} {entry.joined_at.slice(11, 16)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nobody is waiting.</Empty>
          )}
        </section>
      ) : null}
      {farrier ? <Adjustments allocation={split} /> : null}
      {farrier ? (
        <Modal title="Excuse horse" open={excuseDialog.open} initialFocus="[data-dialog-keep]" onDismiss={() => excuseState && keepHorse(excuseState)}>
          {excuseState ? (
            <>
              <p className="dialog-body" aria-busy={excuseState.depositCents === null ? "true" : undefined}>
                {excuseState.depositCents === null ? "Checking the deposit…" : excuseBody(excuseState)}
              </p>
              <div className="dialog-actions">
                <Button variant="primary" busy={dialogBusy} disabled={excuseState.depositCents === null} onClick={() => void confirmExcuse(excuseState)}>
                  Excuse horse
                </Button>
                <Button data-dialog-keep disabled={dialogBusy} onClick={() => keepHorse(excuseState)}>
                  Keep horse
                </Button>
              </div>
            </>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}

interface ExcuseState {
  row: SheetRow;
  /** The captured deposit still held, from the server's preview; null while it loads. */
  depositCents: number | null;
}

/** The Excuse dialog body (brief: Feedback states, Excuse dialog body). */
function excuseBody({ row, depositCents }: ExcuseState): string {
  const share = `Excuse ${row.horse_name} from this day. Its trip share of ${dollars(row.trip_share_cents ?? 0)} moves to the horses not yet invoiced.`;
  return share + (depositCents ? ` Its ${dollars(depositCents)} deposit will be refunded.` : "");
}

const MINUS = "\u2212";

/** The farrier's ledger of appended trip-share adjustments, each with the share it left behind. */
function Adjustments({ allocation }: { allocation: Allocation | null }) {
  const running = new Map((allocation?.shares ?? []).map((share) => [share.booking_id, share.initial_cents]));
  const names = new Map((allocation?.shares ?? []).map((share) => [share.booking_id, share.horse.name]));
  const rows = (allocation?.adjustments ?? []).map((adjustment) => {
    const after = (running.get(adjustment.booking_id) ?? 0) + adjustment.delta_cents;
    running.set(adjustment.booking_id, after);
    return { ...adjustment, after };
  });
  return (
    <section className="subsection" aria-labelledby="adjustments-title">
      <h2 id="adjustments-title" className="section-title">
        Trip share adjustments
      </h2>
      {rows.length ? (
        <div className="table-scroll">
          <table className="ledger" aria-label="Trip share adjustments">
            <thead>
              <tr>
                <th scope="col">Horse</th>
                <th scope="col" className="amount-col">
                  Change
                </th>
                <th scope="col" className="amount-col">
                  Share
                </th>
                <th scope="col">At</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.seq}>
                  <td data-label="Horse">{names.get(row.booking_id)}</td>
                  <td data-label="Change" className="num amount-col">
                    {`${row.delta_cents < 0 ? MINUS : "+"}${dollars(Math.abs(row.delta_cents))}`}
                  </td>
                  <td data-label="Share" className="num amount-col">
                    {dollars(row.after)}
                  </td>
                  <td data-label="At" className="num">
                    {clockSeconds(row.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No trip shares have moved.</Empty>
      )}
    </section>
  );
}

// ---- Ready sheet (barn manager) ----

function ReadySheet({ day, onDayChanged }: { day: BarnDay; onDayChanged: () => void }) {
  const { rows, live } = useSheetRows(day, onDayChanged);
  const { list, ref } = useLiveRows(rows, rowKey);
  return (
    <section className="sheet" aria-labelledby="ready-title">
      <DayHeader day={day} live={live} />
      <h2 id="ready-title" className="section-title">
        Ready sheet
      </h2>
      {rows === null ? (
        <Skeleton rows={Math.min(day.slot_count, 6)} />
      ) : rows.length === 0 && list.length === 0 ? (
        <Empty>No horses to catch for this day yet.</Empty>
      ) : (
        <SheetTable
          label="Ready sheet"
          columns={["Time", "Horse", "Stall"]}
          list={list}
          rowRef={ref}
          render={(row) => (
            <>
              <td data-label="Time" className="num">
                {row.slot_time}
              </td>
              <td data-label="Horse">{row.horse_name}</td>
              <td data-label="Stall" className="num">
                {row.stall}
              </td>
            </>
          )}
        />
      )}
    </section>
  );
}

// ---- Owner day view ----

interface HoldState {
  booking: Booking;
  horse: string;
}

interface Preview {
  late: boolean;
  cutoff_at: string;
  deposit_cents: number;
  deposit_outcome: "refund" | "keep" | "none";
}

interface CancelState {
  booking: Booking;
  preview: Preview | null;
}

const holdCopies = (horse: string): Record<string, string> => ({
  day_full: "This barn day is full. You can join the waitlist.",
  slot_taken: "That slot was just taken. Pick another time.",
  not_open_for_booking: "This barn day is not taking bookings.",
  horse_already_booked: `${horse} already has a booking on this day.`,
  card_declined: "Your card was declined. No slot was held.",
  account_blocked: "Your account has an unpaid invoice. Pay it to book again.",
});

/** The Cancel dialog body from the server's preview (brief: Feedback states, Cancel dialog body). */
function cancelBody(preview: Preview, horse: string, zone: string): string {
  const deposit = dollars(preview.deposit_cents);
  if (preview.late) {
    return (
      `The cutoff passed at ${wallClock(preview.cutoff_at, zone)}. ${horse} will still carry a trip share.` +
      (preview.deposit_outcome === "keep" ? ` Your ${deposit} deposit is kept and set against the trip share.` : "")
    );
  }
  return "Cancelling now is before the cutoff. No trip share applies." + (preview.deposit_outcome === "refund" ? ` Your ${deposit} deposit will be refunded.` : "");
}

function OwnerDay({ day }: { day: BarnDay }) {
  const { practice } = useSession();
  const { tick, refresh } = useRefresh();
  const notify = useNotify();
  const announce = useAnnounce();
  const play = useSequence();
  const [horses, setHorses] = useState<Horse[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [horseId, setHorseId] = useState("");
  const [card, setCard] = useState<string>(CARDS[0].token);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, run] = useAction();
  const holdDialog = useDialog<HoldState>();
  const cancelDialog = useDialog<CancelState>();
  const [dialogBusy, setDialogBusy] = useState(false);
  const announcedOffers = useRef(new Set<string>());
  const { list, ref } = useLiveRows(day.slots, (slot) => slot.id);

  useEffect(() => {
    let live = true;
    void Promise.all([get<Horse[]>("/api/horses"), get<Booking[]>("/api/my/bookings")]).then(([mine, booked]) => {
      if (!live) return;
      if (mine.ok) setHorses(mine.data.filter((horse) => horse.barn.id === day.barn.id));
      if (booked.ok) {
        const onDay = booked.data.filter((booking) => booking.barn_day_id === day.id);
        setBookings(onDay);
        for (const offer of onDay.filter((booking) => booking.status === "held" && booking.offer)) {
          if (announcedOffers.current.has(offer.id)) continue;
          announcedOffers.current.add(offer.id);
          announce(`A slot opened for ${offer.horse.name}. Hold ends at ${clockSeconds(offer.hold_expires_at ?? "")} (${practice.time_zone}).`);
        }
      }
    });
    return () => {
      live = false;
    };
  }, [day.id, day.barn.id, tick, announce, practice.time_zone]);

  useEffect(() => {
    if (horses && !horses.some((horse) => horse.id === horseId)) setHorseId(horses[0]?.id ?? "");
  }, [horses, horseId]);

  const horseName = horses?.find((horse) => horse.id === horseId)?.name ?? "";
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));

  function hold(slotId: string, time: string): void {
    setBusyKey(`book-${slotId}`);
    void run("Holding slot…", async () => {
      const result = await request<Booking>("POST", `/api/barn-days/${encodeURIComponent(day.id)}/bookings`, {
        body: { slot_id: slotId, horse_id: horseId, card_token: card },
      });
      setBusyKey(null);
      if (result.ok) {
        notify(`Holding ${time} for ${horseName}.`, "success");
        holdDialog.show({ booking: result.data, horse: horseName });
      } else {
        const field = result.error.errors?.card_token ?? result.error.errors?.horse_id;
        notify(field ?? failure(result.error, holdCopies(horseName), result.retryAfter), "error");
        focusWhenReady(result.error.error === "day_full" ? focusKey("join-waitlist") : focusKey(`book-${slotId}`));
      }
      refresh();
    });
  }

  async function confirmHold(state: HoldState): Promise<void> {
    if (dialogBusy) return;
    setDialogBusy(true);
    notify("Confirming booking…", "pending");
    const result = await request<Booking>("POST", `/api/bookings/${encodeURIComponent(state.booking.id)}/confirm`);
    setDialogBusy(false);
    const { slot_id: slotId, slot_time: time } = state.booking;
    holdDialog.hide();
    if (result.ok) {
      focusWhenReady(focusKey(`cancel-${slotId}`));
      play("slot-won", document.querySelector<HTMLElement>(`[data-slot="${CSS.escape(slotId)}"]`), `Booked ${state.horse} for ${time} on ${day.business_date}. A confirmation email is on its way.`);
    } else if (result.error.error === "hold_expired") {
      notify(`Your hold on ${time} ran out. Pick a time again.`, "error");
      focusWhenReady("#owner-horse");
    } else {
      notify(failure(result.error, {}, result.retryAfter), "error");
      focusWhenReady(focusKey(state.booking.offer ? `offer-${slotId}` : `book-${slotId}`));
    }
    refresh();
  }

  async function releaseHold(state: HoldState): Promise<void> {
    holdDialog.hide();
    focusWhenReady(focusKey(state.booking.offer ? `offer-${state.booking.slot_id}` : `book-${state.booking.slot_id}`));
    notify("Releasing hold…", "pending");
    const result = await request("DELETE", `/api/bookings/${encodeURIComponent(state.booking.id)}`);
    const ok = result.ok || result.status === 404;
    notify(ok ? "Hold released." : failure(result.error), ok ? "success" : "error");
    refresh();
  }

  async function openCancel(booking: Booking): Promise<void> {
    cancelDialog.show({ booking, preview: null });
    const preview = await get<Preview>(`/api/bookings/${encodeURIComponent(booking.id)}/cancellation-preview`);
    if (preview.ok) cancelDialog.show({ booking, preview: preview.data });
    else {
      cancelDialog.hide();
      notify(failure(preview.error), "error");
      focusWhenReady(focusKey(`cancel-${booking.slot_id}`));
    }
  }

  function keepBooking(state: CancelState): void {
    cancelDialog.hide();
    focusWhenReady(focusKey(`cancel-${state.booking.slot_id}`));
  }

  async function confirmCancel(state: CancelState): Promise<void> {
    if (dialogBusy) return;
    setDialogBusy(true);
    notify("Cancelling booking…", "pending");
    const result = await request<{ booking: Booking; trip_share_applies: boolean }>("POST", `/api/bookings/${encodeURIComponent(state.booking.id)}/cancel`);
    setDialogBusy(false);
    cancelDialog.hide();
    const horse = state.booking.horse.name;
    if (result.ok) {
      notify(
        result.data.trip_share_applies ? `Booking cancelled. ${horse} still carries a trip share for this day.` : "Booking cancelled. No trip share applies.",
        "success",
      );
      focusWhenReady(focusKey(`book-${state.booking.slot_id}`));
    } else {
      notify(failure(result.error, { day_started: "This day has started. Ask the farrier about this booking." }), "error");
      focusWhenReady(focusKey(`cancel-${state.booking.slot_id}`));
    }
    refresh();
  }

  function joinWaitlist(): void {
    setBusyKey("join");
    void run("Joining waitlist…", async () => {
      const result = await request<{ position: number }>("POST", `/api/barn-days/${encodeURIComponent(day.id)}/waitlist`, {
        body: { horse_id: horseId, card_token: card },
      });
      setBusyKey(null);
      if (result.ok) notify(`${horseName} is on the waitlist, position ${result.data.position}.`, "success");
      else
        notify(
          result.error.errors?.card_token ??
            failure(result.error, {
              already_on_waitlist: `${horseName} is already on the waitlist.`,
              horse_already_booked: `${horseName} already has a booking on this day.`,
              account_blocked: "Your account has an unpaid invoice. Pay it to book again.",
              day_not_full: "This barn day has open slots. Book one instead.",
            }),
          "error",
        );
      focusWhenReady(focusKey("join-waitlist"));
      refresh();
    });
  }

  const holdState = holdDialog.data;
  const cancelState = cancelDialog.data;
  const bookable = day.status === "published";
  return (
    <section className="sheet" aria-labelledby="slots-title">
      <DayHeader day={day} />
      <div className="owner-controls">
        <div className="field">
          <label htmlFor="owner-horse">Horse</label>
          <select id="owner-horse" value={horseId} onChange={(event) => setHorseId(event.target.value)}>
            {(horses ?? []).map((horse) => (
              <option key={horse.id} value={horse.id}>
                {horse.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="owner-card">Card</label>
          <select id="owner-card" value={card} onChange={(event) => setCard(event.target.value)}>
            {CARDS.map((option) => (
              <option key={option.token} value={option.token}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {day.status === "full" ? (
          <Button variant="primary" data-focus="join-waitlist" busy={busyKey === "join"} disabled={!horseId} onClick={joinWaitlist}>
            Join waitlist
          </Button>
        ) : null}
      </div>
      <h2 id="slots-title" className="section-title">
        Slots
      </h2>
      <div className="table-scroll">
        <table className="ledger slots" aria-label="Slots">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Booking</th>
            </tr>
          </thead>
          <tbody>
            {list.map((entry) => {
              const slot = entry.row;
              const mine = slot.my_booking_id ? byId.get(slot.my_booking_id) : undefined;
              return (
                <tr key={entry.key} ref={ref(entry.key)} data-slot={slot.id} data-state={mine ? "mine" : slot.state} {...rowMotion(entry)}>
                  <td data-label="Time" className="num">
                    {slot.time}
                  </td>
                  <td data-label="Booking">
                    {mine ? (
                      <span className="mine">
                        <svg className="tick" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                          <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="mine-name">{mine.horse.name}</span>
                        {mine.status === "confirmed" ? (
                          <Button data-focus={`cancel-${slot.id}`} aria-label={`Cancel booking for ${mine.horse.name}`} onClick={() => void openCancel(mine)}>
                            Cancel booking
                          </Button>
                        ) : mine.status === "held" && mine.offer ? (
                          <Button
                            variant="primary"
                            data-focus={`offer-${slot.id}`}
                            aria-label={`Confirm offer for ${mine.horse.name}`}
                            onClick={() => holdDialog.show({ booking: mine, horse: mine.horse.name })}
                          >
                            Confirm offer
                          </Button>
                        ) : (
                          <span className="muted">{BOOKING_LABELS[mine.status]}</span>
                        )}
                      </span>
                    ) : slot.state === "taken" ? (
                      <span className="taken">Taken</span>
                    ) : bookable ? (
                      <Button
                        variant="primary"
                        data-focus={`book-${slot.id}`}
                        aria-label={`Book ${slot.time}`}
                        busy={busyKey === `book-${slot.id}`}
                        disabled={!horseId}
                        onClick={() => hold(slot.id, slot.time)}
                      >
                        Book
                      </Button>
                    ) : (
                      <span className="muted">Not taking bookings</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal title="Confirm booking" open={holdDialog.open} initialFocus="[data-dialog-primary]" onDismiss={() => holdState && void releaseHold(holdState)}>
        {holdState ? (
          <>
            <p className="dialog-body">
              {`Hold ${holdState.booking.slot_time} on ${day.business_date} at ${day.barn.name} for ${holdState.horse}. `}
              {holdState.booking.deposit_cents > 0 ? `Deposit ${dollars(holdState.booking.deposit_cents)}. ` : ""}
              {`Cancel by ${wallClock(day.cancellation_cutoff_at, practice.time_zone)} or the trip share still applies. `}
              {`Hold ends at ${clockSeconds(holdState.booking.hold_expires_at ?? "")} (${practice.time_zone}).`}
            </p>
            <div className="dialog-actions">
              <Button variant="primary" data-dialog-primary busy={dialogBusy} onClick={() => void confirmHold(holdState)}>
                Confirm booking
              </Button>
              <Button disabled={dialogBusy} onClick={() => void releaseHold(holdState)}>
                Release hold
              </Button>
            </div>
          </>
        ) : null}
      </Modal>
      <Modal title="Cancel booking" open={cancelDialog.open} initialFocus="[data-dialog-keep]" onDismiss={() => cancelState && keepBooking(cancelState)}>
        {cancelState ? (
          <>
            <p className="dialog-body" aria-busy={cancelState.preview ? undefined : "true"}>
              {cancelState.preview === null ? "Checking the cutoff…" : cancelBody(cancelState.preview, cancelState.booking.horse.name, practice.time_zone)}
            </p>
            <div className="dialog-actions">
              <Button variant="primary" busy={dialogBusy} disabled={cancelState.preview === null} onClick={() => void confirmCancel(cancelState)}>
                Confirm cancellation
              </Button>
              <Button data-dialog-keep disabled={dialogBusy} onClick={() => keepBooking(cancelState)}>
                Keep booking
              </Button>
            </div>
          </>
        ) : null}
      </Modal>
    </section>
  );
}

// ---- New barn day (farrier) ----

interface DraftForm {
  barn_id: string;
  business_date: string;
  start_time: string;
  slot_count: string;
  slot_minutes: string;
  trip_fee: string;
}

export function NewBarnDay({ open, onClose }: { open: boolean; onClose: (saved: boolean) => void }) {
  const notify = useNotify();
  const [barns, setBarns] = useState<Barn[]>([]);
  const [form, setForm] = useState<DraftForm>({ barn_id: "", business_date: "", start_time: "", slot_count: "6", slot_minutes: "45", trip_fee: "" });
  const [feeEdited, setFeeEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useAction();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    void get<Barn[]>("/api/barns").then((result) => {
      if (!result.ok) return;
      setBarns(result.data);
      setForm((current) => {
        const barn = result.data.find((item) => item.id === current.barn_id) ?? result.data[0];
        return barn ? { ...current, barn_id: barn.id, trip_fee: feeEdited ? current.trip_fee : centsToDollarText(barn.trip_fee_cents) } : current;
      });
    });
  }, [open, feeEdited]);

  const set = useCallback((key: keyof DraftForm, value: string) => setForm((current) => ({ ...current, [key]: value })), []);

  function close(saved: boolean): void {
    onClose(saved);
    focusWhenReady(focusKey("new-barn-day"));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void run("Saving…", async () => {
      const local: Record<string, string> = {};
      const fee = parseDollars(form.trip_fee);
      if (!form.trip_fee.trim()) local.trip_fee_cents = "This is required.";
      else if (fee === null) local.trip_fee_cents = "Enter an amount in dollars, like 45.00.";
      if (Object.keys(local).length) {
        setErrors(local);
        notify("Check the highlighted fields.", "error");
        focusFirstInvalid(formRef.current);
        return;
      }
      const result = await request<BarnDay>("POST", "/api/barn-days", {
        body: {
          barn_id: form.barn_id,
          business_date: form.business_date.trim(),
          start_time: form.start_time.trim(),
          slot_count: form.slot_count.trim() === "" ? null : Number(form.slot_count),
          slot_minutes: form.slot_minutes.trim() === "" ? null : Number(form.slot_minutes),
          trip_fee_cents: fee,
        },
      });
      if (result.ok) {
        setErrors({});
        setForm((current) => ({ ...current, business_date: "", start_time: "" }));
        notify("Draft saved.", "success");
        close(true);
      } else if (result.error.error === "validation") {
        setErrors(result.error.errors ?? {});
        notify("Check the highlighted fields.", "error");
        focusFirstInvalid(formRef.current);
      } else notify(failure(result.error), "error");
    });
  }

  return (
    <Modal title="New barn day" open={open} onDismiss={() => close(false)}>
      <form ref={formRef} className="dialog-form" onSubmit={submit} noValidate>
        <Field label="Barn" error={errors.barn_id}>
          {(props) => (
            <select
              {...props}
              value={form.barn_id}
              onChange={(event) => {
                const barn = barns.find((item) => item.id === event.target.value);
                set("barn_id", event.target.value);
                if (barn && !feeEdited) set("trip_fee", centsToDollarText(barn.trip_fee_cents));
              }}
            >
              {barns.map((barn) => (
                <option key={barn.id} value={barn.id}>
                  {barn.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="field-row">
          <Field label="Date" error={errors.business_date} hint="YYYY-MM-DD">
            {(props) => (
              <input {...props} type="text" inputMode="numeric" autoComplete="off" value={form.business_date} onChange={(e) => set("business_date", e.target.value)} />
            )}
          </Field>
          <Field label="Start time" error={errors.start_time} hint="HH:MM, 24-hour">
            {(props) => (
              <input {...props} type="text" inputMode="numeric" autoComplete="off" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
            )}
          </Field>
        </div>
        <div className="field-row">
          <Field label="Slots" error={errors.slot_count}>
            {(props) => <input {...props} type="number" min={1} max={12} step={1} value={form.slot_count} onChange={(e) => set("slot_count", e.target.value)} />}
          </Field>
          <Field label="Minutes per slot" error={errors.slot_minutes}>
            {(props) => (
              <input {...props} type="number" min={15} max={120} step={5} value={form.slot_minutes} onChange={(e) => set("slot_minutes", e.target.value)} />
            )}
          </Field>
        </div>
        <Field label="Trip fee" error={errors.trip_fee_cents} hint="Dollars, split across the horses that count">
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="decimal"
              value={form.trip_fee}
              onChange={(e) => {
                setFeeEdited(true);
                set("trip_fee", e.target.value);
              }}
            />
          )}
        </Field>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save draft
          </Button>
          <Button onClick={() => close(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
