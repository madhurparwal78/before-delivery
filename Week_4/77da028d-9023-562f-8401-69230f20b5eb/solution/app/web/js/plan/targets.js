// The plan target list. Rows are keyed by project and updated in place so focus survives a refresh.
import { h, svg } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { oneDecimal, POSITION_TEXT } from '../core/format.js';

const EMPTY_DISC = `<svg viewBox="0 0 120 120" width="120" height="120" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false">
  <circle cx="60" cy="60" r="48"/><circle cx="60" cy="60" r="32" opacity=".45"/><circle cx="60" cy="60" r="16" opacity=".45"/>
  <path d="M12 74c10-8 16 2 26-4s14-4 22 0 14 6 22-2 12 0 26 6" stroke-width="3" stroke-linecap="round"/></svg>`;

function filterSummary(target) {
  return target.filters.filter((row) => row.owed_seconds > 0).map((row) => `${row.filter} ${row.usable_minutes} usable minutes`);
}

function createRow(onRemove, onFocus) {
  const name = h('strong', { class: 'target-name' });
  const status = h('span', { class: 'chip target-status' });
  const inactive = h('span', { class: 'chip', hidden: true }, 'Not active');
  const altitude = h('span', { class: 'target-altitude' });
  const filters = h('span', { class: 'target-filters' });
  const remove = h('button', { type: 'button', class: 'btn btn--ghost target-remove' }, icon('close', 18), h('span', {}, 'Remove'));
  const element = h('li', { class: 'target', tabindex: '0' },
    h('div', { class: 'target-head' }, name, status, inactive),
    h('div', { class: 'target-figures' }, altitude, filters),
    remove);
  element.addEventListener('focusin', () => onFocus(element.dataset.projectId));
  element.addEventListener('focusout', (event) => { if (!element.contains(event.relatedTarget)) onFocus(null); });
  remove.addEventListener('click', () => onRemove(element.dataset.projectId));
  return { element, name, status, inactive, altitude, filters, remove };
}

// createTargetList({onRemove, onFocus}) -> {element, list, update(plan)}
export function createTargetList({ onRemove, onFocus }) {
  const list = h('ul', { class: 'target-list', 'aria-label': 'Plan targets' });
  const empty = h('div', { class: 'empty', hidden: true }, svg(EMPTY_DISC), h('p', {}, 'No targets yet. Add an active project.'));
  const element = h('section', { class: 'card plan-list-card' }, h('h2', {}, 'Targets'), list, empty);
  const rows = new Map();

  return {
    element,
    list,
    update(plan) {
      empty.hidden = plan.targets.length > 0;
      for (const [projectId, row] of rows) {
        if (!plan.targets.some((target) => target.project_id === projectId)) { row.element.remove(); rows.delete(projectId); }
      }
      plan.targets.forEach((target, index) => {
        let row = rows.get(target.project_id);
        if (!row) {
          row = createRow(onRemove, onFocus);
          row.element.dataset.projectId = target.project_id;
          rows.set(target.project_id, row);
        }
        row.name.textContent = target.target_name;
        row.remove.setAttribute('aria-label', `Remove ${target.target_name}`);
        row.status.textContent = POSITION_TEXT[target.position_status];
        row.inactive.hidden = target.counts;
        row.element.classList.toggle('target--inactive', !target.counts);
        row.altitude.textContent = `Altitude ${oneDecimal(target.altitude_deg)} degrees`;
        row.filters.replaceChildren(...filterSummary(target).map((text) => h('span', { class: 'target-filter' }, text)));
        if (list.children[index] !== row.element) list.insertBefore(row.element, list.children[index] || null);
      });
    },
  };
}
