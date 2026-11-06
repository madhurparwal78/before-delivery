import { fixed } from '../../shared/numbers.js';
import type { LinkState, Units, Vessel } from '../../shared/types.js';
import { hoursText, positionText, speedText } from '../../shared/units.js';
import { button, el, reconcile, setText } from '../dom.js';
import type { Shell } from '../shell.js';

export interface FleetRail {
  node: HTMLElement;
  update(vessels: Vessel[], coverageByMission: Map<string, number>, units: Units): void;
}

const LINK_WORD: Record<LinkState, string> = { Live: 'live', Stale: 'stale', Lost: 'lost' };

/**
 * One card per vessel, in seed order. Each card changes in place, and a link-state
 * change is announced once — only for a change this screen observes after its
 * first load.
 */
export function createFleetRail(shell: Shell, onSelect: (vesselId: string) => void): FleetRail {
  const list = el('ul', { 'aria-label': 'Vessels', class: 'vessel-list' });
  const node = el('section', { role: 'region', 'aria-label': 'Fleet', class: 'fleet-rail' }, [list]);
  const linkStates = new Map<string, LinkState>();
  let settled = false;

  function create(vessel: Vessel): HTMLElement {
    const open = button(vessel.name, { 'data-open': '', class: 'vessel-open' });
    open.addEventListener('click', () => onSelect(vessel.id));
    return el('li', { class: 'vessel-card' }, [
      open,
      el('p', { 'data-link': '' }),
      el('p', { 'data-position': '' }),
      el('p', { 'data-speed': '' }),
      el('p', { 'data-battery': '' }),
      el('p', { 'data-coverage': '' }),
      el('p', { 'data-service': '' }),
      el('p', { 'data-overdue': '' }),
    ]);
  }

  function update(
    card: HTMLElement,
    vessel: Vessel,
    coverageByMission: Map<string, number>,
    units: Units,
  ): void {
    const open = card.querySelector<HTMLButtonElement>('[data-open]')!;
    setText(open, vessel.name);
    open.onclick = () => onSelect(vessel.id);
    setText(card.querySelector('[data-link]')!, vessel.link_state);
    setText(
      card.querySelector('[data-position]')!,
      vessel.last_fix
        ? positionText(vessel.last_fix.position.easting, vessel.last_fix.position.northing, units)
        : '—',
    );
    setText(
      card.querySelector('[data-speed]')!,
      vessel.last_fix ? speedText(vessel.last_fix.speed_mps, units) : '—',
    );
    setText(
      card.querySelector('[data-battery]')!,
      vessel.last_fix ? `${fixed(vessel.last_fix.battery_pct, 0)} %` : '—',
    );
    const coverage = vessel.mission_id ? coverageByMission.get(vessel.mission_id) : undefined;
    setText(
      card.querySelector('[data-coverage]')!,
      coverage === undefined ? '—' : `${fixed(coverage, 1)}%`,
    );
    setText(card.querySelector('[data-service]')!, hoursText(vessel.hours_since_service));
    setText(card.querySelector('[data-overdue]')!, vessel.service_overdue ? 'Service overdue' : '');
  }

  return {
    node,
    update(vessels, coverageByMission, units) {
      for (const vessel of vessels) {
        const previous = linkStates.get(vessel.id);
        if (settled && previous !== undefined && previous !== vessel.link_state) {
          shell.announce(
            'Fleet announcements',
            `${vessel.name} link ${LINK_WORD[vessel.link_state]}`,
          );
        }
        linkStates.set(vessel.id, vessel.link_state);
      }
      settled = true;
      reconcile(
        list,
        vessels,
        (vessel) => vessel.id,
        (vessel) => create(vessel),
        (card, vessel) => update(card, vessel, coverageByMission, units),
      );
    },
  };
}
