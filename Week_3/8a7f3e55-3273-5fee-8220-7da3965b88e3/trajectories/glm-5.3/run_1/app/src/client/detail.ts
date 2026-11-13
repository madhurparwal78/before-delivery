// The rotation weave, plan list and detail panels shared by every role's detail pane.
import type { Booking, MaterialInfo, RotationTurn } from '../shared/api.js';
import { h, focusNode, formatBytes } from './dom.js';
import { openCallLine } from './copy.js';
import { STATUS_LABELS } from '../shared/terms.js';

export interface PlanKey {
  mode: string;
  entries: string;
}

export function planKey(booking: Booking): PlanKey {
  return {
    mode: booking.rotation.mode,
    entries: booking.rotation.turns
      .map((t) => `${t.kind}:${t.holder_initials ?? ''}:${t.start}:${t.end}`)
      .join('|'),
  };
}

export function planChanged(before: PlanKey | null, booking: Booking): boolean {
  if (before === null) return true;
  const after = planKey(booking);
  return before.mode !== after.mode || before.entries !== after.entries;
}

export interface WeaveOptions {
  animate: 'entry' | 'collapse' | 'none';
  collapseHolder: string | null;
}

/** Draw the weave. It redraws only when the plan changed for the selected booking; entry
 * plays a staggered left-to-right growth, withdrawal a right-to-left collapse. */
export function drawWeave(container: HTMLElement, booking: Booking, opts: WeaveOptions): void {
  container.replaceChildren();
  const bar = h('div', { class: 'weave-bar', role: 'img', 'aria-label': 'Rotation weave', 'data-mode': booking.rotation.mode });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const turns = booking.rotation.turns;
  let delay = 0;
  const collapseIndexes: number[] = [];
  if (opts.animate === 'collapse' && opts.collapseHolder) {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].holder_initials === opts.collapseHolder) collapseIndexes.push(i);
    }
    collapseIndexes.reverse();
  }
  turns.forEach((turn) => {
    const entry = h('div', {
      class: `weave-entry ${turn.kind === 'turn' ? `turn-seat${turn.seat}` : 'gap'}`,
      'data-turn-index': String(turn.index),
      'data-kind': turn.kind,
      'data-holder': turn.holder_initials ?? '',
      'data-start': turn.start,
      'data-end': turn.end,
    });
    if (turn.kind === 'turn') {
      entry.append(h('span', { class: 'turn-initials' }, turn.holder_initials ?? ''));
    } else {
      entry.append(h('span', { class: 'gap-label' }, turn.label ?? ''));
    }
    bar.append(entry);
  });
  // Widths are set from each entry's share of the booking length.
  const entries = Array.from(bar.children) as HTMLElement[];
  let cursor = 0;
  turns.forEach((turn, index) => {
    const entry = entries[index];
    const duration = elapsedFrom(turn.start, turn.end);
    entry.style.width = `${(duration / booking.duration_minutes) * 100}%`;
    cursor += duration;
  });
  void cursor;
  if (opts.animate !== 'none' && !reduceMotion) {
    if (opts.animate === 'entry') {
      entries.forEach((entry, index) => {
        entry.classList.add('animating');
        entry.style.animationDelay = `${index * 40}ms`;
      });
      delay = turns.length * 40;
    } else if (opts.animate === 'collapse' && collapseIndexes.length > 0) {
      collapseIndexes.forEach((turnIndex, position) => {
        const entry = entries[turnIndex];
        if (entry) {
          entry.classList.add('collapsing');
          entry.style.animationDelay = `${position * 40}ms`;
        }
      });
    }
  }
  container.append(bar);
  const meta = h('div', { class: 'weave-meta' });
  const coverage = h('span', { class: 'coverage-text', role: 'status', 'aria-label': 'Coverage' }, booking.rotation.coverage_text);
  meta.append(coverage);
  container.append(meta);
  const list = h('ul', { class: 'plan-list', 'aria-label': 'Rotation plan' });
  const turnEntries = turns.filter((t) => t.kind === 'turn');
  const totalTurns = turnEntries.length;
  let turnPosition = 0;
  turns.forEach((turn) => {
    if (turn.kind === 'turn') {
      turnPosition++;
      list.append(h('li', {},
        h('span', { class: 't' }, `Turn ${turnPosition} of ${totalTurns}: `),
        `${turn.holder_name ?? ''}, ${turn.start}–${turn.end}`,
      ));
    } else {
      list.append(h('li', {}, h('span', { class: 't' }, 'Gap: '), `${turn.label}, ${turn.start}–${turn.end}`));
    }
  });
  container.append(list);
  void delay;
}

/** Elapsed minutes between two agency wall-clock times the API carries. A boundary past
 * midnight (or across a clock change) counts forward from the earlier time. */
function elapsedFrom(startHHMM: string, endHHMM: string): number {
  const a = hhToMinutes(startHHMM);
  const b = hhToMinutes(endHHMM);
  const diff = b - a;
  return diff <= 0 ? diff + 24 * 60 : diff;
}

function hhToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number);
  return hh * 60 + mm;
}

export function markerFor(booking: Booking): { state: string; label: string } {
  if (['in_progress', 'completed', 'cancelled', 'cancelled_late'].includes(booking.status)) {
    return { state: booking.status, label: STATUS_LABELS[booking.status] };
  }
  return { state: booking.coverage.state, label: coverageLabel(booking.coverage.state) };
}

export function coverageLabel(state: string): string {
  switch (state) {
    case 'covered': return 'Covered';
    case 'partly_covered': return 'Partly covered';
    default: return 'Uncovered';
  }
}

