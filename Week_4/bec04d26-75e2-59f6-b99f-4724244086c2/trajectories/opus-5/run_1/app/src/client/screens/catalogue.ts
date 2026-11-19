import { ClientRecord, ReturnRecord } from '../../shared/types';
import type { App } from '../app';
import { iconSvg } from '../../shared/icons';
import { el, prefersReducedMotion, svg } from '../dom';
import { emptyState, returnData, tile } from '../components/tile';

const DRAG_THRESHOLD = 6;

function tileWidth(row: HTMLElement): number {
  const first = row.querySelector<HTMLElement>('li');
  if (!first) return row.clientWidth;
  const gap = Number.parseFloat(window.getComputedStyle(row).columnGap || '0') || 0;
  return first.getBoundingClientRect().width + gap;
}

function glide(row: HTMLElement, direction: number): void {
  row.scrollBy({
    left: tileWidth(row) * direction,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

function attachDrag(app: App, row: HTMLElement): void {
  let startX = 0;
  let startScroll = 0;
  let dragging = false;
  let moved = false;

  row.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
    startScroll = row.scrollLeft;
  });
  row.addEventListener('pointermove', (event: PointerEvent) => {
    if (!dragging) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > DRAG_THRESHOLD) moved = true;
    if (moved) row.scrollLeft = startScroll - delta;
  });
  const end = (): void => {
    dragging = false;
    if (moved) {
      row.dataset.dragged = 'true';
      window.setTimeout(() => {
        delete row.dataset.dragged;
      }, 0);
    }
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  row.addEventListener('pointerleave', end);
  row.addEventListener('scroll', () => app.refreshRowControls(row));
}

function clientRow(app: App, client: ClientRecord, records: ReturnRecord[]): HTMLElement {
  const rowId = `row-${client.id}`;
  const list = el(
    'ul',
    {
      class: 'catalogue-row',
      id: rowId,
      'aria-label': `Returns for ${client.name}`,
      tabindex: '0',
      'data-focus-key': `catalogue-row:${client.id}`,
      onKeydown: (event: KeyboardEvent) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        glide(event.currentTarget as HTMLElement, event.key === 'ArrowRight' ? 1 : -1);
      },
    },
    ...records.map((record) =>
      el(
        'li',
        { ...returnData(record) },
        el(
          'a',
          {
            href: `/returns/${record.id}`,
            'data-link': 'true',
            'data-focus-key': `catalogue:${record.id}`,
          },
          tile(record),
          el('span', { class: 'specimen-name' }, `${client.name} ${record.state} ${record.period_label}`),
        ),
      ),
    ),
  );

  app.mountTasks.push(() => {
    attachDrag(app, list);
    app.refreshRowControls(list);
    // Tile widths settle once the bundled fonts and the layout are in, so the
    // Previous and Next buttons are re-read whenever the row's size changes.
    new ResizeObserver(() => app.refreshRowControls(list)).observe(list);
  });

  return el(
    'section',
    { role: 'region', 'aria-label': client.name, class: 'section' },
    el('h2', {}, client.name),
    list,
    el(
      'div',
      { class: 'row-controls', 'data-row-controls': client.id },
      el(
        'button',
        {
          type: 'button',
          'data-row-previous': client.id,
          'data-focus-key': `catalogue-previous:${client.id}`,
          onClick: () => glide(list, -1),
        },
        svg(iconSvg('chevron-left')),
        `Previous returns for ${client.name}`,
      ),
      el(
        'button',
        {
          type: 'button',
          'data-row-next': client.id,
          'data-focus-key': `catalogue-next:${client.id}`,
          onClick: () => glide(list, 1),
        },
        `Next returns for ${client.name}`,
        svg(iconSvg('chevron-right')),
      ),
    ),
  );
}

export function renderCatalogue(app: App): HTMLElement {
  const clients = app.state.clients;
  const withReturns = clients
    .map((client) => ({
      client,
      records: app.state.returns.filter((record) => record.client.id === client.id),
    }))
    .filter((entry) => entry.records.length > 0);

  if (withReturns.length === 0) {
    return el(
      'main',
      { class: 'screen' },
      el('h1', {}, 'Specimen catalogue'),
      emptyState('No returns yet. Register a client in a state to start.'),
    );
  }

  return el(
    'main',
    { class: 'screen' },
    el('h1', {}, 'Specimen catalogue'),
    ...withReturns.map((entry) => clientRow(app, entry.client, entry.records)),
  );
}
