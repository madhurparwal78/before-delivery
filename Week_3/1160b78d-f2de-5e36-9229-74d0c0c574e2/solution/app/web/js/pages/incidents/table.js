// The incident table: one roving tab stop, rows keyed by incident so a redraw keeps focus where it is.
import { html } from '../../lib/html.js';
import { Tone, Empty } from '../../lib/ui.js';
import { fmtLocal } from '../../lib/format.js';
import { holderNames, serviceOf } from './model.js';

function Row({ item, zone, tabStop, selected, onSelect }) {
  const opened = zone ? fmtLocal(item.opened_at, zone) : item.opened_local;
  const open = (event) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) location.assign(`/incidents/${item.id}`);
  };
  return html`<tr role="row" class="incident-row" data-incident=${item.number} data-id=${item.id} tabindex=${tabStop ? 0 : -1}
    aria-selected=${selected ? 'true' : 'false'} onKeyDown=${open}>
    <td role="cell" class="c-select"><input type="checkbox" tabindex="-1" aria-label=${`Select incident ${item.number}`}
      checked=${selected} onChange=${() => onSelect(item.id)} /></td>
    <td role="cell" class="c-number">#${item.number}</td>
    <td role="cell" class="c-title"><a href=${`/incidents/${item.id}`} tabindex="-1">${item.title}</a></td>
    <td role="cell" class="c-service">${serviceOf(item).name}</td>
    <td role="cell" class="c-status"><${Tone} status=${statusWord(item.status)} /></td>
    <td role="cell" class="c-holder">${holderNames(item)}</td>
    <td role="cell" class="c-opened">${opened}</td>
  </tr>`;
}

function statusWord(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function IncidentTable({ s, cursor, zone, onSelect }) {
  const empty = s.loaded && !s.items.length;
  return html`<table role="table" aria-label="Incidents" class=${'incident-table' + (empty ? ' is-empty' : '')}>
    <thead role="rowgroup"><tr role="row">
      <th role="columnheader" class="c-select"><span class="sr-only">Selected</span></th>
      <th role="columnheader" class="c-number">Number</th>
      <th role="columnheader" class="c-title">Title</th>
      <th role="columnheader" class="c-service">Service</th>
      <th role="columnheader" class="c-status">Status</th>
      <th role="columnheader" class="c-holder">Holder</th>
      <th role="columnheader" class="c-opened">Opened</th>
    </tr></thead>
    <tbody role="rowgroup">${empty
      ? html`<tr role="row" class="empty-row"><td role="cell" colspan="7"><${Empty} id="list-empty">Nothing is open.</${Empty}></td></tr>`
      : s.items.map((item) => html`<${Row} key=${item.id} item=${item} zone=${zone}
        tabStop=${item.id === cursor} selected=${s.selected.has(item.id)} onSelect=${onSelect} />`)}</tbody>
  </table>`;
}
