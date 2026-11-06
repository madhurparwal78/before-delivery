import { useEffect, useRef, useState } from 'react';
import { COPY } from '../../shared/copy';
import { addDays, dateIn, printDate, TOWN_ZONES } from '../../shared/time';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { useRoute, withParams } from '../router';
import type { Call, ClientList, Producer } from '../types';
import { AsyncButton, BottomBar, EmptyState, focusHeading, Heading, Link, LoadingBars, NotFound, Problems, SelectField, TextField, WIDE, classOf, useForm, useMedia } from '../ui/kit';
import { Overlay, useDialog, type DialogState } from '../ui/overlay';

const MINUTES = [['30', '30'], ['60', '60']] as const;

function BookForm({ state, producers, reload }: { state: DialogState; producers: Producer[]; reload: () => Promise<void> }) {
  const form = useForm('bookCall', () => ({ producerId: producers[0]?.id ?? '', date: '', time: '', minutes: '30', note: '' }), { focusMessage: true });
  const save = () =>
    form.submit(async () => {
      await api('/api/calls', { method: 'POST', body: { ...form.values, minutes: Number(form.values.minutes) } });
      await reload();
      announce(COPY.callBooked);
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <SelectField form={form} name="producerId" label="Producer" options={producers.map((producer) => [producer.id, producer.name] as const)} />
      <TextField form={form} name="date" label="Date" />
      <TextField form={form} name="time" label="Time" />
      <SelectField form={form} name="minutes" label="Minutes" options={MINUTES} />
      <TextField form={form} name="note" label="Note" />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

function MoveForm({ call, state, reload }: { call: Call; state: DialogState; reload: () => Promise<void> }) {
  const form = useForm(`moveCall:${call.id}`, () => ({ date: call.date, time: call.time, minutes: String(call.minutes) }), { focusMessage: true });
  const save = () =>
    form.submit(async () => {
      await api(`/api/calls/${call.id}`, { method: 'PATCH', body: { ...form.values, minutes: Number(form.values.minutes) } });
      await reload();
      announce(COPY.callMoved);
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <TextField form={form} name="date" label="Date" />
      <TextField form={form} name="time" label="Time" />
      <SelectField form={form} name="minutes" label="Minutes" options={MINUTES} />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

function CallCard({ call, reload, inGrid }: { call: Call; reload: () => Promise<void>; inGrid: boolean }) {
  const move = useDialog(`moveCall:${call.id}`);
  const cancel = async () => {
    try {
      await api(`/api/calls/${call.id}/cancel`, { method: 'POST' });
      await reload();
      announce(COPY.callCancelled);
      focusHeading();
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) announce(error.message);
    }
  };
  const stop = inGrid ? -1 : undefined;
  return (
    <article className="call-card">
      <p className="tabular">{call.text}</p>
      <p><strong>{call.producerName}</strong>{call.note ? ` · ${call.note}` : ''}</p>
      <div className="tools">
        <button type="button" className="btn btn-plain" tabIndex={stop} onClick={move.show}>Move call</button>
        <AsyncButton kind="plain" label="Cancel call" tabIndex={stop} onPress={cancel} />
      </div>
      <Overlay state={move} title="Move call"><MoveForm call={call} state={move} reload={reload} /></Overlay>
    </article>
  );
}

function WeekGrid({ days, calls, reload }: { days: string[]; calls: Map<string, Call[]>; reload: () => Promise<void> }) {
  const [active, setActive] = useState(0);
  const cells = useRef<(HTMLDivElement | null)[]>([]);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) {
      moved.current = false;
      cells.current[active]?.focus();
    }
  }, [active]);
  return (
    <div
      role="grid"
      aria-label="Week in Amsterdam time"
      className="week-grid"
      onKeyDown={(event) => {
        const inCell = event.target !== cells.current[active];
        if (event.key === 'Escape' && inCell) {
          event.preventDefault();
          cells.current[active]?.focus();
          return;
        }
        if (event.key === 'Enter' && !inCell) {
          event.preventDefault();
          cells.current[active]?.querySelector<HTMLElement>('button')?.focus();
          return;
        }
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
        const jump = event.key === 'Home' ? 0 : event.key === 'End' ? 6 : null;
        if (step === undefined && jump === null) return;
        event.preventDefault();
        moved.current = true;
        const next = jump ?? Math.max(0, Math.min(6, active + (step as number)));
        if (next === active) cells.current[active]?.focus();
        setActive(next);
      }}
    >
      <div role="row" className="week-head">
        {days.map((day) => <div role="columnheader" key={day}>{printDate(day)}</div>)}
      </div>
      <div role="row" className="week-row">
        {days.map((day, index) => (
          <div
            role="gridcell"
            key={day}
            ref={(element) => { cells.current[index] = element; }}
            tabIndex={index === active ? 0 : -1}
            onFocus={(event) => { if (event.target === event.currentTarget) setActive(index); }}
          >
            {(calls.get(day) ?? []).map((call) => <CallCard key={call.id} call={call} reload={reload} inGrid />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function amsterdamDate(call: Call): string {
  return dateIn(new Date(call.startsAt).getTime(), TOWN_ZONES.amsterdam);
}

export function Calls() {
  const route = useRoute();
  const wide = useMedia(WIDE);
  const book = useDialog('bookCall');
  const asked = route.search.get('week');
  const live = useLive(
    async () => {
      const today = await api<{ date: string; weekStart: string }>('/api/today');
      const week = asked ?? today.weekStart;
      const [calls, clients] = await Promise.all([
        api<{ calls: Call[] }>(`/api/calls?from=${week}&to=${addDays(week, 6)}`),
        api<ClientList>('/api/clients'),
      ]);
      const producers = (await Promise.all(clients.clients.filter((client) => client.state === 'active').map((client) => api<{ producers: Producer[] }>(`/api/clients/${client.id}/producers`)))).flatMap((list) => list.producers);
      return { week, calls: calls.calls.filter((call) => call.state === 'booked'), producers };
    },
    undefined,
    [asked],
  );
  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { week, calls, producers } = live.data;
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const byDay = new Map<string, Call[]>();
  for (const call of calls) {
    const day = amsterdamDate(call);
    byDay.set(day, [...(byDay.get(day) ?? []), call]);
  }
  return (
    <section className="screen">
      <Heading title="Calls" refreshFailed={live.refreshFailed} />
      <div className="pager week-pager">
        <Link href={withParams(route, { week: addDays(week, -7) })}>Earlier week</Link>
        <span className="tabular">{printDate(week)}</span>
        <Link href={withParams(route, { week: addDays(week, 7) })}>Later week</Link>
      </div>
      <BottomBar><button type="button" className={classOf('primary')} onClick={book.show}>Book a call</button></BottomBar>
      <Overlay state={book} title="Book a call"><BookForm state={book} producers={producers} reload={live.reload} /></Overlay>
      {!calls.length ? (
        <EmptyState>No calls this week.</EmptyState>
      ) : wide ? (
        <WeekGrid days={days} calls={byDay} reload={live.reload} />
      ) : (
        <div className="agenda">
          {days.filter((day) => byDay.has(day)).map((day) => (
            <section key={day} aria-label={printDate(day)}>
              <h2 className="section-title tabular">{printDate(day)}</h2>
              {(byDay.get(day) as Call[]).map((call) => <CallCard key={call.id} call={call} reload={live.reload} inGrid={false} />)}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
