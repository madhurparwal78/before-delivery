import { COPY, LABELS } from '../../domain/copy.js';
import { addDaysIso } from '../../domain/time.js';
import {
  announce,
  api,
  closeSurface,
  focusBack,
  focusHeading,
  openSurface,
  queryOf,
  redraw,
  refreshOnce,
  registerScreen,
  run,
  setQuery,
  state,
} from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { registerSurface } from '../shell.js';
import { guard } from './clients.js';
import {
  button,
  combobox,
  emptyState,
  field,
  link,
  loadingBars,
  problemsRegion,
  surfaceView,
} from '../ui.js';
import type { Client, Producer } from './jobs.js';

export type Call = {
  id: string;
  producerId: string;
  producerName: string;
  town: string;
  date: string;
  time: string;
  minutes: number;
  note: string;
  startsAt: string;
  endsAt: string;
  text: string;
  uid: string;
  sequence: number;
  state: string;
};

type CallsData = {
  calls: Call[];
  producers: Producer[];
  weekStart: string;
};

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let roving = 0;

registerScreen({
  name: 'calls',
  frame: 'desk',
  refreshes: true,
  heading: () => 'Calls',
  load: async () => {
    const asked = queryOf().get('week');
    const weekStart =
      asked ?? (await api<{ weekStart: string }>('/api/today')).weekStart;
    const from = weekStart;
    const to = addDaysIso(weekStart, 6);
    const [calls, clients] = await Promise.all([
      api<{ calls: Call[] }>(`/api/calls?from=${from}&to=${to}`),
      api<{ clients: Client[] }>('/api/clients'),
    ]);
    const producers: Producer[] = [];
    for (const client of clients.clients) {
      const answer = await api<{ producers: Producer[] }>(
        `/api/clients/${client.id}/producers`,
      );
      producers.push(...answer.producers);
    }
    return { calls: calls.calls, producers, weekStart } as unknown as Record<string, unknown>;
  },
  mainAction: (raw) => {
    const data = raw as unknown as CallsData;
    return button({
      id: 'book-a-call',
      label: 'Book a call',
      kind: 'primary',
      onPress: () =>
        openSurface('Book a call', 'book-a-call', {
          values: {
            producerId: data.producers?.[0]?.id ?? '',
            minutes: '30',
            date: data.weekStart ?? '',
            time: '09:00',
          },
        }),
    });
  },
  view: (raw) => {
    const data = raw as unknown as CallsData;
    if (state.loading) return [loadingBars('Reading the week')];
    const booked = data.calls.filter((call) => call.state === 'booked');
    const days = Array.from({ length: 7 }, (unused, index) =>
      addDaysIso(data.weekStart, index),
    );
    return [
      h(
        'div',
        { key: 'weeks', class: 'pair' },
        link(`/desk/calls?week=${addDaysIso(data.weekStart, -7)}`, 'Earlier week', {
          onclick: (event: Event) => {
            event.preventDefault();
            setQuery({ week: addDaysIso(data.weekStart, -7) });
          },
        }),
        link(`/desk/calls?week=${addDaysIso(data.weekStart, 7)}`, 'Later week', {
          onclick: (event: Event) => {
            event.preventDefault();
            setQuery({ week: addDaysIso(data.weekStart, 7) });
          },
        }),
      ),
      h(
        'div',
        {
          key: 'grid',
          class: 'week-grid',
          role: 'grid',
          'aria-label': 'Week in Amsterdam time',
          onkeydown: (event: Event) => moveRovingStop(event as KeyboardEvent),
        },
        h(
          'div',
          { class: 'week-grid__row', role: 'row' },
        ...days.map((day, index) =>
          h(
            'div',
            {
              key: day,
              class: 'week-grid__day',
              role: 'gridcell',
              tabindex: index === roving ? '0' : '-1',
              'aria-label': `${DAY_NAMES[index]} ${day}`,
              onfocus: () => {
                roving = index;
              },
            },
            h('h3', { class: 'numeric' }, day),
            ...callsOn(booked, day),
          ),
        ),
        ),
      ),
      h(
        'div',
        { key: 'agenda', class: 'agenda' },
        ...days.map((day, index) =>
          h(
            'section',
            { key: day },
            h('h3', { class: 'numeric' }, `${DAY_NAMES[index]} ${day}`),
            ...callsOn(booked, day),
          ),
        ),
      ),
      booked.length === 0 ? emptyState('No call booked in this week.') : null,
    ];
  },
});

