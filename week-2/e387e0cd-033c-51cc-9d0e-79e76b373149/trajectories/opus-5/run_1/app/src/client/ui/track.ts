import { button, element } from '../dom';
import { BusinessClock, showCrypto, showDate, showDateTime, showMoney } from '../format';
import { Dialog, dialogActions } from './dialog';

export interface StationView {
  readonly station: string;
  readonly label: string;
  readonly state: string;
  readonly text: string;
  readonly at: string | null;
}

export interface TrackFacts {
  readonly nameAsSent: string | null;
  readonly rule: string;
  readonly rate: string;
  readonly fiatValue: string;
  readonly answer: string;
}

const REACHED = ['done', 'late', 'refused'];

/** The handshake track: one keyboard composite with a single Tab stop. */
export class HandshakeTrack {
  readonly node: HTMLElement;
  private readonly token: HTMLElement;
  private readonly stations: HTMLButtonElement[] = [];
  private readonly rings = new Map<string, SVGCircleElement>();
  private readonly stamps = new Map<string, HTMLElement>();
  private readonly texts = new Map<string, HTMLElement>();
  private readonly sheets = new Map<string, Dialog>();
  private readonly tooltip: HTMLElement;
  private focusIndex = 0;
  private touched = false;
  private views: readonly StationView[] = [];
  private facts: TrackFacts;

  constructor(
    private readonly layer: HTMLElement,
    private readonly clock: BusinessClock,
    views: readonly StationView[],
    facts: TrackFacts,
  ) {
    this.facts = facts;
    this.token = element('span', { className: 'track-token', attributes: { 'aria-hidden': 'true' } });
    this.tooltip = element('div', {
      className: 'track-tooltip',
      attributes: { role: 'tooltip', id: 'handshake-tooltip', hidden: 'hidden' },
    });
    this.node = element('div', {
      className: 'track',
      attributes: { role: 'toolbar', 'aria-label': 'Handshake track' },
    });
    for (const view of views) {
      this.node.append(this.buildStation(view));
    }
    this.node.append(this.token, this.tooltip);
    this.node.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.update(views, facts);
  }

