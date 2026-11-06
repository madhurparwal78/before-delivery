import type { Alert, AlertState, Units } from '../../shared/types.js';
import { positionText } from '../../shared/units.js';
import { request } from '../api.js';
import { button, el, prefersReducedMotion, reconcile, setText } from '../dom.js';
import type { Shell } from '../shell.js';

function utcTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

function stateLineText(alert: Alert): string {
  if (alert.state === 'Acknowledged') {
    return `Acknowledged by ${alert.acknowledged_by ?? ''} at ${utcTime(alert.acknowledged_at ?? alert.raised_at)} UTC`;
  }
  if (alert.state === 'Rectified') {
    return `Rectified at ${utcTime(alert.rectified_at ?? alert.raised_at)} UTC`;
  }
  return 'Active';
}

export interface AlertsRegion {
  node: HTMLElement;
  update(alerts: Alert[], units: Units): void;
}

/**
 * The alerts region. Acknowledged and rectified cards stay on the board with
 * their attribution until Closed, refreshes never move focus, and cards already
 * on the board never replay their entrance.
 */
export function createAlertsRegion(shell: Shell): AlertsRegion {
  const list = el('div', { class: 'alert-list' });
  const node = el(
    'section',
    { role: 'region', 'aria-label': 'Alerts', tabindex: '-1', class: 'alerts' },
    [el('h2', {}, ['Alerts']), list],
  );

  const known = new Map<string, AlertState>();
  let settled = false;

  function announceChanges(alerts: Alert[]): void {
    const seen = new Set<string>();
    for (const alert of alerts) {
      seen.add(alert.id);
      const previous = known.get(alert.id);
      if (previous === undefined) {
        shell.announce('Fleet announcements', alert.heading);
      } else if (previous !== alert.state && (alert.state === 'Rectified' || alert.state === 'Closed')) {
        announceClear(alert);
      }
      known.set(alert.id, alert.state);
    }
    if (settled) {
      for (const [id, state] of [...known]) {
        if (seen.has(id)) continue;
        // The alert left the open list, so its cause cleared and it closed.
        if (state === 'Acknowledged' || state === 'Active') {
          const kept = lastSeen.get(id);
          if (kept) announceClear({ ...kept, state: 'Closed' });
        }
        known.delete(id);
        lastSeen.delete(id);
      }
    }
    settled = true;
  }

  const lastSeen = new Map<string, Alert>();

  function announceClear(alert: Alert): void {
    if (alert.kind === 'geofence_breach') {
      shell.announce('Fleet announcements', `${alert.vessel_name} back inside the geofence`);
      return;
    }
    shell.announce('Fleet announcements', `${alert.heading} — rectified`);
  }

  function moveFocusAfterAck(card: HTMLElement): void {
    const cards = Array.from(list.children) as HTMLElement[];
    const index = cards.indexOf(card);
    for (let look = index + 1; look < cards.length; look += 1) {
      const next = cards[look]!.querySelector<HTMLButtonElement>('[data-ack]');
      if (next) {
        next.focus();
        return;
      }
    }
    for (let look = index - 1; look >= 0; look -= 1) {
      const previous = cards[look]!.querySelector<HTMLButtonElement>('[data-ack]');
      if (previous) {
        previous.focus();
        return;
      }
    }
    const stateLine = card.querySelector<HTMLElement>('[data-state-line]');
    if (stateLine && document.contains(stateLine)) {
      stateLine.focus();
      return;
    }
    node.focus();
  }

  async function acknowledge(alert: Alert, card: HTMLElement): Promise<void> {
    shell.announce('Fleet announcements', 'Acknowledging');
    const at = shell.generation;
    try {
      await request<Alert>(`/api/alerts/${alert.id}/ack`, { method: 'POST', body: {} });
      if (at !== shell.generation) return;
      shell.announce('Fleet announcements', 'Alert acknowledged');
      moveFocusAfterAck(card);
    } catch {
      if (at !== shell.generation) return;
    }
  }

  function create(alert: Alert): HTMLElement {
    const card = el('article', { class: 'alert-card' });
    if (!prefersReducedMotion() && settled) card.classList.add('alert-enter');
    card.append(
      el('h3', { 'data-heading': '' }, [alert.heading]),
      el('p', { 'data-state-line': '', tabindex: '-1' }),
      el('p', { 'data-raised': '' }),
      el('p', { 'data-position': '' }),
      el('p', { 'data-email': '' }),
    );
    return card;
  }

  function update(card: HTMLElement, alert: Alert, units: Units): void {
    setText(card.querySelector('[data-heading]')!, alert.heading);
    setText(card.querySelector('[data-state-line]')!, stateLineText(alert));
    setText(card.querySelector('[data-raised]')!, `Raised ${utcTime(alert.raised_at)} UTC`);
    setText(
      card.querySelector('[data-position]')!,
      alert.position ? positionText(alert.position.easting, alert.position.northing, units) : '',
    );
    setText(card.querySelector('[data-email]')!, alert.email === 'Emailed' ? 'Emailed' : 'Email queued');

    const existing = card.querySelector<HTMLButtonElement>('[data-ack]');
    const wanted = alert.state === 'Active' || alert.state === 'Rectified';
    if (wanted && !existing) {
      const ack = button('Acknowledge', {
        'data-ack': '',
        'aria-label': `Acknowledge ${alert.heading}`,
        class: 'ack',
      });
      ack.addEventListener('click', () => {
        void acknowledge(alert, card);
      });
      card.append(ack);
    } else if (wanted && existing) {
      existing.setAttribute('aria-label', `Acknowledge ${alert.heading}`);
      existing.onclick = () => {
        void acknowledge(alert, card);
      };
    } else if (!wanted && existing) {
      existing.remove();
    }
  }

  return {
    node,
    update(alerts, units) {
      const open = alerts.filter((alert) => alert.state !== 'Closed');
      for (const alert of open) lastSeen.set(alert.id, alert);
      announceChanges(open);
      reconcile(
        list,
        open,
        (alert) => alert.id,
        (alert) => create(alert),
        (card, alert) => update(card, alert, units),
      );
    },
  };
}
