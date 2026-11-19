import { useEffect, useRef, useState, type JSX } from 'react';
import { api, get, RequestFailed } from '../api';
import { useLiveResource } from '../live';
import {
  AlertBanner,
  ArrowChip,
  Dialog,
  EmptyCard,
  KennelBeacon,
  motionAttributes,
  Pill,
  useAnnounce,
  type SummaryItem,
} from '../ui';
import { addDays, hm } from '../time';
import { ClinicDateText, SplitBand, useApp, useViewport } from '../app';

export type Appointment = {
  id: string;
  patientId: string;
  patientName: string;
  species: string;
  vetId: string;
  vetName: string;
  roomId: string;
  roomName: string;
  photoFileId: string | null;
  start: string;
  end: string;
  reason: string;
  status: string;
  late: boolean;
};

export type DaySlot = { minuteOfDay: number; label: string; start: string };
type DayPayload = { date: string; now: string; slots: DaySlot[]; appointments: Appointment[] };
type Room = { id: string; name: string };
type QueueRow = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  species: string;
  photoFileId: string | null;
  vetName: string;
  waitingMinutes: number;
  lateByMinutes: number | null;
};

export const STATUS_LABELS: Record<string, string> = {
  booked: 'Booked',
  'checked-in': 'Checked in',
  'in-consult': 'In consult',
  completed: 'Completed',
  cancelled: 'Cancelled',
  'no-show': 'No-show',
};

export const SPECIES_LABELS: Record<string, string> = {
  dog: 'Dog',
  cat: 'Cat',
  rabbit: 'Rabbit',
  other: 'Other',
};

