import type { EventDto, RotaHeat } from '../../shared/api';
import { api } from '../api';
import { copy } from '../copy';
import { el, replace } from '../dom';
import { appLink, type ScreenContext } from '../main';
import { formatInZone, localDateTime } from '../ui';

export type EventSection =
  | 'overview'
  | 'timing'
  | 'rota'
  | 'live'
  | 'protests'
  | 'corrections'
  | 'publish';

const SECTION_LINKS: { section: EventSection; label: string; path: string }[] = [
  { section: 'overview', label: 'Overview', path: '' },
  { section: 'timing', label: 'Timing', path: '/timing' },
  { section: 'rota', label: 'Rota', path: '/rota' },
  { section: 'live', label: 'Live results', path: '/live' },
  { section: 'protests', label: 'Protests', path: '/protests' },
  { section: 'corrections', label: 'Corrections', path: '/corrections' },
  { section: 'publish', label: 'Publish', path: '/publish' },
];

export function canOpenSection(section: EventSection, roles: string[]): boolean {
  if (section === 'timing') return roles.includes('chair') || roles.includes('timing');
  if (section === 'publish') return roles.includes('chair');
  return true;
}

export interface EventShell {
  element: HTMLElement;
  content: HTMLElement;
  eventId: string;
  current: () => EventDto | null;
  rota: () => RotaHeat[];
  onEvent: (listener: (event: EventDto) => void) => void;
  onRota: (listener: (heats: RotaHeat[]) => void) => void;
  onHeatPicked: (listener: (heat: number) => void) => void;
  refreshEvent: () => Promise<EventDto | null>;
  refreshRota: () => Promise<void>;
  destroy: () => void;
}

