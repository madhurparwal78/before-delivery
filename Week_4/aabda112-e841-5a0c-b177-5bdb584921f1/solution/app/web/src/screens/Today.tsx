import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { can, SPECIES_LABEL } from '../../../shared/domain';
import { addDays, clinicInstant, clinicMinuteOfDay } from '../../../shared/clinictime';
import { announce } from '../lib/announce';
import { del, errorText, get, mutate, patch, post } from '../lib/api';
import { useEnv, useLayout, useMe, useMotion } from '../lib/env';
import { hm, longDayLabel } from '../lib/format';
import { useResource } from '../lib/resource';
import type { Appointment, ClientEntry, QueueEntry, Room } from '../lib/types';
import { AppointmentButton, type DropTarget } from '../components/AppointmentButton';
import { Calendar, slotOf, type Command } from '../components/Calendar';
import { KennelBeacons, type BeaconValues } from '../components/Beacons';
import { SplitBand } from '../components/Shell';
import { BookDialog, DetailsDialog, type BookRequest } from '../components/TodayDialogs';
import { ArrowChip, Avatar, Banner, Chip, EmptyCard, Pill, Skeleton } from '../components/ui';

type Dialog = { kind: 'book'; request: BookRequest; opener: HTMLElement | null } | { kind: 'details'; appointment: Appointment; opener: HTMLElement | null };

interface Toast {
  id: number;
  appointmentId: string;
}

