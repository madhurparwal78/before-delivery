import chevronDown from 'lucide-static/icons/chevron-down.svg';
import chevronUp from 'lucide-static/icons/chevron-up.svg';
import xIcon from 'lucide-static/icons/x.svg';
import { DECK_STATUS, SCREEN_STATES } from '../../shared/copy.js';
import type { Paper, ReelJson, ReelStopJson, SheetJson, Unit } from '../../shared/types.js';
import { ApiCallError, api, newIdempotencyKey } from '../api.js';
import { openDialog } from '../dialog.js';
import { element, icon, setText } from '../dom.js';
import { measureRows, slideRowOut, slideRowsFrom } from '../motion.js';
import { startRefetch, stopFor, type Screen, type ScreenContext } from './screen.js';

/** One reel: its stops in order, the fader that plays them and its contact sheets. */

interface RowParts {
  row: HTMLLIElement;
  position: HTMLElement;
  name: HTMLElement;
  maker: HTMLElement;
  size: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
  remove: HTMLButtonElement;
}

interface QueuedMove {
  order: string[];
  title: string;
  position: number;
}

export function renderReel({ shell, params, search, navigate }: ScreenContext): Screen {
  const reelId = params.id ?? '';
  let serverOrder: string[] = [];
  let displayOrder: string[] = [];
  let version = 1;
  let currentReferenceId: string | null = null;
  let destroyed = false;
  let sending = false;
  const queue: QueuedMove[] = [];
  const rows = new Map<string, RowParts>();
  const stopsById = new Map<string, ReelStopJson>();
  const requestedSheets = new Set<string>();
  let sheetSignature = '';
  const reportedSheets = new Set<string>();

  const heading = element('h1', {}, ['']);
  const stopList = element('ul', { class: 'stop-list', role: 'list', 'aria-label': 'Stops' });
  const printButton = element('button', { type: 'button', class: 'action primary' }, [
    'Print contact sheet',
  ]);
  const sheetList = element('ul', {
    class: 'sheet-list',
    role: 'list',
    'aria-label': 'Contact sheets',
  });
  // Screen heading, primary action, then the stops with the sheets list below them.
  shell.main.append(heading, printButton, stopList, sheetList);
  shell.field.showMessage(SCREEN_STATES.loading);

  function unit(): Unit {
    return shell.sizeUnit;
  }

  function playableOrder(): string[] {
    return displayOrder.filter((id) => stopsById.get(id)?.reference.state === 'stored');
  }

  function playableStops(): ReelStopJson[] {
    return playableOrder().map((id) => stopsById.get(id)!);
  }

  function rowForPlayable(index: number): HTMLElement | null {
    const id = playableOrder()[index];
    return id ? (rows.get(id)?.row ?? null) : null;
  }

  function buildRow(stop: ReelStopJson): RowParts {
    const reference = stop.reference;
    const position = element('span', { class: 'stop-position' }, ['']);
    const name = element('span', { class: 'row-name' }, [reference.title]);
    const maker = element('p', { class: 'row-maker' }, [reference.maker ?? '']);
    const size = element('p', { class: 'row-size' }, ['']);
    const up = element('button', {
      type: 'button',
      class: 'icon-button',
      'aria-label': `Move ${reference.title} up`,
    });
    up.append(icon(chevronUp, 'Move up'));
    const down = element('button', {
      type: 'button',
      class: 'icon-button',
      'aria-label': `Move ${reference.title} down`,
    });
    down.append(icon(chevronDown, 'Move down'));
    const remove = element('button', {
      type: 'button',
      class: 'icon-button',
      'aria-label': `Remove ${reference.title} from reel`,
    });
    remove.append(icon(xIcon, 'Remove'));
    const row = element('li', { class: 'stop-row' }, [
      element('div', { class: 'stop-facts' }, [position, name, maker, size]),
      element('div', { class: 'stop-controls' }, [up, down, remove]),
    ]);
    row.dataset.referenceId = reference.id;
    up.addEventListener('click', () => moveStop(reference.id, -1, up, down));
    down.addEventListener('click', () => moveStop(reference.id, 1, down, up));
    remove.addEventListener('click', () => removeStop(reference.id));
    bindDrag(row, reference.id);
    return { row, position, name, maker, size, up, down, remove };
  }

  function paintRows(): void {
    let previous: Element | null = null;
    for (const [index, id] of displayOrder.entries()) {
      const stop = stopsById.get(id);
      if (!stop) continue;
      let parts = rows.get(id);
      if (!parts) {
        parts = buildRow(stop);
        rows.set(id, parts);
      }
      const trashed = stop.reference.state === 'trashed';
      setText(parts.position, String(index + 1));
      setText(parts.name, stop.reference.title);
      setText(parts.maker, stop.reference.maker ?? '');
      setText(parts.size, trashed ? 'In the trash' : stop.reference.size_text[unit()]);
      parts.row.classList.toggle('is-trashed', trashed);
      const expected: Element | null = previous
        ? previous.nextElementSibling
        : stopList.firstElementChild;
      if (expected !== parts.row) stopList.insertBefore(parts.row, expected);
      previous = parts.row;
    }
    for (const [id, parts] of rows) {
      if (!displayOrder.includes(id)) {
        parts.row.remove();
        rows.delete(id);
      }
    }
  }

  function syncFader(options: { swap: boolean; announce: boolean }): void {
    const stops = playableStops().map((stop) => stopFor(stop.reference, unit()));
    if (stops.length === 0) {
      currentReferenceId = null;
      shell.field.updateReelStops([], 0, options);
      return;
    }
    const index = Math.max(
      0,
      stops.findIndex((stop) => stop.key === currentReferenceId),
    );
    currentReferenceId = stops[index]!.key;
    shell.field.updateReelStops(stops, index, options);
    writeAddress(index);
  }

  function writeAddress(index: number): void {
    const url = new URL(window.location.href);
    url.searchParams.set('stop', String(index + 1));
    navigate(`${url.pathname}${url.search}`, { replace: true, quiet: true });
  }

  function startFader(initialIndex: number): void {
    const stops = playableStops().map((stop) => stopFor(stop.reference, unit()));
    if (stops.length === 0) {
      shell.field.showReel([], {
        initialIndex: 0,
        rowFor: rowForPlayable,
        onChange: () => undefined,
      });
      return;
    }
    currentReferenceId = stops[initialIndex]?.key ?? stops[0]!.key;
    shell.field.showReel(stops, {
      initialIndex,
      rowFor: rowForPlayable,
      onChange: (change) => {
        currentReferenceId = change.stop.key;
        writeAddress(change.index);
      },
    });
    const row = rowForPlayable(initialIndex);
    if (row) {
      window.scrollTo({
        top: Math.max(0, window.scrollY + row.getBoundingClientRect().top - window.innerHeight / 2),
        behavior: 'auto',
      });
    }
  }

  function readStopParameter(count: number): { index: number; rewrite: boolean } {
    const raw = search.get('stop');
    if (raw === null || !/^[0-9]+$/.test(raw)) return { index: 0, rewrite: true };
    const value = Number(raw);
    if (value < 1 || value > count) return { index: 0, rewrite: true };
    return { index: value - 1, rewrite: false };
  }

  function adopt(answer: ReelJson, first: boolean): void {
    const previousOrder = displayOrder;
    const previousIndex = currentReferenceId ? previousOrder.indexOf(currentReferenceId) : -1;
    version = answer.version;
    stopsById.clear();
    for (const stop of answer.stops) stopsById.set(stop.reference.id, stop);
    serverOrder = answer.stops.map((stop) => stop.reference.id);
    displayOrder = [...serverOrder];
    setText(heading, answer.name);
    document.title = `${answer.name} · Stowdeck`;
    paintRows();

    if (first) {
      const playable = playableOrder();
      const { index, rewrite } = readStopParameter(playable.length);
      startFader(index);
      if (rewrite) writeAddress(0);
      return;
    }
    const stillPlayable =
      currentReferenceId !== null && playableOrder().includes(currentReferenceId);
    if (stillPlayable) {
      syncFader({ swap: false, announce: false });
      return;
    }
    moveToNeighbour(previousOrder, previousIndex);
  }

  /**
   * When the current stop is no longer playable, the fader moves to the next playable stop
   * after it in reel order, or to the previous one when it was the last.
   */
  function moveToNeighbour(previousOrder: string[], previousIndex: number): void {
    const playable = new Set(playableOrder());
    if (playable.size === 0) {
      currentReferenceId = null;
      shell.field.updateReelStops([], 0, { swap: false, announce: false });
      return;
    }
    let chosen: string | undefined;
    for (let index = previousIndex + 1; index < previousOrder.length && !chosen; index += 1) {
      if (playable.has(previousOrder[index]!)) chosen = previousOrder[index];
    }
    for (let index = previousIndex - 1; index >= 0 && !chosen; index -= 1) {
      if (playable.has(previousOrder[index]!)) chosen = previousOrder[index];
    }
    currentReferenceId = chosen ?? playableOrder()[0]!;
    syncFader({ swap: true, announce: true });
  }

  function applyOrder(order: string[], focusAfter?: () => void): void {
    const before = measureRows([...stopList.children]);
    displayOrder = order;
    paintRows();
    slideRowsFrom(before);
    syncFader({ swap: false, announce: false });
    focusAfter?.();
  }

  function moveStop(
    referenceId: string,
    delta: number,
    pressed: HTMLButtonElement,
    other: HTMLButtonElement,
  ): void {
    const from = displayOrder.indexOf(referenceId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= displayOrder.length) return;
    const order = [...displayOrder];
    order.splice(to, 0, ...order.splice(from, 1));
    const title = stopsById.get(referenceId)?.reference.title ?? '';
    applyOrder(order, () => {
      const atEdge = to === 0 || to === order.length - 1;
      const target = atEdge && isEdgeButton(pressed, to, order.length) ? other : pressed;
      target.focus();
    });
    queue.push({ order, title, position: to + 1 });
    void pump();
  }

  function isEdgeButton(button: HTMLButtonElement, position: number, length: number): boolean {
    const movesUp = button.getAttribute('aria-label')?.endsWith(' up') === true;
    return (movesUp && position === 0) || (!movesUp && position === length - 1);
  }

  function removeStop(referenceId: string): void {
    const parts = rows.get(referenceId);
    const title = stopsById.get(referenceId)?.reference.title ?? '';
    const order = displayOrder.filter((id) => id !== referenceId);
    const buttons = [...stopList.querySelectorAll<HTMLButtonElement>('.stop-controls button')];
    const position = parts ? buttons.indexOf(parts.remove) : -1;
    const next = buttons.slice(position + 1).find((button) => button !== parts?.remove);
    (next ?? printButton).focus();
    if (parts) {
      const below = [...stopList.children].filter((child) => child !== parts.row);
      const before = measureRows(below);
      slideRowOut(parts.row, () => {
        parts.row.remove();
        rows.delete(referenceId);
        applyOrder(order);
        slideRowsFrom(before);
      });
    } else {
      applyOrder(order);
    }
    queue.push({ order, title, position: 0 });
    void pump().then(() => shell.setDeckStatus(`Removed ${title} from the reel.`));
  }

  /**
   * Each queued move is sent only after the previous answer arrives, carrying the version
   * from that answer.
   */
  async function pump(): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      while (queue.length > 0) {
        const job = queue[0]!;
        try {
          const answer = await api.reorderStops(reelId, version, job.order);
          queue.shift();
          version = answer.version;
          serverOrder = answer.stops.map((stop) => stop.reference.id);
          stopsById.clear();
          for (const stop of answer.stops) stopsById.set(stop.reference.id, stop);
          if (job.position > 0) {
            shell.setDeckStatus(`Moved ${job.title} to stop ${job.position}.`);
          }
        } catch (error) {
          queue.length = 0;
          if (error instanceof ApiCallError && error.code === 'reel_version_conflict') {
            shell.setDeckStatus(DECK_STATUS.reelVersionConflict);
            const answer = await api.reel(reelId).catch(() => null);
            if (answer) {
              adopt(answer, false);
              rows.get(job.order[job.position - 1] ?? '')?.up.focus();
            }
            return;
          }
          shell.setDeckStatus(DECK_STATUS.genericFailure);
          applyOrder([...serverOrder]);
          return;
        }
      }
    } finally {
      sending = false;
    }
  }

  function bindDrag(row: HTMLLIElement, referenceId: string): void {
    row.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      const startIndex = displayOrder.indexOf(referenceId);
      let lastIndex = startIndex;
      row.setPointerCapture(event.pointerId);
      row.classList.add('is-dragging');

      const onMove = (move: PointerEvent): void => {
        const siblings = [...stopList.children] as HTMLElement[];
        const target = siblings.findIndex((candidate) => {
          const box = candidate.getBoundingClientRect();
          return move.clientY < box.top + box.height / 2;
        });
        const next = target === -1 ? siblings.length - 1 : target;
        if (next !== lastIndex && next >= 0) {
          lastIndex = next;
          const order = [...displayOrder];
          const from = order.indexOf(referenceId);
          order.splice(next, 0, ...order.splice(from, 1));
          applyOrder(order);
        }
      };
      const onUp = (): void => {
        row.classList.remove('is-dragging');
        row.removeEventListener('pointermove', onMove);
        row.removeEventListener('pointerup', onUp);
        row.removeEventListener('pointercancel', onUp);
        if (lastIndex === startIndex) return;
        queue.push({
          order: [...displayOrder],
          title: stopsById.get(referenceId)?.reference.title ?? '',
          position: displayOrder.indexOf(referenceId) + 1,
        });
        void pump();
      };
      row.addEventListener('pointermove', onMove);
      row.addEventListener('pointerup', onUp);
      row.addEventListener('pointercancel', onUp);
    });
  }

  function paintSheets(sheets: SheetJson[]): void {
    const signature = sheets.map((sheet) => `${sheet.id}:${sheet.state}`).join('|');
    if (signature === sheetSignature) return;
    sheetSignature = signature;
    sheetList.replaceChildren();
    for (const sheet of sheets) {
      const stateWord =
        sheet.state === 'queued'
          ? 'Queued'
          : sheet.state === 'rendering'
            ? 'Rendering'
            : sheet.state === 'ready'
              ? 'Ready'
              : 'Failed';
      const children: Array<Node | string> = [
        element('p', { class: 'sheet-meta' }, [
          `${sheet.requested_at} · ${sheet.paper === 'a4' ? 'A4' : 'US Letter'} · ${sheet.unit}`,
        ]),
        element('p', { class: 'sheet-state' }, [stateWord]),
      ];
      if (sheet.state === 'ready' && sheet.pdf_url) {
        children.push(
          element('a', { href: sheet.pdf_url, class: 'action quiet', download: '' }, [
            'Download PDF',
          ]),
        );
      }
      if (sheet.state === 'failed') {
        const retry = element('button', { type: 'button', class: 'action quiet' }, ['Try again']);
        retry.addEventListener('click', () => {
          void api
            .retrySheet(sheet.id)
            .then(() => {
              requestedSheets.add(sheet.id);
              reportedSheets.delete(sheet.id);
              shell.setDeckStatus(DECK_STATUS.sheetQueued);
              void loadSheets();
            })
            .catch(() => shell.setDeckStatus(DECK_STATUS.genericFailure));
        });
        children.push(retry);
      }
      sheetList.append(element('li', { class: 'sheet-row' }, children));

      if (requestedSheets.has(sheet.id) && !reportedSheets.has(sheet.id)) {
        if (sheet.state === 'ready') {
          reportedSheets.add(sheet.id);
          shell.setDeckStatus(DECK_STATUS.sheetReady);
        } else if (sheet.state === 'failed') {
          reportedSheets.add(sheet.id);
          shell.setDeckStatus(DECK_STATUS.sheetFailed);
        }
      }
    }
  }

  async function loadSheets(): Promise<void> {
    const answer = await api.sheets(reelId).catch(() => null);
    if (answer && !destroyed) paintSheets(answer.sheets);
  }

  printButton.addEventListener('click', () => {
    let paper: Paper = 'a4';
    let sheetUnit: Unit = unit();
    openDialog({
      label: 'Print contact sheet',
      opener: printButton,
      build: (close) => {
        const paperGroup = element('div', { role: 'radiogroup', 'aria-label': 'Paper' });
        for (const [value, label] of [
          ['a4', 'A4'],
          ['letter', 'US Letter'],
        ] as const) {
          const radioId = `paper-${value}`;
          const input = element('input', {
            id: radioId,
            type: 'radio',
            name: 'paper',
            value,
            checked: value === paper,
          });
          input.addEventListener('change', () => {
            if (input.checked) paper = value;
          });
          paperGroup.append(input, element('label', { for: radioId }, [label]));
        }
        const unitGroup = element('div', { role: 'radiogroup', 'aria-label': 'Sheet unit' });
        for (const value of ['mm', 'in'] as const) {
          const radioId = `sheet-unit-${value}`;
          const input = element('input', {
            id: radioId,
            type: 'radio',
            name: 'sheet-unit',
            value,
            checked: value === sheetUnit,
          });
          input.addEventListener('change', () => {
            if (input.checked) sheetUnit = value;
          });
          unitGroup.append(input, element('label', { for: radioId }, [value]));
        }
        const request = element('button', { type: 'button', class: 'action primary' }, [
          'Request sheet',
        ]);
        request.addEventListener('click', () => {
          close();
          void api
            .requestSheet(reelId, paper, sheetUnit, newIdempotencyKey())
            .then((sheet) => {
              requestedSheets.add(sheet.id);
              shell.setDeckStatus(DECK_STATUS.sheetQueued);
              void loadSheets();
            })
            .catch((error: unknown) => {
              if (error instanceof ApiCallError && error.code === 'reel_empty') {
                shell.setDeckStatus(DECK_STATUS.reelEmpty);
                return;
              }
              shell.setDeckStatus(DECK_STATUS.genericFailure);
            });
        });
        return [paperGroup, unitGroup, request];
      },
    });
  });

  async function load(first: boolean): Promise<void> {
    const answer = await api.reel(reelId).catch(() => null);
    if (destroyed) return;
    if (!answer) {
      setText(heading, 'Not in your deck');
      shell.field.showMessage(SCREEN_STATES.unknown);
      return;
    }
    if (queue.length > 0 || sending) return;
    adopt(answer, first);
  }

  const stopUnitListener = shell.onUnitChange(() => {
    paintRows();
    syncFader({ swap: false, announce: false });
  });

  void load(true).then(() => loadSheets());
  const stopRefetch = startRefetch(() => {
    void load(false);
    void loadSheets();
  });
  const sheetPoll = window.setInterval(() => void loadSheets(), 2_000);

  return {
    destroy() {
      destroyed = true;
      stopRefetch();
      stopUnitListener();
      window.clearInterval(sheetPoll);
      document.title = 'Stowdeck';
    },
  };
}