export function createEventShell(ctx: ScreenContext, section: EventSection): EventShell {
  const eventId = ctx.params.id ?? '';
  const roles = ctx.user?.roles ?? [];
  const strip = el('div', {
    class: 'live-strip',
    attrs: { role: 'status', 'aria-label': 'Live heat', hidden: 'hidden' },
  });
  const heatPanel = el('div', { class: 'heat-panel' });
  const content = el('div', { class: 'event-content' });
  const sectionNav = el(
    'nav',
    { class: 'section-nav', attrs: { 'aria-label': 'Event sections' } },
    SECTION_LINKS.filter((link) => canOpenSection(link.section, roles)).map((link) =>
      appLink(
        link.label,
        `/events/${eventId}${link.path}`,
        link.section === section ? 'section-nav__link section-nav__link--current' : 'section-nav__link',
      ),
    ),
  );

  const element = el(
    'div',
    { class: 'screen screen--event' },
    strip,
    sectionNav,
    el('div', { class: 'event-layout' }, heatPanel, content),
  );

  let event: EventDto | null = null;
  let rotaHeats: RotaHeat[] = [];
  let selectedHeat = 1;
  const eventListeners: ((event: EventDto) => void)[] = [];
  const rotaListeners: ((heats: RotaHeat[]) => void)[] = [];
  const heatListeners: ((heat: number) => void)[] = [];

  const wide = window.matchMedia('(min-width: 1024px)');

  function heatClassLine(heat: number): string {
    const spec = event?.heats.find((candidate) => candidate.number === heat);
    return spec ? spec.classes.join(', ') : '';
  }

  function heatCount(heat: number): number {
    return rotaHeats.find((candidate) => candidate.number === heat)?.unfilled ?? 0;
  }

  function renderHeatPanel(): void {
    if (!event) {
      replace(heatPanel);
      return;
    }
    if (wide.matches) {
      replace(
        heatPanel,
        el(
          'nav',
          { class: 'heat-rail', attrs: { 'aria-label': 'Heats' } },
          el(
            'ul',
            { class: 'heat-rail__items' },
            event.heats.map((heat) =>
              el(
                'li',
                { class: 'heat-rail__item' },
                appLink(`Heat ${heat.number}`, `/events/${eventId}/rota`, 'heat-rail__link'),
                el('span', { class: 'heat-rail__classes', text: heat.classes.join(', ') }),
                el('span', {
                  class: 'heat-rail__count',
                  text: copy.stationsOpen(heatCount(heat.number)),
                }),
              ),
            ),
          ),
        ),
      );
      return;
    }

    const classLine = el('p', { class: 'heat-select__classes', text: heatClassLine(selectedHeat) });
    const countLine = el('p', {
      class: 'heat-select__count',
      text: copy.stationsOpen(heatCount(selectedHeat)),
    });
    const select = el(
      'select',
      {
        class: 'heat-select__input',
        attrs: { 'aria-label': 'Heat', id: 'heat-select' },
        on: {
          change: () => {
            selectedHeat = Number(select.value);
            classLine.textContent = heatClassLine(selectedHeat);
            countLine.textContent = copy.stationsOpen(heatCount(selectedHeat));
            for (const listener of heatListeners) listener(selectedHeat);
          },
        },
      },
      event.heats.map((heat) =>
        el('option', {
          text: `Heat ${heat.number}`,
          attrs: {
            value: heat.number,
            ...(heat.number === selectedHeat ? { selected: 'selected' } : {}),
          },
        }),
      ),
    );
    replace(heatPanel, el('div', { class: 'heat-select' }, select, classLine, countLine));
  }

  function renderStrip(): void {
    if (event && event.status === 'running' && event.runningHeat !== null) {
      strip.textContent = `Heat ${event.runningHeat} running`;
      strip.removeAttribute('hidden');
    } else {
      strip.textContent = '';
      strip.setAttribute('hidden', 'hidden');
    }
  }

  async function refreshEvent(): Promise<EventDto | null> {
    const result = await api.events.get(eventId);
    event = result.event;
    renderStrip();
    renderHeatPanel();
    for (const listener of eventListeners) listener(result.event);
    return result.event;
  }

  async function refreshRota(): Promise<void> {
    const result = await api.events.rota(eventId);
    rotaHeats = result.heats;
    renderHeatPanel();
    for (const listener of rotaListeners) listener(result.heats);
  }

  const eventTimer = window.setInterval(() => {
    void refreshEvent();
  }, 10_000);
  const rotaTimer = window.setInterval(() => {
    void refreshRota();
  }, 1_500);
  const onFocus = (): void => {
    void refreshEvent();
  };
  window.addEventListener('focus', onFocus);
  const onMediaChange = (): void => renderHeatPanel();
  wide.addEventListener('change', onMediaChange);

  void (async () => {
    await refreshEvent();
    await refreshRota();
  })();

  return {
    element,
    content,
    eventId,
    current: () => event,
    rota: () => rotaHeats,
    onEvent: (listener) => {
      eventListeners.push(listener);
      if (event) listener(event);
    },
    onRota: (listener) => {
      rotaListeners.push(listener);
      if (rotaHeats.length > 0) listener(rotaHeats);
    },
    onHeatPicked: (listener) => heatListeners.push(listener),
    refreshEvent,
    refreshRota,
    destroy: () => {
      window.clearInterval(eventTimer);
      window.clearInterval(rotaTimer);
      window.removeEventListener('focus', onFocus);
      wide.removeEventListener('change', onMediaChange);
    },
  };
}

export function statusLines(event: EventDto, timeZone: string): {
  registration: string;
  protestWindow: string | null;
} {
  const cutoff = localDateTime(event.registrationCutoff);
  const registration = event.registrationOpen
    ? copy.registrationLine(cutoff.date, cutoff.time)
    : copy.registrationClosed;
  let protestWindow: string | null = null;
  if (event.protestWindowOpen && event.protestWindowClosesAt) {
    protestWindow = copy.protestWindowLine(
      formatInZone(event.protestWindowClosesAt, timeZone).time,
    );
  } else if (event.provisionalAt !== null) {
    protestWindow = copy.protestWindowClosed;
  }
  return { registration, protestWindow };
}
