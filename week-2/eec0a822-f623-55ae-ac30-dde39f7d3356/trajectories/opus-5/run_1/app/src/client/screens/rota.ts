import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import { createMessageBox, withPending } from '../lib/forms.js';
import { guardLeave, navigate, type RouteContext } from '../lib/router.js';
import { button, quietButton } from '../lib/views.js';
import { formatInstant, MESSAGES, REST_RULE_TEXT, type RestRule } from '../../shared/copy.js';
import { formatDayTab } from '../../shared/format.js';
import { can } from '../../shared/roles.js';
import type { Rota } from '../lib/types.js';

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

export async function rotaScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const workspaceSlug = context.params.ws;
  const yachtSlug = context.params.yachtSlug;
  const requested = context.query.get('week');
  const yachtResult = await api.get<{ yacht: { name: string } }>(
    `/api/w/${workspaceSlug}/yachts/${yachtSlug}`,
  );
  if (!yachtResult.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  let weekStart = requested;
  if (weekStart === null) {
    const weeks = await api.get<{ weeks: readonly { weekStart: string }[] }>(
      `/api/w/${workspaceSlug}/yachts/${yachtSlug}/weeks`,
    );
    weekStart = weeks.ok ? weeks.data.weeks[0].weekStart : null;
  }
  if (weekStart === null) return;
  const result = await api.get<Rota>(
    `/api/w/${workspaceSlug}/yachts/${yachtSlug}/rota?weekStart=${weekStart}`,
  );
  if (!result.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  const rota = result.data;
  const page = await staffPage(host, workspaceSlug, `${yachtResult.data.yacht.name} rota`);
  if (page === null) return;
  const editable = can(page.member.role, 'rota_write');
  const messages = createMessageBox();

  const dates = [...new Set(rota.slots.map((slot) => slot.date))];
  let activeDate = dates[0];
  let version = rota.version;
  const work = new Map<string, Set<string>>();
  for (const member of rota.crew) {
    work.set(member.id, new Set(rota.work[member.id] ?? []));
  }
  let dirty = false;

  const tabs = el('div', { class: 'tab-list', role: 'tablist', 'aria-label': 'Rota days' });
  const grid = el('div', {
    class: 'rota-grid',
    role: 'grid',
    'aria-label': 'Rota',
    tabindex: '0',
  });
  const frame = el('div', { class: 'rota-frame' }, grid);
  const saveButton = button('Save rota');
  saveButton.disabled = !editable;

  let activeRow = 0;
  let activeColumn = 0;
  let anchorRow = 0;
  let anchorColumn = 0;
  let cells: HTMLElement[][] = [];

  const daySlots = (): typeof rota.slots => rota.slots.filter((slot) => slot.date === activeDate);

  const isWork = (crewId: string, startsAt: string): boolean =>
    work.get(crewId)?.has(startsAt) === true;

  const selectionBounds = (): { rows: [number, number]; columns: [number, number] } => ({
    rows: [Math.min(anchorRow, activeRow), Math.max(anchorRow, activeRow)],
    columns: [Math.min(anchorColumn, activeColumn), Math.max(anchorColumn, activeColumn)],
  });

  const paintSelection = (): void => {
    const bounds = selectionBounds();
    for (const [rowIndex, row] of cells.entries()) {
      for (const [columnIndex, cell] of row.entries()) {
        const inside =
          rowIndex >= bounds.rows[0] &&
          rowIndex <= bounds.rows[1] &&
          columnIndex >= bounds.columns[0] &&
          columnIndex <= bounds.columns[1];
        cell.setAttribute('aria-selected', inside ? 'true' : 'false');
        cell.classList.toggle('is-selected', inside);
        const current = rowIndex === activeRow && columnIndex === activeColumn;
        cell.classList.toggle('is-active', current);
        if (current) grid.setAttribute('aria-activedescendant', cell.id);
      }
    }
  };

  const paintCell = (rowIndex: number, columnIndex: number): void => {
    const slots = daySlots();
    const crewId = rota.crew[rowIndex].id;
    const cell = cells[rowIndex][columnIndex];
    cell.textContent = isWork(crewId, slots[columnIndex].startsAt) ? 'W' : 'R';
  };

  const toggle = (rowIndex: number, columnIndex: number, toWork?: boolean): void => {
    if (!editable) return;
    const slots = daySlots();
    const crewId = rota.crew[rowIndex].id;
    const set = work.get(crewId) as Set<string>;
    const startsAt = slots[columnIndex].startsAt;
    const next = toWork === undefined ? !set.has(startsAt) : toWork;
    if (next) set.add(startsAt);
    else set.delete(startsAt);
    dirty = true;
    paintCell(rowIndex, columnIndex);
  };

  const buildGrid = (): void => {
    const slots = daySlots();
    grid.replaceChildren();
    cells = [];
    const headerRow = el('div', { class: 'rota-row', role: 'row' });
    headerRow.appendChild(el('div', { class: 'rota-corner', role: 'columnheader' }, 'Crew'));
    for (const slot of slots) {
      headerRow.appendChild(el('div', { class: 'rota-head', role: 'columnheader' }, slot.label));
    }
    grid.appendChild(headerRow);
    for (const [rowIndex, member] of rota.crew.entries()) {
      const row = el('div', { class: 'rota-row', role: 'row' });
      row.appendChild(el('div', { class: 'rota-name', role: 'rowheader' }, member.name));
      const rowCells: HTMLElement[] = [];
      for (const [columnIndex, slot] of slots.entries()) {
        const cell = el(
          'div',
          {
            class: 'rota-cell',
            role: 'gridcell',
            id: `cell-${rowIndex}-${columnIndex}`,
            'aria-selected': 'false',
          },
          isWork(member.id, slot.startsAt) ? 'W' : 'R',
        );
        row.appendChild(cell);
        rowCells.push(cell);
      }
      cells.push(rowCells);
      grid.appendChild(row);
    }
    activeRow = Math.min(activeRow, cells.length - 1);
    activeColumn = Math.min(activeColumn, slots.length - 1);
    anchorRow = activeRow;
    anchorColumn = activeColumn;
    paintSelection();
  };

  grid.addEventListener('keydown', (event) => {
    const slots = daySlots();
    const move = (rowStep: number, columnStep: number): void => {
      activeRow = Math.max(0, Math.min(activeRow + rowStep, rota.crew.length - 1));
      activeColumn = Math.max(0, Math.min(activeColumn + columnStep, slots.length - 1));
      if (!event.shiftKey) {
        anchorRow = activeRow;
        anchorColumn = activeColumn;
      }
      paintSelection();
      cells[activeRow][activeColumn].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        move(0, -1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        move(0, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1, 0);
        break;
      case 'ArrowDown':
        event.preventDefault();
        move(1, 0);
        break;
      case 'Home':
        event.preventDefault();
        activeColumn = 0;
        if (!event.shiftKey) anchorColumn = 0;
        paintSelection();
        break;
      case 'End':
        event.preventDefault();
        activeColumn = slots.length - 1;
        if (!event.shiftKey) anchorColumn = activeColumn;
        paintSelection();
        break;
      case ' ': {
        event.preventDefault();
        const crewId = rota.crew[activeRow].id;
        const target = !isWork(crewId, slots[activeColumn].startsAt);
        const bounds = selectionBounds();
        for (let rowIndex = bounds.rows[0]; rowIndex <= bounds.rows[1]; rowIndex += 1) {
          for (
            let columnIndex = bounds.columns[0];
            columnIndex <= bounds.columns[1];
            columnIndex += 1
          ) {
            toggle(rowIndex, columnIndex, target);
          }
        }
        break;
      }
      default:
        break;
    }
  });

  grid.addEventListener('pointerdown', (event) => {
    const target = (event.target as HTMLElement).closest('.rota-cell');
    if (target === null) return;
    const [, rowIndex, columnIndex] = target.id.split('-').map((part) => Number.parseInt(part, 10));
    activeRow = rowIndex;
    activeColumn = columnIndex;
    anchorRow = rowIndex;
    anchorColumn = columnIndex;
    paintSelection();
    if (event.pointerType === 'touch') {
      event.preventDefault();
      toggle(rowIndex, columnIndex);
    }
  });
  grid.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('.rota-cell');
    if (target === null) return;
    const pointer = event as PointerEvent;
    if (pointer.pointerType === 'touch') return;
    const [, rowIndex, columnIndex] = target.id.split('-').map((part) => Number.parseInt(part, 10));
    toggle(rowIndex, columnIndex);
  });

  for (const date of dates) {
    const tab = el(
      'button',
      {
        type: 'button',
        class: 'tab',
        role: 'tab',
        'aria-selected': date === activeDate ? 'true' : 'false',
      },
      formatDayTab(date),
    );
    tab.addEventListener('click', () => {
      activeDate = date;
      for (const other of tabs.querySelectorAll('[role=tab]')) {
        other.setAttribute('aria-selected', other === tab ? 'true' : 'false');
      }
      buildGrid();
    });
    tabs.appendChild(tab);
  }

  saveButton.addEventListener('click', () => {
    void withPending(saveButton, 'Saving rota', async () => {
      const payload: Record<string, string[]> = {};
      for (const [crewId, set] of work.entries()) payload[crewId] = [...set].sort();
      const result = await api.put<Rota>(
        `/api/w/${workspaceSlug}/yachts/${yachtSlug}/rota?weekStart=${weekStart}`,
        { version, work: payload },
      );
      if (result.ok) {
        version = result.data.version;
        dirty = false;
        messages.show(MESSAGES.rotaSaved);
        return;
      }
      const body = failure(result);
      if (body.error === 'stale_rota') {
        messages.show(
          MESSAGES.staleRota(String(body.savedBy), formatInstant(String(body.savedAt), rota.base)),
          'problem',
        );
        return;
      }
      if (body.error === 'rest_rule') {
        messages.show(
          MESSAGES.restRuleBroken(
            String(body.crewName),
            REST_RULE_TEXT[body.rule as RestRule],
            formatInstant(String(body.windowStart), rota.base),
            formatInstant(String(body.windowEnd), rota.base),
          ),
          'problem',
        );
        return;
      }
      if (body.errors !== undefined) {
        messages.show(Object.values(body.errors)[0], 'problem');
        return;
      }
      if (!handleAccessFailure(result, messages)) messages.show(MESSAGES.unexpected, 'problem');
    });
  });

  const weekLink = (label: string, offset: number): HTMLElement => {
    const anchor = el('a', {
      href: `/w/${workspaceSlug}/yachts/${yachtSlug}/rota?week=${addDays(weekStart as string, offset)}`,
      class: 'week-link',
    }, label);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(anchor.getAttribute('href') as string);
    });
    return anchor;
  };

  guardLeave(() => {
    if (!dirty) return true;
    openDialog({
      name: 'Discard changes',
      opener: saveButton,
      build: (handle) => {
        const keep = quietButton('Keep editing');
        keep.addEventListener('click', () => handle.close());
        const discard = button('Discard changes');
        discard.addEventListener('click', () => {
          dirty = false;
          handle.close();
          guardLeave(null);
        });
        return {
          body: [el('div', { class: 'dialog-actions' }, keep, discard)],
          first: () => keep,
        };
      },
    });
    return false;
  });

  page.main.append(
    el('p', { class: 'week-links' }, weekLink('Previous week', -7), weekLink('Next week', 7)),
    tabs,
    messages.node,
    frame,
    saveButton,
  );
  buildGrid();
  return () => guardLeave(null);
}