export function appointmentName(appointment: Appointment): string {
  const base = `${appointment.patientName} with ${appointment.vetName}, ${hm(
    appointment.start,
  )} to ${hm(appointment.end)}, ${STATUS_LABELS[appointment.status] ?? appointment.status}`;
  return appointment.late ? `${base}, late` : base;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({
  name,
  photoFileId,
}: {
  name: string;
  photoFileId?: string | null;
}): JSX.Element {
  if (photoFileId) {
    return <img className="avatar" src={`/api/files/${photoFileId}/content`} alt="" />;
  }
  return (
    <span className="avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function messageOf(error: unknown): string {
  if (error instanceof RequestFailed) return error.message;
  return 'Something went wrong.';
}

function slotCount(appointment: Appointment, slotLengthMs: number): number {
  return Math.max(
    1,
    Math.round((Date.parse(appointment.end) - Date.parse(appointment.start)) / slotLengthMs),
  );
}

export function TodayScreen(): JSX.Element {
  const { clinicTime, session, navigate } = useApp();
  const viewport = useViewport();
  const announce = useAnnounce();
  const [date, setDate] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ roomId: string; start: string } | null>(null);
  const [details, setDetails] = useState<Appointment | null>(null);
  const [toast, setToast] = useState<{ id: string; ms: number; key: number } | null>(null);
  const toastKey = useRef(0);

  useEffect(() => {
    if (clinicTime && !date) setDate(clinicTime.clinicDate);
  }, [clinicTime, date]);

  const rooms = useLiveResource<{ rooms: Room[] }>('/api/rooms', []);
  const day = useLiveResource<DayPayload>(date ? `/api/appointments?date=${date}` : null, ['calendar']);
  const queue = useLiveResource<{ queue: QueueRow[] }>('/api/queue', ['queue', 'calendar']);
  const beacons = useLiveResource<{ waiting: number; overdue: number; dueWithinHour: number }>(
    '/api/beacons',
    ['beacons', 'ward', 'queue', 'calendar'],
  );

  const appointments = day.data?.appointments ?? [];
  const slots = day.data?.slots ?? [];
  const roomList = rooms.data?.rooms ?? [];

  const cancel = async (appointment: Appointment): Promise<void> => {
    try {
      const result = await api<{ id: string; undoUntil: string; now: string }>(
        'DELETE',
        `/api/appointments/${appointment.id}`,
      );
      day.reload();
      queue.reload();
      announce('Appointment cancelled.');
      toastKey.current += 1;
      setToast({
        id: appointment.id,
        ms: Math.max(0, Date.parse(result.undoUntil) - Date.parse(result.now)),
        key: toastKey.current,
      });
      setAlert(null);
    } catch (error) {
      setAlert(messageOf(error));
    }
  };

  const undo = async (): Promise<void> => {
    if (!toast) return;
    try {
      await api('POST', `/api/appointments/${toast.id}/restore`);
      setToast(null);
      day.reload();
      queue.reload();
      announce('Appointment restored.');
      setAlert(null);
    } catch (error) {
      setAlert(messageOf(error));
      setToast(null);
    }
  };

  const move = async (
    appointment: Appointment,
    changes: { start?: string; roomId?: string; minutes?: number },
  ): Promise<void> => {
    try {
      const updated = await api<Appointment>('PATCH', `/api/appointments/${appointment.id}`, changes);
      day.reload();
      setAlert(null);
      if (changes.minutes !== undefined) {
        announce(`${updated.patientName} now runs ${hm(updated.start)} to ${hm(updated.end)}.`);
      } else {
        announce(`Moved ${updated.patientName} to ${updated.roomName}, ${hm(updated.start)}.`);
      }
    } catch (error) {
      setAlert(messageOf(error));
    }
  };

  const checkIn = async (appointment: Appointment): Promise<void> => {
    try {
      await api('POST', `/api/appointments/${appointment.id}/check-in`);
      day.reload();
      queue.reload();
      announce(`${appointment.patientName} checked in.`);
      setAlert(null);
    } catch (error) {
      setAlert(messageOf(error));
    }
  };

  const bookEarliest = (): void => {
    const now = day.data?.now ?? clinicTime?.now ?? '';
    for (const slot of slots) {
      if (slot.start < now) continue;
      const busy = appointments.filter(
        (appointment) =>
          Date.parse(appointment.start) <= Date.parse(slot.start) &&
          Date.parse(appointment.end) > Date.parse(slot.start),
      );
      const room = roomList.find((candidate) => !busy.some((item) => item.roomId === candidate.id));
      if (!room) continue;
      setBooking({ roomId: room.id, start: slot.start });
      return;
    }
    setAlert('No times are available on this day.');
  };

  const waitingPanel = (
    <WaitingRoomPanel
      queue={queue.data?.queue ?? []}
      onReload={() => {
        queue.reload();
        day.reload();
      }}
      onAlert={setAlert}
      focusCalendar={() => {
        const target =
          document.querySelector<HTMLElement>('[data-calendar-focus="true"]') ??
          document.querySelector<HTMLElement>('[data-agenda-list]');
        target?.focus();
      }}
    />
  );

  return (
    <div className="screen">
      <SplitBand
        headline={
          <div className="headline-row">
            <h1>Today</h1>
            <ClinicDateText />
          </div>
        }
        right={<KennelBeacon beacons={beacons.data ?? null} />}
      />
      <div className="screen-body">
        <AlertBanner message={alert} />
        {viewport === 'phone' ? (
          <>
            {waitingPanel}
            <DayAgenda
              appointments={appointments}
              onOpen={setDetails}
              onPreviousDay={() => setDate((current) => (current ? addDays(current, -1) : current))}
              onNextDay={() => setDate((current) => (current ? addDays(current, 1) : current))}
              onBookTime={bookEarliest}
            />
          </>
        ) : (
          <div className={`today-layout ${viewport}`}>
            {viewport === 'tablet' ? waitingPanel : null}
            <DayCalendar
              rooms={roomList}
              appointments={appointments}
              slots={slots}
              onPreviousDay={() => setDate((current) => (current ? addDays(current, -1) : current))}
              onNextDay={() => setDate((current) => (current ? addDays(current, 1) : current))}
              onToday={() => setDate(clinicTime?.clinicDate ?? null)}
              onBookSlot={(roomId, start) => setBooking({ roomId, start })}
              onOpenDetails={setDetails}
              onMove={move}
              onCancel={cancel}
              onCheckIn={checkIn}
              onUndo={undo}
              canUndo={toast !== null}
              undoTarget={toast?.id ?? null}
            />
            {viewport === 'desktop' ? waitingPanel : null}
          </div>
        )}
      </div>
      {toast ? (
        <UndoToast
          key={toast.key}
          lifetimeMs={toast.ms}
          onUndo={() => void undo()}
          onExpire={() => setToast(null)}
        />
      ) : null}
      {booking ? (
        <BookAppointmentDialog
          roomId={booking.roomId}
          start={booking.start}
          onClose={() => setBooking(null)}
          onBooked={(appointment) => {
            setBooking(null);
            day.reload();
            announce(
              `Booked ${appointment.patientName} with ${appointment.vetName} at ${hm(
                appointment.start,
              )}.`,
            );
          }}
        />
      ) : null}
      {details ? (
        <AppointmentDetailsDialog
          appointment={details}
          role={session?.role ?? 'front-desk'}
          onClose={() => setDetails(null)}
          onDone={(message) => {
            setDetails(null);
            day.reload();
            queue.reload();
            if (message) announce(message);
          }}
          onFailure={(message) => {
            setDetails(null);
            setAlert(message);
          }}
          onNavigate={navigate}
        />
      ) : null}
    </div>
  );
}

function UndoToast({
  lifetimeMs,
  onUndo,
  onExpire,
}: {
  lifetimeMs: number;
  onUndo: () => void;
  onExpire: () => void;
}): JSX.Element {
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    const timer = window.setTimeout(() => expire.current(), lifetimeMs);
    return () => window.clearTimeout(timer);
  }, [lifetimeMs]);
  return (
    <div
      role="status"
      aria-label="Notice"
      aria-live="off"
      className="toast"
      {...motionAttributes('toast')}
    >
      <span>Appointment cancelled.</span>
      <button type="button" className="toast-undo" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}