export function rowButton(booking: Booking, extra?: HTMLElement): HTMLElement {
  const marker = markerFor(booking);
  const button = h('button', {
    class: `row ${marker.state === 'uncovered' ? 'uncovered-row' : ''}`,
    'data-coverage': bookingStatusToCoverage(booking),
    'data-booking-id': booking.id,
    'aria-label': `${booking.start.slice(11, 16)} ${booking.ref} ${booking.title}, ${marker.label}`,
  });
  button.append(h('span', { class: 'start mono' }, booking.start.slice(11, 16)));
  button.append(h('span', { class: 'ref' }, booking.ref));
  button.append(h('span', { class: 'title' }, booking.title));
  button.append(h('span', { class: 'marker ' + markerClass(marker.state), 'aria-hidden': 'true' }));
  button.append(h('span', { class: 'marker-label' }, marker.label));
  button.append(h('span', { class: 'status-chip' }, STATUS_LABELS[booking.status]));
  if (extra) button.append(extra);
  return button;
}

export function markerClass(state: string): string {
  if (['in_progress', 'completed', 'cancelled', 'cancelled_late'].includes(state)) {
    return 'marker.final';
  }
  if (state === 'covered') return 'marker covered';
  if (state === 'partly_covered') return 'marker partly';
  return 'marker uncovered';
}

function bookingStatusToCoverage(booking: Booking): string {
  if (['in_progress', 'completed', 'cancelled', 'cancelled_late'].includes(booking.status)) {
    return 'covered';
  }
  return booking.coverage.state;
}

/** The Interpreters panel for requesters: one article per held seat, with only the
 * published card fields. */
export function interpretersPanel(booking: Booking): HTMLElement {
  const region = h('section', { class: 'panel', 'aria-label': 'Interpreters' });
  region.append(h('h3', {}, 'Interpreters'));
  const holders = booking.seats.filter((s) => s.holder !== null);
  if (holders.length === 0) {
    region.append(h('div', { class: 'empty-row' }, 'No interpreter holds a seat yet.'));
    return region;
  }
  for (const seat of holders) {
    const holder = seat.holder!;
    const creds = (holder.credentials as string[]).join(', ');
    const article = h('article', { 'aria-label': holder.name, class: 'holder-card' });
    article.append(h('span', { class: 'initials-badge' }, holder.initials));
    const nameWrap = h('div', {});
    nameWrap.append(h('div', { class: 'holder-name' }, holder.name));
    nameWrap.append(h('div', { class: 'credentials' }, creds));
    article.append(nameWrap);
    region.append(article);
  }
  return region;
}

export function prepMaterialsPanel(booking: Booking, opts: { upload?: boolean; downloads?: boolean; onUpload?: (file: File) => void }): HTMLElement {
  const region = h('section', { class: 'panel', 'aria-label': 'Prep materials' });
  region.append(h('h3', {}, 'Prep materials'));
  if (opts.upload) {
    const fileInput = h('input', { type: 'file', 'aria-label': 'Attach prep material' });
    const uploadButton = h('button', {}, 'Upload');
    uploadButton.addEventListener('click', () => {
      const file = fileInput.files?.[0];
      if (file) opts.onUpload?.(file);
    });
    region.append(fileInput, uploadButton);
  }
  const table = h('table', { class: 'materials-table' });
  const thead = h('thead', {});
  const headRow = h('tr', {});
  headRow.append(h('th', {}, 'File'), h('th', { class: 'num' }, 'Size'), h('th', {}, 'Uploaded'));
  if (opts.downloads) headRow.append(h('th', {}, ''));
  thead.append(headRow);
  table.append(thead);
  const tbody = h('tbody', {});
  if (booking.materials.length === 0) {
    const row = h('tr', {});
    row.append(h('td', { colspan: opts.downloads ? '4' : '3' }, 'No prep materials.'));
    tbody.append(row);
  }
  for (const material of booking.materials) {
    const row = h('tr', {});
    row.append(h('td', {}, material.name));
    row.append(h('td', { class: 'num' }, formatBytes(material.size_bytes)));
    row.append(h('td', { class: 'mono' }, `${material.uploaded_at.slice(0, 10)} ${material.uploaded_at.slice(11, 16)}`));
    if (opts.downloads) {
      const cell = h('td', {});
      cell.append(downloadButton(material));
      row.append(cell);
    }
    tbody.append(row);
  }
  table.append(tbody);
  region.append(table);
  return region;
}

function downloadButton(material: MaterialInfo): HTMLElement {
  const button = h('button', { 'aria-label': `Download ${material.name}` }, 'Download');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Preparing download…';
    const { downloadMaterial } = await import('./download.js');
    await downloadMaterial(material, button);
  });
  return button;
}

export function factsGrid(booking: Booking): HTMLElement {
  const facts = h('div', { class: 'facts' });
  const add = (key: string, value: string) => {
    const fact = h('div', { class: 'fact' });
    fact.append(h('span', { class: 'k' }, key));
    fact.append(h('span', {}, value));
    facts.append(fact);
  };
  add('Organisation', booking.org_name);
  add('Setting', booking.setting);
  add('Location', booking.location);
  add('On-site contact', `${booking.onsite_contact_name} · ${booking.onsite_contact_phone}`);
  add('Deaf consumer', booking.consumer_name);
  add('Time', `${booking.start.slice(0, 10)} ${booking.start.slice(11, 16)} – ${booking.end.slice(11, 16)}`);
  add('Status', STATUS_LABELS[booking.status]);
  return facts;
}

export function seatsHeading(): HTMLElement {
  const heading = h('h3', { class: 'focusable-heading', tabindex: '-1' }, 'Seats');
  return heading;
}

export { focusNode };