function callsOn(calls: Call[], day: string): Child[] {
  const shown = calls.filter((call) => amsterdamDate(call) === day);
  return shown.map((call) =>
    h(
      'div',
      { key: call.id, class: 'call' },
      h('p', { class: 'call__time' }, call.text),
      h('p', {}, `${call.producerName} · ${call.minutes} min`),
      call.note === '' ? null : h('p', {}, call.note),
      h(
        'div',
        { class: 'call__buttons' },
        button({
          id: `move-call-${call.id}`,
          label: 'Move call',
          onPress: () =>
            openSurface('Move call', `move-call-${call.id}`, {
              values: {
                id: call.id,
                date: call.date,
                time: call.time,
                minutes: String(call.minutes),
              },
            }),
        }),
        button({
          id: `cancel-call-${call.id}`,
          label: 'Cancel call',
          pendingKey: `cancel-${call.id}`,
          onPress: () =>
            void run(`cancel-${call.id}`, async () => {
              await api(`/api/calls/${call.id}/cancel`, { method: 'POST' });
              announce(COPY.callCancelled);
              await refreshOnce();
              focusHeading();
            }),
        }),
      ),
    ),
  );
}

const AMSTERDAM_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The desk calendar is in Amsterdam time whatever the browser's zone says. */
function amsterdamDate(call: Call): string {
  return AMSTERDAM_DATE.format(new Date(call.startsAt));
}

/** The week grid has a roving Tab stop. */
function moveRovingStop(event: KeyboardEvent): void {
  const steps: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: 1,
    ArrowUp: -1,
  };
  const step = steps[event.key];
  if (step === undefined) return;
  event.preventDefault();
  roving = Math.min(6, Math.max(0, roving + step));
  redraw();
  requestAnimationFrame(() => {
    document
      .querySelectorAll<HTMLElement>('.week-grid__day')
      [roving]?.focus();
  });
}

registerSurface('Book a call', (surface) =>
  callDialog(surface, 'Book a call', async () => {
    await api('/api/calls', {
      method: 'POST',
      body: {
        producerId: surface.values['producerId'] ?? '',
        date: surface.values['date'] ?? '',
        time: surface.values['time'] ?? '',
        minutes: Number(surface.values['minutes'] ?? '30'),
        note: surface.values['note'] ?? '',
      },
    });
    closeSurface('Book a call');
    announce(COPY.callBooked);
    await refreshOnce();
    focusBack('book-a-call');
  }),
);

registerSurface('Move call', (surface) =>
  callDialog(surface, 'Move call', async () => {
    await api(`/api/calls/${surface.values['id'] ?? ''}`, {
      method: 'PATCH',
      body: {
        date: surface.values['date'] ?? '',
        time: surface.values['time'] ?? '',
        minutes: Number(surface.values['minutes'] ?? '30'),
      },
    });
    closeSurface('Move call');
    announce(COPY.callMoved);
    await refreshOnce();
  }),
);

function callDialog(
  surface: Parameters<typeof surfaceView>[0],
  title: string,
  save: () => Promise<void>,
): Child {
  const data = state.data as unknown as CallsData;
  const set = (name: string) => (value: string) => {
    surface.values[name] = value;
    redraw();
  };
  return surfaceView(surface, {
    title,
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      title === 'Book a call'
        ? combobox({
            id: 'call-producer',
            label: 'Producer',
            value: surface.values['producerId'] ?? '',
            options: (data.producers ?? []).map((producer) => ({
              value: producer.id,
              label: producer.name,
            })),
            onChange: set('producerId'),
            problem: surface.problems['producerId'],
          })
        : null,
      field({
        id: 'call-date',
        label: 'Date',
        value: surface.values['date'] ?? '',
        onInput: set('date'),
        problem: surface.problems['date'],
      }),
      field({
        id: 'call-time',
        label: 'Time',
        value: surface.values['time'] ?? '',
        onInput: set('time'),
        problem: surface.problems['time'],
      }),
      combobox({
        id: 'call-minutes',
        label: 'Minutes',
        value: surface.values['minutes'] ?? '30',
        options: Object.entries(LABELS.minutes).map(([value, label]) => ({ value, label })),
        onChange: set('minutes'),
      }),
      title === 'Book a call'
        ? field({
            id: 'call-note',
            label: 'Note',
            value: surface.values['note'] ?? '',
            onInput: set('note'),
          })
        : null,
    ],
    footer: [
      button({
        id: 'save-call',
        label: 'Save',
        kind: 'primary',
        pendingKey: `call-${title}`,
        onPress: () => void run(`call-${title}`, guard(surface, save)),
      }),
    ],
  });
}