type FocusWatch =
  | { kind: 'block'; id: string; until: number }
  | { kind: 'slot'; start: string; roomId: string; until: number };

type CalendarProps = {
  rooms: Room[];
  appointments: Appointment[];
  slots: DaySlot[];
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onBookSlot: (roomId: string, start: string) => void;
  onOpenDetails: (appointment: Appointment) => void;
  onMove: (
    appointment: Appointment,
    changes: { start?: string; roomId?: string; minutes?: number },
  ) => Promise<void>;
  onCancel: (appointment: Appointment) => Promise<void>;
  onCheckIn: (appointment: Appointment) => Promise<void>;
  onUndo: () => Promise<void>;
  canUndo: boolean;
  undoTarget: string | null;
};

function DayCalendar(props: CalendarProps): JSX.Element {
  const [focus, setFocus] = useState({ row: 0, column: 0 });
  const [picked, setPicked] = useState<string | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const shouldFocus = useRef(false);
  const focusWatch = useRef<FocusWatch | null>(null);
  const [, setFocusTick] = useState(0);
  const pointer = useRef<{
    appointment: Appointment;
    timer: number | null;
    pointerType: string;
    held: boolean;
  } | null>(null);

  const requestCellFocus = (): void => {
    focusWatch.current = null;
    shouldFocus.current = true;
    setFocusTick((tick) => tick + 1);
  };

  const requestBlockFocus = (id: string): void => {
    focusWatch.current = { kind: 'block', id, until: performance.now() + 2500 };
    setFocusTick((tick) => tick + 1);
  };

  /** After a cancel, focus belongs to the gridcell of the freed first slot. */
  const requestFreedSlotFocus = (appointment: Appointment): void => {
    focusWatch.current = {
      kind: 'slot',
      start: appointment.start,
      roomId: appointment.roomId,
      until: performance.now() + 2500,
    };
    setFocusTick((tick) => tick + 1);
  };

  const slotLengthMs =
    props.slots.length > 1 ? Date.parse(props.slots[1].start) - Date.parse(props.slots[0].start) : 900_000;

  /**
   * A changed appointment is re-rendered when the server's answer and the live
   * push arrive, so the wanted target is re-focused until the window closes.
   */
  useEffect(() => {
    const watch = focusWatch.current;
    if (watch) {
      if (performance.now() > watch.until) {
        focusWatch.current = null;
      } else {
        const target =
          watch.kind === 'block'
            ? container.current?.querySelector<HTMLElement>(`[data-testid="appt-${watch.id}"]`)
            : container.current?.querySelector<HTMLElement>(
                `[role="gridcell"][data-slot-start="${watch.start}"][data-slot-room="${watch.roomId}"]`,
              );
        if (target && !(watch.kind === 'slot' && target.querySelector('button'))) {
          if (document.activeElement !== target) target.focus();
        }
        const timer = window.setTimeout(() => setFocusTick((tick) => tick + 1), 120);
        return () => window.clearTimeout(timer);
      }
    }
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    container.current?.querySelector<HTMLElement>('[data-calendar-focus="true"]')?.focus();
  });

  const covering = (slot: DaySlot, roomId: string): Appointment | undefined =>
    props.appointments.find(
      (appointment) =>
        appointment.roomId === roomId &&
        Date.parse(appointment.start) <= Date.parse(slot.start) &&
        Date.parse(appointment.end) > Date.parse(slot.start),
    );

  const startingAt = (slot: DaySlot, roomId: string): Appointment | undefined =>
    props.appointments.find(
      (appointment) => appointment.roomId === roomId && appointment.start === slot.start,
    );

  const focusedAppointment = (): Appointment | undefined => {
    const slot = props.slots[focus.row];
    const room = props.rooms[focus.column];
    if (!slot || !room) return undefined;
    return covering(slot, room.id);
  };

  const slotAt = (rowIndex: number): DaySlot | undefined => props.slots[rowIndex];

  const onKeyDown = async (event: React.KeyboardEvent): Promise<void> => {
    focusWatch.current = null;
    const appointment = focusedAppointment();
    const key = event.key;
    const rowOf = (target: Appointment): number =>
      props.slots.findIndex((slot) => slot.start === target.start);

    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      if (event.altKey && appointment) {
        event.preventDefault();
        const length = slotCount(appointment, slotLengthMs);
        if (event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
          const nextSlots = key === 'ArrowDown' ? length + 1 : length - 1;
          if (nextSlots >= 1) {
            requestBlockFocus(appointment.id);
            await props.onMove(appointment, {
              minutes: Math.round((nextSlots * slotLengthMs) / 60_000),
            });
          }
          return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          const currentRow = rowOf(appointment);
          const nextRow = currentRow + (key === 'ArrowDown' ? 1 : -1);
          const target = slotAt(nextRow);
          if (!target) return;
          requestBlockFocus(appointment.id);
          await props.onMove(appointment, { start: target.start });
          setFocus({ row: nextRow, column: focus.column });
          return;
        }
        const nextColumn = focus.column + (key === 'ArrowRight' ? 1 : -1);
        const room = props.rooms[nextColumn];
        if (!room) return;
        requestBlockFocus(appointment.id);
        await props.onMove(appointment, { roomId: room.id });
        setFocus({ row: focus.row, column: nextColumn });
        return;
      }
      event.preventDefault();
      setFocus((current) => {
        if (key === 'ArrowUp') return { ...current, row: Math.max(0, current.row - 1) };
        if (key === 'ArrowDown') {
          return { ...current, row: Math.min(props.slots.length - 1, current.row + 1) };
        }
        if (key === 'ArrowLeft') return { ...current, column: Math.max(0, current.column - 1) };
        return { ...current, column: Math.min(props.rooms.length - 1, current.column + 1) };
      });
      requestCellFocus();
      return;
    }
    if (key === 'Enter' || key === ' ') {
      const slot = props.slots[focus.row];
      const room = props.rooms[focus.column];
      if (!slot || !room) return;
      event.preventDefault();
      if (appointment) {
        props.onOpenDetails(appointment);
        return;
      }
      props.onBookSlot(room.id, slot.start);
      return;
    }
    if ((key === 'i' || key === 'I') && appointment) {
      event.preventDefault();
      await props.onCheckIn(appointment);
      return;
    }
    if (key === 'Delete' && appointment) {
      event.preventDefault();
      setFocus({ row: rowOf(appointment), column: focus.column });
      requestFreedSlotFocus(appointment);
      await props.onCancel(appointment);
      return;
    }
    if ((key === 'z' || key === 'Z') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (props.canUndo) {
        const restoredId = props.undoTarget;
        if (restoredId) requestBlockFocus(restoredId);
        await props.onUndo();
      }
      return;
    }
    if (key === 't' || key === 'T') {
      event.preventDefault();
      props.onToday();
    }
  };

  const dropAt = async (appointment: Appointment, x: number, y: number): Promise<void> => {
    const cell = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-slot-start][data-slot-room]');
    if (!cell) return;
    const start = cell.dataset.slotStart;
    const roomId = cell.dataset.slotRoom;
    if (!start || !roomId) return;
    if (start === appointment.start && roomId === appointment.roomId) return;
    await props.onMove(appointment, { start, roomId });
  };

  return (
    <div
      className="calendar-panel"
      onKeyDown={(event) => void onKeyDown(event)}
      onFocus={(event) => {
        const watch = focusWatch.current;
        if (!watch) return;
        const target = event.target as HTMLElement;
        const wanted =
          watch.kind === 'block'
            ? target.dataset.testid === `appt-${watch.id}`
            : target.dataset.slotStart === watch.start && target.dataset.slotRoom === watch.roomId;
        if (!wanted) focusWatch.current = null;
      }}
    >
      <div className="day-controls">
        <Pill variant="secondary" onClick={props.onPreviousDay}>
          Previous day
        </Pill>
        <Pill variant="secondary" onClick={props.onNextDay}>
          Next day
        </Pill>
      </div>
      <div className="calendar-grid" role="grid" aria-label="Day calendar" ref={container}>
        <div role="row" className="calendar-head">
          <span role="columnheader">Time</span>
          {props.rooms.map((room) => (
            <span role="columnheader" key={room.id}>
              {room.name}
            </span>
          ))}
        </div>
        {props.slots.map((slot, rowIndex) => (
          <div role="row" key={slot.start} className="calendar-row">
            <span role="rowheader" className="time-axis">
              {slot.label}
            </span>
            {props.rooms.map((room, columnIndex) => {
              const occupying = covering(slot, room.id);
              const first = startingAt(slot, room.id);
              const isFocused = focus.row === rowIndex && focus.column === columnIndex;
              return (
                <div
                  role="gridcell"
                  key={room.id}
                  className="calendar-cell"
                  aria-label={`${room.name}, ${slot.label}, ${occupying ? 'booked' : 'free'}`}
                  tabIndex={isFocused && !first ? 0 : -1}
                  data-calendar-focus={isFocused && !first ? 'true' : undefined}
                  data-slot-start={slot.start}
                  data-slot-room={room.id}
                  onFocus={(event) => {
                    if (event.target === event.currentTarget) {
                      setFocus({ row: rowIndex, column: columnIndex });
                    }
                  }}
                  onMouseDown={() => setFocus({ row: rowIndex, column: columnIndex })}
                >
                  {first ? (
                    <button
                      type="button"
                      className={`appointment reason-${first.reason.toLowerCase()}`}
                      data-testid={`appt-${first.id}`}
                      data-picked={picked === first.id ? 'true' : undefined}
                      data-calendar-focus={isFocused ? 'true' : undefined}
                      tabIndex={isFocused ? 0 : -1}
                      aria-label={appointmentName(first)}
                      {...motionAttributes('appointment-move')}
                      style={{
                        height: `calc(${slotCount(first, slotLengthMs)} * var(--slot-height) - 8px)`,
                      }}
                      onFocus={() => setFocus({ row: rowIndex, column: columnIndex })}
                      onPointerDown={(event) => {
                        setFocus({ row: rowIndex, column: columnIndex });
                        const touch = event.pointerType === 'touch';
                        pointer.current = {
                          appointment: first,
                          pointerType: event.pointerType,
                          held: !touch,
                          timer: touch
                            ? window.setTimeout(() => {
                                if (pointer.current) pointer.current.held = true;
                                setPicked(first.id);
                              }, 500)
                            : null,
                        };
                      }}
                      onPointerMove={() => {
                        if (!pointer.current) return;
                        if (pointer.current.held) setPicked(pointer.current.appointment.id);
                      }}
                      onPointerUp={(event) => {
                        const held = pointer.current;
                        if (held?.timer) window.clearTimeout(held.timer);
                        pointer.current = null;
                        const wasPicked = picked === first.id;
                        setPicked(null);
                        if (held && held.held && wasPicked) {
                          void dropAt(first, event.clientX, event.clientY);
                          return;
                        }
                        props.onOpenDetails(first);
                      }}
                      onPointerCancel={() => {
                        if (pointer.current?.timer) window.clearTimeout(pointer.current.timer);
                        pointer.current = null;
                        setPicked(null);
                      }}
                    >
                      <span className="appointment-line">
                        <Avatar name={first.patientName} photoFileId={first.photoFileId} />
                        <span className="appointment-patient">{first.patientName}</span>
                        <span className="appointment-times">
                          {hm(first.start)} to {hm(first.end)}
                        </span>
                      </span>
                      <span className="appointment-line">
                        <span className="appointment-reason">{first.reason}</span>
                        <span className="appointment-status">
                          {STATUS_LABELS[first.status] ?? first.status}
                        </span>
                        <span className="appointment-vet">{first.vetName}</span>
                        {first.late ? <span className="chip chip-late">Late</span> : null}
                      </span>
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayAgenda({
  appointments,
  onOpen,
  onPreviousDay,
  onNextDay,
  onBookTime,
}: {
  appointments: Appointment[];
  onOpen: (appointment: Appointment) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onBookTime: () => void;
}): JSX.Element {
  const ordered = [...appointments].sort((a, b) => (a.start < b.start ? -1 : 1));
  return (
    <div className="agenda-panel">
      <div className="day-controls">
        <Pill variant="secondary" onClick={onPreviousDay}>
          Previous day
        </Pill>
        <Pill variant="secondary" onClick={onNextDay}>
          Next day
        </Pill>
      </div>
      <ul className="agenda" aria-label="Day agenda" data-agenda-list tabIndex={-1}>
        {ordered.map((appointment) => (
          <li key={appointment.id}>
            <button
              type="button"
              className={`appointment reason-${appointment.reason.toLowerCase()}`}
              data-testid={`appt-${appointment.id}`}
              aria-label={appointmentName(appointment)}
              {...motionAttributes('appointment-move')}
              onClick={() => onOpen(appointment)}
            >
              <span className="appointment-line">
                <Avatar name={appointment.patientName} photoFileId={appointment.photoFileId} />
                <span className="appointment-patient">{appointment.patientName}</span>
                <span className="appointment-times">
                  {hm(appointment.start)} to {hm(appointment.end)}
                </span>
              </span>
              <span className="appointment-line">
                <span className="appointment-reason">{appointment.reason}</span>
                <span className="appointment-status">
                  {STATUS_LABELS[appointment.status] ?? appointment.status}
                </span>
                <span className="appointment-vet">{appointment.vetName}</span>
                {appointment.late ? <span className="chip chip-late">Late</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Pill onClick={onBookTime}>Book a time</Pill>
    </div>
  );
}

function WaitingRoomPanel({
  queue,
  onReload,
  onAlert,
  focusCalendar,
}: {
  queue: QueueRow[];
  onReload: () => void;
  onAlert: (message: string | null) => void;
  focusCalendar: () => void;
}): JSX.Element {
  const { session, navigate } = useApp();
  const announce = useAnnounce();
  const [pending, setPending] = useState<string | null>(null);
  const known = useRef<Set<string>>(new Set());
  const canStart = session?.role === 'vet' || session?.role === 'manager';

  const start = async (row: QueueRow): Promise<void> => {
    setPending(row.appointmentId);
    try {
      await api('POST', `/api/appointments/${row.appointmentId}/start`);
      announce(`${row.patientName} is now in consult.`);
      onAlert(null);
      onReload();
    } catch (error) {
      onAlert(messageOf(error));
      onReload();
    } finally {
      setPending(null);
    }
  };

  if (queue.length === 0) {
    return (
      <section className="waiting-panel">
        <h2 className="panel-title">Waiting room</h2>
        <EmptyCard
          title="No one is waiting."
          action={{ label: 'Go to calendar', onClick: focusCalendar }}
        />
      </section>
    );
  }

  return (
    <section className="waiting-panel">
      <h2 className="panel-title">Waiting room</h2>
      <ul className="waiting-list" aria-label="Waiting room">
        {queue.map((row) => {
          const isNew = !known.current.has(row.appointmentId);
          known.current.add(row.appointmentId);
          return (
            <li
              key={row.appointmentId}
              className={`patient-card${isNew ? ' arriving' : ''}`}
              aria-label={`${row.patientName}, waiting ${row.waitingMinutes} min`}
              {...motionAttributes('queue-arrive')}
            >
              <Avatar name={row.patientName} photoFileId={row.photoFileId} />
              <div className="patient-card-body">
                <p className="patient-card-name">{row.patientName}</p>
                <p className="chip-row">
                  <span className="chip">{SPECIES_LABELS[row.species] ?? 'Other'}</span>
                  <span className="chip">Waiting</span>
                  {row.lateByMinutes !== null ? (
                    <span className="chip chip-late">Arrived {row.lateByMinutes} min late</span>
                  ) : null}
                </p>
                <p className="patient-card-vet">{row.vetName}</p>
                <p className="patient-card-wait">waiting {row.waitingMinutes} min</p>
                {canStart ? (
                  <Pill busy={pending === row.appointmentId} onClick={() => void start(row)}>
                    {`Start consult for ${row.patientName}`}
                  </Pill>
                ) : null}
              </div>
              <ArrowChip
                href={`/patients/${row.patientId}`}
                label={`Open ${row.patientName}`}
                onNavigate={navigate}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Client = { id: string; name: string; patients: { id: string; name: string }[] };

function BookAppointmentDialog({
  roomId,
  start,
  onClose,
  onBooked,
}: {
  roomId: string;
  start: string;
  onClose: () => void;
  onBooked: (appointment: Appointment) => void;
}): JSX.Element {
  const [clients, setClients] = useState<Client[]>([]);
  const [vets, setVets] = useState<{ id: string; name: string }[]>([]);
  const [clientId, setClientId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [vetId, setVetId] = useState('');
  const [reason, setReason] = useState('Consult');
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get<{ clients: Client[] }>('/api/clients').then((data) => setClients(data.clients));
    void get<{ vets: { id: string; name: string }[] }>('/api/vets').then((data) => {
      setVets(data.vets);
      setVetId((current) => current || data.vets[0]?.id || '');
    });
  }, []);

  const patients = clients.find((client) => client.id === clientId)?.patients ?? [];
  const problem = (field: string): boolean => summary.some((item) => item.field === field);

  const submit = async (): Promise<void> => {
    const problems: SummaryItem[] = [];
    if (!clientId) problems.push({ field: 'Client', message: 'Client is required.' });
    if (!patientId) problems.push({ field: 'Patient', message: 'Patient is required.' });
    if (problems.length > 0) {
      setSummary(problems);
      return;
    }
    setBusy(true);
    try {
      const appointment = await api<Appointment>('POST', '/api/appointments', {
        patientId,
        vetId,
        roomId,
        start,
        reason,
      });
      onBooked(appointment);
    } catch (error) {
      setSummary([{ field: 'server', message: messageOf(error) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      name="Book appointment"
      onClose={onClose}
      summary={summary}
      onSummaryLink={(field) => {
        const ids: Record<string, string> = {
          Client: 'book-client',
          Patient: 'book-patient',
          server: 'book-client',
        };
        document.getElementById(ids[field] ?? 'book-client')?.focus();
      }}
    >
      <div className="field">
        <label htmlFor="book-client">Client</label>
        <select
          id="book-client"
          value={clientId}
          aria-describedby={problem('Client') ? 'book-client-error' : undefined}
          onChange={(event) => {
            setClientId(event.target.value);
            setPatientId('');
          }}
        >
          <option value="">Choose a client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        {problem('Client') ? (
          <p className="field-error" id="book-client-error">
            Client is required.
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="book-patient">Patient</label>
        <select
          id="book-patient"
          value={patientId}
          aria-describedby={problem('Patient') ? 'book-patient-error' : undefined}
          onChange={(event) => setPatientId(event.target.value)}
        >
          <option value="">Choose a patient</option>
          {patients.map((patient) => (
            <option key={patient.id} value={patient.id}>
              {patient.name}
            </option>
          ))}
        </select>
        {problem('Patient') ? (
          <p className="field-error" id="book-patient-error">
            Patient is required.
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="book-vet">Vet</label>
        <select id="book-vet" value={vetId} onChange={(event) => setVetId(event.target.value)}>
          {vets.map((vet) => (
            <option key={vet.id} value={vet.id}>
              {vet.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="book-reason">Reason</label>
        <select id="book-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="Consult">Consult</option>
          <option value="Vaccination">Vaccination</option>
          <option value="Surgery">Surgery</option>
        </select>
      </div>
      <div className="dialog-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Book
        </Pill>
        <Pill variant="secondary" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Dialog>
  );
}

function AppointmentDetailsDialog({
  appointment,
  role,
  onClose,
  onDone,
  onFailure,
  onNavigate,
}: {
  appointment: Appointment;
  role: string;
  onClose: () => void;
  onDone: (message: string | null) => void;
  onFailure: (message: string) => void;
  onNavigate: (path: string) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const act = async (action: string, message: string): Promise<void> => {
    setBusy(true);
    try {
      await api('POST', `/api/appointments/${appointment.id}/${action}`);
      onDone(message);
    } catch (error) {
      onFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('DELETE', `/api/appointments/${appointment.id}`);
      onDone('Appointment cancelled.');
    } catch (error) {
      onFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  const canManage = role === 'front-desk' || role === 'vet' || role === 'manager';
  const canConsult = role === 'vet' || role === 'manager';
  return (
    <Dialog name="Appointment details" onClose={onClose}>
      <p className="dialog-text">
        {appointment.patientName} with {appointment.vetName}, {hm(appointment.start)} to{' '}
        {hm(appointment.end)}, {STATUS_LABELS[appointment.status]}
      </p>
      <div className="dialog-actions">
        {appointment.status === 'booked' && canManage ? (
          <Pill
            busy={busy}
            onClick={() => void act('check-in', `${appointment.patientName} checked in.`)}
          >
            Check in
          </Pill>
        ) : null}
        {appointment.status === 'checked-in' && canConsult ? (
          <Pill
            busy={busy}
            onClick={() => void act('start', `${appointment.patientName} is now in consult.`)}
          >
            Start consult
          </Pill>
        ) : null}
        {appointment.status === 'in-consult' && canConsult ? (
          <Pill
            busy={busy}
            onClick={() => void act('complete', `Consult completed for ${appointment.patientName}.`)}
          >
            Complete consult
          </Pill>
        ) : null}
        {appointment.status === 'booked' && canManage ? (
          <Pill
            busy={busy}
            variant="secondary"
            onClick={() => void act('no-show', `${appointment.patientName} marked no-show.`)}
          >
            Mark no-show
          </Pill>
        ) : null}
        {(appointment.status === 'booked' || appointment.status === 'checked-in') && canManage ? (
          <Pill busy={busy} variant="secondary" onClick={() => void cancel()}>
            Cancel appointment
          </Pill>
        ) : null}
        <Pill variant="secondary" onClick={onClose}>
          Close
        </Pill>
      </div>
      <div className="dialog-links">
        <a
          href={`/consult/${appointment.id}`}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(`/consult/${appointment.id}`);
          }}
        >
          Open consult
        </a>
        <a
          href={`/patients/${appointment.patientId}`}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(`/patients/${appointment.patientId}`);
          }}
        >
          Open patient
        </a>
      </div>
    </Dialog>
  );
}
