// The Handshake track: five stations, one keyboard composite, one Tab stop,
// arrows and Home/End, Enter opens the station's detail sheet. The track is
// updated in place so the token glides and the rings fill as browser-run
// transitions; under reduced motion everything is placed at its end state.
import { h, reducedMotion } from './dom.js';
import { openDialog, type PanelHandle } from './panels.js';

export interface TrackStationView { station: string; label: string; state: string; text: string; at: string | null }

export interface TrackFacts {
  nameAsSent: string | null;
  rule: string | null;
  rate: string | null;
  fiatValue: string | null;
  answer: string | null;
}

export interface TrackHandle { el: HTMLElement; update: (stations: TrackStationView[], facts: TrackFacts) => void }

const STATION_WIDTH = 118;

export function createTrack(
  stations: TrackStationView[],
  facts: TrackFacts,
  formatStamp: (iso: string | null) => string,
): TrackHandle {
  const toolbar = h('div', { role: 'toolbar', 'aria-label': 'Handshake track', class: 'track' });
  const stationEls: HTMLElement[] = [];
  let lastReachedIndex = 0;
  const state = { stations };

  for (const station of stations) {
    const button = h('button', {
      type: 'button',
      class: `station state-${station.state}`,
      'data-station': station.station,
      'data-state': station.state,
      ...(station.at !== null ? { 'data-at': station.at } : {}),
      tabindex: '0',
    },
      h('span', { class: 'ring', 'aria-hidden': 'true' }),
      h('span', { class: 'station-label' }, station.label),
      h('span', { class: 'station-text' }, station.text),
      h('span', { class: 'station-stamp' }, station.at !== null ? formatStamp(station.at) : ''),
    );

    let tooltip: HTMLElement | null = null;
    const showTooltip = (): void => {
      if (tooltip !== null) return;
      tooltip = h('div', { class: 'tooltip', role: 'tooltip' }, tooltipText());
      button.append(tooltip);
      void button.offsetWidth;
      tooltip.classList.add('shown');
    };
    const hideTooltip = (): void => {
      if (tooltip === null) return;
      const tip = tooltip;
      tooltip = null;
      tip.classList.remove('shown');
      setTimeout(() => tip.remove(), reducedMotion() ? 0 : 160);
    };
    const tooltipText = (): string => `${station.label}${station.at !== null ? ` ${formatStamp(station.at)}` : ''}`;

    button.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse' || (e as PointerEvent).pointerType === 'pen') showTooltip();
    });
    button.addEventListener('pointerleave', hideTooltip);
    button.addEventListener('focus', showTooltip);
    button.addEventListener('blur', hideTooltip);
    button.addEventListener('click', () => {
      hideTooltip();
      openStationSheet(state.stations[stations.indexOf(station)] ?? station, facts, formatStamp, button);
    });

    button.addEventListener('keydown', (e) => {
      const move = (delta: number): void => {
        e.preventDefault();
        const next = (stationEls.indexOf(button) + delta + stationEls.length) % stationEls.length;
        stationEls.forEach((el, i) => el.setAttribute('tabindex', i === next ? '0' : '-1'));
        stationEls[next].focus();
      };
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(-1);
      else if (e.key === 'Home') {
        e.preventDefault();
        stationEls.forEach((el, i) => el.setAttribute('tabindex', i === 0 ? '0' : '-1'));
        stationEls[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = stationEls.length - 1;
        stationEls.forEach((el, i) => el.setAttribute('tabindex', i === last ? '0' : '-1'));
        stationEls[last].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openStationSheet(state.stations[stations.indexOf(station)] ?? station, facts, formatStamp, button);
      }
    });

    stationEls.push(button);
    toolbar.append(button);
    if (station.station !== 'closed') {
      toolbar.append(h('span', { class: 'connector', 'aria-hidden': 'true' }));
    }
  }

  // the token glides to the last reached station
  const token = h('span', { class: 'token', 'aria-hidden': 'true' });
  toolbar.append(token);
  const rail = h('div', { class: 'track-rail' }, toolbar);
  const initialReached = reachedIndex(stations);
  lastReachedIndex = initialReached;
  placeToken(initialReached, true);

  function reachedIndex(list: TrackStationView[]): number {
    const reached = list.filter((s) => s.state === 'done' || s.state === 'late' || s.state === 'refused');
    const lastReached = reached.length > 0 ? reached[reached.length - 1] : list[0];
    return list.indexOf(lastReached);
  }

  function placeToken(index: number, instant: boolean): void {
    const left = `calc(${index} * ${STATION_WIDTH}px + ${STATION_WIDTH / 2 - 7}px)`;
    if (instant || reducedMotion()) {
      token.style.transition = 'none';
      token.style.left = left;
    } else {
      token.style.transition = 'left var(--t-travel) var(--ease)';
      token.style.left = left;
    }
    token.style.opacity = '1';
    token.classList.add('placed');
    toolbar.querySelectorAll('.connector').forEach((connector, i) => {
      connector.classList.toggle('reached', i < index);
    });
  }

  const handle: TrackHandle = {
    el: rail,
    update(next: TrackStationView[], nextFacts: TrackFacts): void {
      Object.assign(facts, nextFacts);
      state.stations = next;
      next.forEach((station, index) => {
        const el = stationEls[index];
        el.className = `station state-${station.state}`;
        el.setAttribute('data-state', station.state);
        if (station.at !== null) el.setAttribute('data-at', station.at);
        else el.removeAttribute('data-at');
        (el.querySelector('.station-text') as HTMLElement).textContent = station.text;
        (el.querySelector('.station-stamp') as HTMLElement).textContent = station.at !== null ? formatStamp(station.at) : '';
      });
      const focusIndex = (() => {
        const current = next.findIndex((s) => s.state === 'current');
        if (current >= 0) return current;
        return reachedIndex(next);
      })();
      stationEls.forEach((el, i) => el.setAttribute('tabindex', i === focusIndex ? '0' : '-1'));
      const index = reachedIndex(next);
      if (index !== lastReachedIndex || true) {
        placeToken(index, false);
        lastReachedIndex = index;
      }
    },
  };

  return handle;
}

function openStationSheet(station: TrackStationView, facts: TrackFacts, formatStamp: (iso: string | null) => string, opener: HTMLElement): void {
  let handle: PanelHandle | null = null;
  handle = openDialog({
    name: station.label,
    kind: 'sheet',
    opener,
    onClose: () => {},
    build: (dialog) => {
      const close = h('button', { type: 'button', class: 'btn', 'aria-label': 'Close', onclick: () => handle?.close() }, 'Close');
      dialog.append(
        h('h2', {}, station.label),
        h('p', { class: 'station-sheet-stamp mono' }, station.at !== null ? formatStamp(station.at) : station.text),
        h('dl', { class: 'facts-list' },
          factRow('Name as sent', facts.nameAsSent ?? '—'),
          factRow('Rule', facts.rule ?? '—'),
          factRow('Rate', facts.rate ?? '—'),
          factRow('Fiat value', facts.fiatValue ?? '—'),
          factRow('Answer', facts.answer ?? '—'),
        ),
        h('div', { class: 'dialog-actions' }, close),
      );
    },
  });
}

function factRow(name: string, value: string): HTMLElement {
  return h('div', { class: 'fact-row' }, h('dt', {}, name), h('dd', {}, value));
}