  private buildStation(view: StationView): HTMLButtonElement {
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('cx', '18');
    ring.setAttribute('cy', '18');
    ring.setAttribute('r', '15');
    ring.setAttribute('class', 'track-ring');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('class', 'track-ring-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.append(ring);
    const label = element('span', { text: view.label, className: 'station-label' });
    const text = element('span', { text: view.text, className: 'station-text' });
    const stamp = element('span', { className: 'station-stamp mono' });
    const control = element('button', {
      className: 'station control',
      attributes: {
        type: 'button',
        'data-station': view.station,
        'data-state': view.state,
        tabindex: '-1',
      },
      children: [svg, label, text, stamp],
    });
    control.addEventListener('click', () => this.openSheet(view.station, control));
    control.addEventListener('focus', () => {
      this.focusIndex = this.stations.indexOf(control);
      this.touched = true;
      this.setRovingStop();
    });
    control.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      this.showTooltip(view.station, control);
    });
    control.addEventListener('pointerleave', () => this.hideTooltip(control));
    control.addEventListener('blur', () => this.hideTooltip(control));
    this.stations.push(control);
    this.rings.set(view.station, ring);
    this.stamps.set(view.station, stamp);
    this.texts.set(view.station, text);
    return control;
  }

  private showTooltip(station: string, control: HTMLButtonElement): void {
    const view = this.views.find((entry) => entry.station === station);
    if (view === undefined) return;
    this.tooltip.textContent =
      view.at === null
        ? view.label
        : `${view.label}, ${showDateTime(view.at, this.clock)}`;
    this.tooltip.removeAttribute('hidden');
    this.tooltip.style.setProperty('--tooltip-index', String(this.stations.indexOf(control)));
    control.setAttribute('aria-describedby', 'handshake-tooltip');
  }

  private hideTooltip(control: HTMLButtonElement): void {
    this.tooltip.setAttribute('hidden', 'hidden');
    control.removeAttribute('aria-describedby');
  }

  private setRovingStop(): void {
    this.stations.forEach((station, index) => {
      station.setAttribute('tabindex', index === this.focusIndex ? '0' : '-1');
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Enter', ' '];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter' || event.key === ' ') {
      const control = this.stations[this.focusIndex];
      this.openSheet(control.dataset.station ?? '', control);
      return;
    }
    let next = this.focusIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = this.focusIndex + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = this.focusIndex - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = this.stations.length - 1;
    if (next < 0 || next >= this.stations.length) return;
    this.focusIndex = next;
    this.setRovingStop();
    this.stations[next].focus();
  }

  private openSheet(station: string, control: HTMLButtonElement): void {
    const view = this.views.find((entry) => entry.station === station);
    if (view === undefined) return;
    const existing = this.sheets.get(station);
    if (existing !== undefined) {
      existing.open(control);
      return;
    }
    const sheet = new Dialog(this.layer, {
      name: view.label,
      style: 'bottom-sheet',
      build: (controller) => {
        const close = button('Close', () => controller.close());
        const facts = element('dl', {
          className: 'station-facts',
          children: [
            fact('Station', view.label),
            fact('Stamp', view.at === null ? 'Not reached' : showDateTime(view.at, this.clock)),
            fact('Name as sent', this.facts.nameAsSent ?? 'Self-hosted wallet'),
            fact('Rule', this.facts.rule),
            fact('Rate', this.facts.rate),
            fact('Fiat value', this.facts.fiatValue),
            fact('Answer', this.facts.answer),
          ].flat(),
        });
        return {
          body: [
            element('h2', { text: view.label, className: 'dialog-title' }),
            element('p', { text: view.text, className: 'station-sheet-text' }),
            facts,
            dialogActions(close),
          ],
          first: () => close,
        };
      },
    });
    this.sheets.set(station, sheet);
    sheet.open(control);
  }

  update(views: readonly StationView[], facts: TrackFacts): void {
    this.views = views;
    this.facts = facts;
    const waitingForAnswer = views.some(
      (view) =>
        view.station === 'answered' && view.state === 'current' && view.text === 'Waiting for answer',
    );
    this.node.dataset.waiting = waitingForAnswer ? 'true' : 'false';
    views.forEach((view, index) => {
      const control = this.stations[index];
      control.dataset.state = view.state;
      if (view.at === null) control.removeAttribute('data-at');
      else control.setAttribute('data-at', view.at);
      const text = this.texts.get(view.station);
      if (text !== undefined) text.textContent = view.text;
      const stamp = this.stamps.get(view.station);
      if (stamp !== undefined) {
        const next = view.at === null ? '' : showDateTime(view.at, this.clock);
        if (stamp.textContent !== next) {
          stamp.textContent = next;
          if (next !== '') {
            stamp.classList.remove('stamp-in');
            void stamp.offsetWidth;
            stamp.classList.add('stamp-in');
          }
        }
      }
      const ring = this.rings.get(view.station);
      ring?.setAttribute('data-state', view.state);
    });
    const reached = views.reduce(
      (last, view, index) => (REACHED.includes(view.state) ? index : last),
      0,
    );
    this.token.style.setProperty('--token-index', String(reached));
    if (!this.touched) {
      const current = views.findIndex((view) => view.state === 'current');
      this.focusIndex = current === -1 ? views.length - 1 : current;
    }
    this.setRovingStop();
  }

  destroy(): void {
    for (const sheet of this.sheets.values()) sheet.destroy();
  }
}

function fact(term: string, value: string): HTMLElement[] {
  return [
    element('dt', { text: term }),
    element('dd', { text: value, className: 'mono' }),
  ];
}

export function trackFactsFrom(
  decidedUnder: {
    thresholdCents: number;
    thresholdCurrency: string;
    ruleInForceSince: string | null;
    rateCents: number;
    counterpartyName: string | null;
  },
  caseBody: {
    asset: string;
    amount: string;
    fiatValueCents: number;
    currency: string;
    dataSent: { counterpartyNameAsSent: string | null } | null;
    answer: { decision: string; late: boolean } | null;
    status: string;
  },
): TrackFacts {
  return {
    nameAsSent: caseBody.dataSent?.counterpartyNameAsSent ?? decidedUnder.counterpartyName,
    rule:
      decidedUnder.ruleInForceSince === null
        ? 'No rule in force'
        : `${showMoney(decidedUnder.thresholdCurrency, decidedUnder.thresholdCents)} from ${showDate(decidedUnder.ruleInForceSince)}`,
    rate: `${showMoney(decidedUnder.thresholdCurrency, decidedUnder.rateCents)} per ${caseBody.asset}`,
    fiatValue: `${showMoney(caseBody.currency, caseBody.fiatValueCents)} for ${showCrypto(caseBody.asset, caseBody.amount)}`,
    answer:
      caseBody.answer === null
        ? 'No answer yet'
        : `${caseBody.answer.decision === 'accepted' ? 'Accepted' : 'Rejected'}${caseBody.answer.late ? ', late' : ''}`,
  };
}