function WaitingRoom({ queue, canStart, onStart, onGoToCalendar, starting }: { queue: QueueEntry[] | undefined; canStart: boolean; onStart: (entry: QueueEntry) => void; onGoToCalendar: () => void; starting: string | null }) {
  const motion = useMotion();
  const initial = useRef<Set<string> | null>(null);
  if (queue && initial.current === null) initial.current = new Set(queue.map((q) => q.appointmentId));
  if (!queue) return <Skeleton rows={2} />;
  if (queue.length === 0) {
    return (
      <EmptyCard title="No one is waiting." tone="mint">
        <Pill variant="blue" onClick={onGoToCalendar}>
          Go to calendar
        </Pill>
      </EmptyCard>
    );
  }
  return (
    <ul aria-label="Waiting room" className="queue">
      {queue.map((q) => (
        <li
          key={q.appointmentId}
          aria-label={`${q.patientName}, waiting ${q.waitingMinutes} min`}
          className={`queue-item tint-mint ${initial.current?.has(q.appointmentId) ? '' : 'arriving'}`}
          {...motion('queue-arrive', 400, 'ease-out')}
        >
          <Avatar name={q.patientName} size={48} />
          <div className="queue-main">
            <p className="queue-name">{q.patientName}</p>
            <div className="chip-row">
              <Chip>{SPECIES_LABEL[q.species]}</Chip>
              <Chip tone="mint">Waiting</Chip>
              {q.lateByMinutes !== null && <Chip tone="rose">{`Arrived ${q.lateByMinutes} min late`}</Chip>}
            </div>
            <p className="muted">{q.vetName}</p>
            <p className="queue-wait">{`waiting ${q.waitingMinutes} min`}</p>
          </div>
          <div className="queue-actions">
            {canStart && (
              <Pill variant="blue" busy={starting === q.appointmentId} aria-label={`Start consult for ${q.patientName}`} onClick={() => onStart(q)}>
                Start consult
              </Pill>
            )}
            <ArrowChip to={`/patients/${q.patientId}`} label={`Open ${q.patientName}`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Today() {
  const me = useMe();
  const { settings } = useEnv();
  const layout = useLayout();
  const canWrite = can(me.role, 'appointments.write');
  const canConsult = can(me.role, 'consult.run');

  const [date, setDate] = useState<string>();
  const time = useResource<{ now: string; clinicDate: string }>('/api/time');
  const chosen = date ?? time.data?.clinicDate;
  const appointments = useResource<{ appointments: Appointment[] }>(chosen ? `/api/appointments?date=${chosen}` : null, ['calendar']);
  const queue = useResource<{ queue: QueueEntry[] }>('/api/queue', ['queue']);
  const beacons = useResource<BeaconValues>('/api/beacons', ['ward', 'queue']);
  const rooms = useResource<{ rooms: Room[] }>('/api/rooms');
  const vets = useResource<{ vets: { id: string; name: string }[] }>('/api/vets', ['staff']);
  const clients = useResource<{ clients: ClientEntry[] }>('/api/clients', ['patients']);

  const gridRef = useRef<HTMLDivElement>(null);
  const agendaRef = useRef<HTMLUListElement>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const toastCount = useRef(0);
  const focusAppointment = useRef<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const motion = useMotion();
  const undoing = useRef(false);

  const list = appointments.data?.appointments;
  const slotMs = (settings?.slotMinutes ?? 15) * 60_000;

  useLayoutEffect(() => {
    const id = focusAppointment.current;
    if (!id) return;
    const target = document.querySelector<HTMLElement>(`[data-testid="appt-${id}"]`);
    if (target) {
      target.focus();
      focusAppointment.current = null;
    }
  });

  const guard = async (work: () => Promise<void>) => {
    setAlert(null);
    try {
      await work();
    } catch (error) {
      setAlert(errorText(error));
    }
  };

  const replace = (updated: Appointment) => appointments.set((d) => ({ appointments: d.appointments.map((a) => (a.id === updated.id ? updated : a)) }));

  const showToast = (appointmentId: string, ms: number) => {
    window.clearTimeout(toastTimer.current);
    const id = ++toastCount.current;
    setToast({ id, appointmentId });
    toastTimer.current = window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), ms);
  };

  const cancel = async (a: Appointment) => {
    await mutate(
      () => del<{ undoUntil: string; now: string }>(`/api/appointments/${a.id}`),
      (result) => {
        flushSync(() => appointments.set((d) => ({ appointments: d.appointments.filter((x) => x.id !== a.id) })));
        showToast(a.id, Date.parse(result.undoUntil) - Date.parse(result.now));
        announce('Appointment cancelled.');
        if (settings && chosen) {
          const cell = gridRef.current?.querySelector<HTMLElement>(`[data-room="${a.roomId}"][data-slot="${slotOf(chosen, a.start, settings)}"]`);
          cell?.focus();
        }
      },
    );
  };

  const undo = async () => {
    if (!toast || undoing.current) return;
    const target = toast.appointmentId;
    undoing.current = true;
    setAlert(null);
    try {
      await mutate(
        () => post<Appointment>(`/api/appointments/${target}/restore`),
        (restored) => {
          setToast(null);
          window.clearTimeout(toastTimer.current);
          appointments.set((d) => ({ appointments: [...d.appointments.filter((x) => x.id !== restored.id), restored] }));
          announce('Appointment restored.');
          focusAppointment.current = restored.id;
        },
      );
      appointments.reload();
    } catch (error) {
      setToast(null);
      window.clearTimeout(toastTimer.current);
      setAlert(errorText(error));
    } finally {
      undoing.current = false;
    }
  };

  const moveTo = (a: Appointment, patchBody: { start?: string; roomId?: string; minutes?: number }, say: (updated: Appointment) => string) =>
    guard(() =>
      mutate(
        () => patch<Appointment>(`/api/appointments/${a.id}`, patchBody),
        (updated) => {
          replace(updated);
          announce(say(updated));
          focusAppointment.current = updated.id;
        },
      ).then(() => undefined),
    );

  const onCommand = (command: Command) => {
    if (!settings || !rooms.data || !chosen) return;
    const roomList = rooms.data.rooms;
    switch (command.type) {
      case 'open':
        setDialog({ kind: 'details', appointment: command.appointment, opener: command.opener });
        break;
      case 'book': {
        const start = clinicInstant(chosen, Math.floor(settings.openMinute / 60), settings.openMinute % 60)!.getTime() + command.slot * slotMs;
        openBooking(roomList.find((r) => r.id === command.roomId)!, new Date(start), command.opener);
        break;
      }
      case 'move': {
        const a = command.appointment;
        const roomIndex = roomList.findIndex((r) => r.id === a.roomId) + command.roomDelta;
        const room = roomList[roomIndex];
        if (!room) return;
        const start = new Date(new Date(a.start).getTime() + command.slotDelta * slotMs).toISOString();
        void moveTo(a, { start, roomId: room.id }, (u) => `Moved ${u.patientName} to ${u.roomName}, ${hm(u.start)}.`);
        break;
      }
      case 'resize': {
        const a = command.appointment;
        const minutes = (new Date(a.end).getTime() - new Date(a.start).getTime()) / 60_000 + command.slotDelta * settings.slotMinutes;
        if (minutes < settings.slotMinutes) return;
        void moveTo(a, { minutes }, (u) => `${u.patientName} now runs ${hm(u.start)} to ${hm(u.end)}.`);
        break;
      }
      case 'check-in': {
        const a = command.appointment;
        void guard(() =>
          mutate(
            () => post<Appointment>(`/api/appointments/${a.id}/check-in`),
            (updated) => {
              replace(updated);
              announce(`${updated.patientName} checked in.`);
              focusAppointment.current = updated.id;
            },
          ).then(() => undefined),
        );
        break;
      }
      case 'cancel':
        void guard(() => cancel(command.appointment));
        break;
      case 'drop': {
        if (!command.target) return;
        const room = roomList.find((r) => r.id === command.target!.roomId);
        const a = command.appointment;
        const start = new Date(clinicInstant(chosen, Math.floor(settings.openMinute / 60), settings.openMinute % 60)!.getTime() + command.target.slot * slotMs);
        if (!room || (room.id === a.roomId && start.getTime() === new Date(a.start).getTime())) return;
        void moveTo(a, { start: start.toISOString(), roomId: room.id }, (u) => `Moved ${u.patientName} to ${u.roomName}, ${hm(u.start)}.`);
        break;
      }
    }
  };

  const firstFreeVet = (start: Date): string => {
    const taken = (list ?? []).filter((a) => new Date(a.start).getTime() < start.getTime() + slotMs && new Date(a.end).getTime() > start.getTime());
    const all = vets.data?.vets ?? [];
    return (all.find((v) => !taken.some((a) => a.vetId === v.id)) ?? all[0])?.id ?? '';
  };

  const openBooking = (room: Room, start: Date, opener: HTMLElement | null) => {
    setAlert(null);
    setDialog({ kind: 'book', request: { room, start: start.toISOString(), vetId: firstFreeVet(start) }, opener });
  };

  const bookATime = async () => {
    if (!settings || !rooms.data || !chosen) return;
    setAlert(null);
    try {
      const server = await get<{ now: string; clinicDate: string }>('/api/time');
      const open = clinicInstant(chosen, Math.floor(settings.openMinute / 60), settings.openMinute % 60)!.getTime();
      const today = server.clinicDate === chosen;
      const from = today ? Math.max(open, Math.ceil(Date.parse(server.now) / slotMs) * slotMs) : open;
      const close = open + (settings.closeMinute - settings.openMinute) * 60_000;
      for (let at = from; at < close; at += slotMs) {
        const start = new Date(at);
        const busy = (list ?? []).filter((a) => new Date(a.start).getTime() < at + slotMs && new Date(a.end).getTime() > at);
        const vetId = (vets.data?.vets ?? []).find((v) => !busy.some((a) => a.vetId === v.id))?.id;
        const room = rooms.data.rooms.find((r) => !busy.some((a) => a.roomId === r.id));
        if (vetId && room) {
          setDialog({ kind: 'book', request: { room, start: start.toISOString(), vetId }, opener: document.activeElement as HTMLElement | null });
          return;
        }
      }
      setAlert('No times are available on this day.');
    } catch (error) {
      setAlert(errorText(error));
    }
  };

  const startConsult = (entry: QueueEntry) => {
    if (starting) return;
    setStarting(entry.appointmentId);
    setAlert(null);
    mutate(
      () => post<Appointment>(`/api/appointments/${entry.appointmentId}/start`),
      (started) => {
        announce(`${started.patientName} is now in consult.`);
        queue.set((q) => ({ queue: q.queue.filter((x) => x.appointmentId !== entry.appointmentId) }));
      },
    )
      .catch((error: unknown) => setAlert(errorText(error)))
      .finally(() => setStarting(null));
  };

  const goToCalendar = () => {
    if (layout === 'phone') agendaRef.current?.focus();
    else gridRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus();
  };

  const jumpToToday = () => {
    get<{ clinicDate: string }>('/api/time').then((t) => setDate(t.clinicDate), () => undefined);
  };

  const onRegionKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && toast) {
      event.preventDefault();
      void undo();
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 't' || event.key === 'T') && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      jumpToToday();
    }
  };

  const shiftDay = (days: number) => chosen && setDate(addDays(chosen, days));
  const roomList = rooms.data?.rooms;
  const startMinute = time.data && time.data.clinicDate === chosen ? clinicMinuteOfDay(new Date(time.data.now)) : (settings?.openMinute ?? 0);
  const ready = settings && roomList && list && chosen;

  return (
    <>
      <SplitBand title="Today" aside={chosen && <span className="band-date">{longDayLabel(chosen)}</span>}>
        <KennelBeacons values={beacons.data} />
      </SplitBand>
      <div className="today-grid">
        <section className="waiting" aria-labelledby="waiting-title">
          <h2 id="waiting-title" className="section-title">
            Waiting room
          </h2>
          <WaitingRoom queue={queue.data?.queue} canStart={canConsult} onStart={startConsult} onGoToCalendar={goToCalendar} starting={starting} />
        </section>
        <section className="calendar-region" aria-label="Calendar" onKeyDown={onRegionKey}>
          <div className="day-controls">
            <Pill variant="outline" className="on-light" onClick={() => shiftDay(-1)}>
              Previous day
            </Pill>
            <Pill variant="outline" className="on-light" onClick={() => shiftDay(1)}>
              Next day
            </Pill>
            {chosen && <span className="day-label">{longDayLabel(chosen)}</span>}
            {layout === 'phone' && canWrite && (
              <Pill onClick={() => void bookATime()}>Book a time</Pill>
            )}
          </div>
          <Banner message={alert} />
          {toast && (
            <div role="status" aria-label="Notice" className="toast" {...motion('toast', 200, 'ease-out')}>
              <span>Appointment cancelled.</span>
              <Pill variant="mint" onClick={() => void undo()}>
                Undo
              </Pill>
            </div>
          )}
          {!ready ? (
            <Skeleton rows={6} />
          ) : layout === 'phone' ? (
            <ul aria-label="Day agenda" className="agenda" tabIndex={-1} ref={agendaRef}>
              {list.length === 0 && <li className="agenda-empty">No appointments on this day.</li>}
              {list.map((a) => (
                <li key={a.id}>
                  <AppointmentButton
                    appointment={a}
                    slots={1}
                    canMove={false}
                    gridRef={gridRef}
                    inAgenda
                    onOpen={(appointment, opener) => onCommand({ type: 'open', appointment, opener })}
                    onKey={() => undefined}
                    onDrop={(appointment: Appointment, target: DropTarget | null) => onCommand({ type: 'drop', appointment, target })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Calendar date={chosen} rooms={roomList} appointments={list} settings={settings} canWrite={canWrite} gridRef={gridRef} startMinute={startMinute} onCommand={onCommand} />
          )}
        </section>
      </div>
      {dialog?.kind === 'book' && clients.data && vets.data && (
        <BookDialog
          request={dialog.request}
          vets={vets.data.vets}
          clients={clients.data.clients}
          returnFocus={() => (dialog.opener?.isConnected ? dialog.opener : null)}
          onClose={() => setDialog(null)}
          onBooked={(made) => {
            setDialog(null);
            appointments.set((d) => ({ appointments: [...d.appointments.filter((x) => x.id !== made.id), made] }));
            focusAppointment.current = made.id;
          }}
        />
      )}
      {dialog?.kind === 'details' && (
        <DetailsDialog
          appointment={list?.find((a) => a.id === dialog.appointment.id) ?? dialog.appointment}
          returnFocus={() => (dialog.opener?.isConnected ? dialog.opener : null)}
          onClose={() => setDialog(null)}
          onCancelled={cancel}
          onChanged={() => {
            appointments.reload();
            queue.reload();
          }}
        />
      )}
    </>
  );
}
