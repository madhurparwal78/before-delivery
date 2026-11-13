import { ApiProblem, call, callWithTag, newKey } from '../api.js';
import { append, button, clear, combobox, el, field, showFieldError, spinbutton, textbox } from '../dom.js';
import { listen } from '../events.js';
import { clearBand, follow, heading, navigation, reducedMotion, showBand } from '../shell.js';
import { syncStatus } from '../sync.js';
import { sync, watchSync } from '../queue.js';
import { drawCellZoom, drawWall, type CellLight } from '../wall.js';
import type { SiteSummary } from './walls.js';

interface Placement {
  readonly id: string;
  readonly status: 'Bodied' | 'On hold' | 'Needs a body';
  readonly bodySerial: string | null;
  readonly holdId: string | null;
  readonly model: string;
  readonly lensSerial: string;
  readonly aimAcross: string;
  readonly aimDown: string;
  readonly bodyAcross: string;
  readonly bodyDown: string;
  readonly standoff: string;
  readonly ratio: string;
  readonly shiftAcrossPercent: string;
  readonly shiftDownPercent: string;
  readonly circuitId: string;
}

interface Layout {
  readonly id: string;
  readonly siteId: string;
  readonly name: string;
  readonly version: number;
  readonly sheetStatus: string;
  readonly sheetId: string | null;
  readonly hash: string;
  readonly placements: readonly Placement[];
}

interface Picker {
  readonly models: readonly { model: string; free: number }[];
  readonly bodies: readonly { serial: string; model: string; location: string; free: boolean }[];
  readonly lenses: readonly { serial: string; model: string; location: string; free: boolean }[];
  readonly holds: readonly { id: string; model: string; serial: string | null; status: string }[];
}

interface Sheet {
  readonly id: string;
  readonly status: string;
}

const STEP = 0.5;

function cellName(column: number, row: number): string {
  let letters = '';
  let remaining = column;
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    remaining = (remaining - 1 - index) / 26;
  }
  return `${letters}${row}`;
}

function cellPosition(name: string, columns: number): { column: number; row: number } | null {
  const parts = /^([A-Z]+)([1-9][0-9]*)$/.exec(name);
  if (parts === null) return null;
  let column = 0;
  for (const letter of parts[1] as string) column = column * 26 + (letter.charCodeAt(0) - 64);
  if (column > columns) return null;
  return { column, row: Number(parts[2]) };
}

export async function renderWorkspace(
  screen: HTMLElement,
  chrome: HTMLElement,
  siteId: string,
  layoutId: string,
): Promise<() => void> {
  clear(chrome);
  chrome.appendChild(navigation('/sites'));

  const site = await call<SiteSummary>(`/api/sites/${siteId}`);
  let layout: Layout;
  let etag: string | null;
  let cells: CellLight[] = [];
  let picker: Picker;
  let current: string | null = null;

  const load = async (): Promise<void> => {
    const answer = await callWithTag<Layout>(`/api/layouts/${layoutId}`);
    layout = answer.body;
    etag = answer.etag;
    cells = (await call<{ items: CellLight[] }>(`/api/layouts/${layoutId}/cells`)).items;
    picker = await call<Picker>(`/api/layouts/${layoutId}/picker`);
  };
  await load();

  const wallCanvas = el('canvas', { class: 'wall', width: site.columns * 24, height: site.rows * 24 });
  const loupeCanvas = el('canvas', { width: 320, height: 100 });
  const loupe = el('span', { class: 'loupe', role: 'img', 'aria-label': 'Show-night loupe' }, [loupeCanvas]);
  const slotCanvas = el('canvas', { width: 320, height: 100 });
  const announcement = el('p', { class: 'status', role: 'status', 'aria-label': 'Cell reading' });
  const sentenceHost = el('div');
  const staleHost = el('div');
  const grid = el('div', {
    class: 'cells',
    role: 'grid',
    'aria-label': 'Wall cells',
    'aria-rowcount': site.rows,
    'aria-colcount': site.columns,
  });
  const markers = el('div', { class: 'markers' });
  const panner = el('div', { class: 'wall-pan' }, [wallCanvas, loupe, grid, markers]);
  const wallRegion = el('div', { class: 'wall-region', role: 'region', 'aria-label': 'Wall' }, [panner]);

  const cellOf = (name: string | null): CellLight | null =>
    name === null ? null : (cells.find((cell) => cell.cell === name) ?? null);

  const lowestReadCell = (): CellLight | null => {
    let lowest: CellLight | null = null;
    let lowestContrast = Number.POSITIVE_INFINITY;
    for (const cell of cells) {
      if (cell.contrast === null || cell.contributions.length === 0) continue;
      if (cell.contrast < lowestContrast) {
        lowest = cell;
        lowestContrast = cell.contrast;
      }
    }
    return lowest;
  };

  const sentenceFor = (): string => {
    if (!site.rectified) return 'NO WALL YET';
    const chosen = cellOf(current);
    if (chosen !== null) {
      return chosen.contrastText === null
        ? 'THIS WALL HAS NO READING HERE'
        : `THIS WALL READS AT ${chosen.contrastText.toUpperCase()}`;
    }
    const lowest = lowestReadCell();
    return lowest === null || lowest.contrastText === null
      ? 'THIS WALL HAS NO READING HERE'
      : `THIS WALL READS AT ${lowest.contrastText.toUpperCase()}`;
  };

  const stage = el('dialog', { class: 'stage', 'aria-label': 'Full wall' });
  const openStage = (): void => {
    const canvas = el('canvas', { width: site.columns * 32, height: site.rows * 32, style: 'width:100%' });
    clear(stage);
    append(stage, [
      el('h2', { text: 'Full wall' }),
      canvas,
      button('Close the full wall', () => stage.close()),
    ]);
    drawWall(canvas, { columns: site.columns, rows: site.rows, cells, showLevel: true });
    stage.showModal();
  };
  const slot = el(
    'button',
    { type: 'button', class: site.rectified ? 'slot' : 'slot unlit', 'aria-label': 'Open the full wall', onclick: openStage },
    site.rectified ? [slotCanvas] : [],
  );

  const drawSentence = (): void => {
    clear(sentenceHost);
    const head = heading({ sentence: sentenceFor(), slot });
    sentenceHost.appendChild(head);
    if (!reducedMotion()) {
      const roller = head.firstElementChild as HTMLElement | null;
      roller?.classList.add('rolling');
      roller?.animate?.(
        [
          { transform: 'translateY(0.25em)', opacity: 0.4 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        { duration: 200, easing: 'ease-out' },
      );
    }
    clear(staleHost);
    if (site.stale) {
      staleHost.appendChild(
        el('p', { class: 'stale', text: 'These readings are stale; street lighting and foliage change.' }),
      );
    }
    drawCellZoom(slotCanvas, cellOf(current) ?? lowestReadCell());
  };

  const announce = (name: string): void => {
    const cell = cellOf(name);
    if (cell === null || cell.contrastText === null) {
      announcement.textContent = `Cell ${name}, no reading.`;
      return;
    }
    announcement.textContent = cell.blended
      ? `Cell ${name}, ${cell.contrastText}, ${cell.pixelsPerMetre} pixels per metre, blended.`
      : `Cell ${name}, ${cell.contrastText}, ${cell.pixelsPerMetre} pixels per metre.`;
  };

  const moveLoupe = (name: string): void => {
    const position = cellPosition(name, site.columns);
    if (position === null) return;
    const width = panner.clientWidth;
    const height = wallCanvas.clientHeight;
    const cellWidth = width / site.columns;
    const cellHeight = height / site.rows;
    const left = (position.column - 1) * cellWidth + cellWidth / 2 - loupe.clientWidth / 2;
    const top = (position.row - 1) * cellHeight + cellHeight / 2 - loupe.clientHeight / 2;
    loupe.style.transform = `translate(${Math.max(0, Math.min(width - loupe.clientWidth, left))}px, ${Math.max(0, Math.min(height - loupe.clientHeight, top))}px)`;
  };

  /** The signature sequence: glide, relight, roll, address, announce. */
  const arriveAt = (name: string): void => {
    if (name === current) return;
    current = name;
    moveLoupe(name);
    drawCellZoom(loupeCanvas, cellOf(name));
    drawSentence();
    const address = new URL(window.location.href);
    address.searchParams.set('cell', name);
    history.replaceState(history.state, '', address.toString());
    announce(name);
  };

  const buildGrid = (): void => {
    clear(grid);
    grid.style.gridTemplateRows = `repeat(${site.rows}, 1fr)`;
    for (let row = 1; row <= site.rows; row += 1) {
      const rowNode = el('div', { role: 'row', 'aria-rowindex': row });
      rowNode.style.gridTemplateColumns = `repeat(${site.columns}, 1fr)`;
      for (let column = 1; column <= site.columns; column += 1) {
        const name = cellName(column, row);
        const cellNode = el('div', {
          role: 'gridcell',
          'aria-colindex': column,
          'aria-label': name,
          tabindex: row === 1 && column === 1 ? 0 : -1,
          text: name,
        });
        cellNode.addEventListener('focus', () => arriveAt(name));
        cellNode.addEventListener('click', () => {
          focusCell(column, row);
        });
        cellNode.addEventListener('mousemove', () => arriveAt(name));
        rowNode.appendChild(cellNode);
      }
      grid.appendChild(rowNode);
    }
  };

  const focusCell = (column: number, row: number): void => {
    const clampedColumn = Math.max(1, Math.min(site.columns, column));
    const clampedRow = Math.max(1, Math.min(site.rows, row));
    const node = grid.querySelector<HTMLElement>(
      `[role="row"][aria-rowindex="${clampedRow}"] [aria-colindex="${clampedColumn}"]`,
    );
    if (node === null) return;
    for (const other of grid.querySelectorAll<HTMLElement>('[role="gridcell"]')) other.tabIndex = -1;
    node.tabIndex = 0;
    node.focus();
  };

  grid.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const column = Number(target.getAttribute('aria-colindex'));
    const row = Number(target.closest('[role="row"]')?.getAttribute('aria-rowindex'));
    if (Number.isNaN(column) || Number.isNaN(row)) return;
    const step = event.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [step, 0],
      ArrowLeft: [-step, 0],
      ArrowDown: [0, step],
      ArrowUp: [0, -step],
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      focusCell(column + move[0], row + move[1]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusCell(1, event.ctrlKey ? 1 : row);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusCell(site.columns, event.ctrlKey ? site.rows : row);
    }
  });

  wallRegion.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      openPlacementDialog(null, current);
    }
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      openStage();
    }
  });

  let panStart: { x: number; y: number; offset: number } | null = null;
  wallRegion.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      if (touch === undefined) return;
      panStart = { x: touch.clientX, y: touch.clientY, offset: panner.offsetLeft };
      loupe.style.transform = `translate(${panner.clientWidth / 2 - loupe.clientWidth / 2}px, ${wallCanvas.clientHeight / 2 - loupe.clientHeight / 2}px)`;
    },
    { passive: true },
  );
  wallRegion.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (touch === undefined || panStart === null) return;
      event.preventDefault();
      const moved = touch.clientX - panStart.x;
      const left = Math.max(-panner.clientWidth, Math.min(panner.clientWidth, panStart.offset + moved));
      panner.style.left = `${left}px`;
      const cellWidth = panner.clientWidth / site.columns;
      const cellHeight = wallCanvas.clientHeight / site.rows;
      const column = Math.max(1, Math.min(site.columns, Math.ceil((panner.clientWidth / 2 - left) / cellWidth)));
      const row = Math.max(1, Math.min(site.rows, Math.ceil(wallCanvas.clientHeight / 2 / cellHeight)));
      arriveAt(cellName(column, row));
    },
    { passive: false },
  );
  wallRegion.addEventListener('touchend', () => {
    panStart = null;
  });

  const placementsList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Placements' });
  const freeList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Free bodies' });
  const issueStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Issue' });
  const sheetLinkHost = el('p');
  const readingsHost = el('div');
  const dialogHost = el('div');

  const bodyOptions = (placement: Placement | null): { value: string; label: string }[] => {
    const options: { value: string; label: string }[] = [];
    for (const body of picker.bodies) options.push({ value: `body:${body.serial}`, label: `${body.serial} ${body.model}` });
    for (const hold of picker.holds) {
      if (hold.serial === null) continue;
      options.push({ value: `hold:${hold.id}`, label: `${hold.serial} ${hold.model} on hold` });
    }
    const shortfalls = new Set<string>();
    for (const model of picker.models) {
      if (shortfalls.has(model.model)) continue;
      shortfalls.add(model.model);
      options.push({ value: `model:${model.model}`, label: `Needs a body ${model.model}` });
    }
    if (placement?.bodySerial !== null && placement !== null) {
      const known = options.some((option) => option.value === `body:${placement.bodySerial}`);
      if (!known) {
        options.unshift({ value: `body:${placement.bodySerial}`, label: `${placement.bodySerial} ${placement.model}` });
      }
    }
    return options;
  };

  const openPlacementDialog = (placement: Placement | null, cell: string | null): void => {
    const opener = document.activeElement as HTMLElement | null;
    const position = cell === null ? null : cellPosition(cell, site.columns);
    const aimAcrossDefault = position === null ? 0 : Math.ceil(((position.column - 0.5) * STEP) / STEP) * STEP;
    const aimDownDefault = position === null ? 0 : Math.ceil(((position.row - 0.5) * STEP) / STEP) * STEP;
    const bodySelect = combobox(
      'Body',
      bodyOptions(placement),
      placement === null
        ? undefined
        : placement.bodySerial !== null
          ? `body:${placement.bodySerial}`
          : placement.holdId !== null
            ? `hold:${placement.holdId}`
            : `model:${placement.model}`,
    );
    const lensSelect = combobox(
      'Lens',
      picker.lenses.map((lens) => ({ value: lens.serial, label: `${lens.serial} ${lens.model}` })),
      placement?.lensSerial,
    );
    const aimAcross = spinbutton('Aim across', Number(placement?.aimAcross ?? aimAcrossDefault), STEP);
    const aimDown = spinbutton('Aim down', Number(placement?.aimDown ?? aimDownDefault), STEP);
    const bodyAcross = spinbutton('Body across', Number(placement?.bodyAcross ?? aimAcrossDefault), STEP);
    const bodyDown = spinbutton('Body down', Number(placement?.bodyDown ?? aimDownDefault), STEP);
    const standoff = textbox('Standoff', placement === null ? '18' : placement.standoff);
    const standoffUnit = combobox('Standoff unit', [
      { value: 'm', label: 'm' },
      { value: 'ft', label: 'ft' },
    ]);
    const ratio = textbox('Zoom ratio', placement === null ? '1,3' : placement.ratio);
    const shiftAcross = textbox('Shift across', placement === null ? '0' : placement.shiftAcrossPercent);
    const shiftDown = textbox('Shift down', placement === null ? '0' : placement.shiftDownPercent);
    const circuit = combobox(
      'Circuit',
      site.circuits.map((entry) => ({ value: entry.id, label: entry.name })),
      placement?.circuitId,
    );

    const dialog = el('dialog', {
      'aria-label': placement === null ? 'Place a body' : `Aim ${placement.bodySerial ?? placement.model}`,
    });
    const close = (): void => {
      dialog.close();
      dialog.remove();
      opener?.focus();
    };

    const save = async (): Promise<void> => {
      for (const pointer of [
        '/ratio',
        '/shiftAcrossPercent',
        '/shiftDownPercent',
        '/standoff',
        '/aimAcross',
        '/aimDown',
        '/lensSerial',
      ]) {
        showFieldError(`placement${pointer}`, null);
      }
      clearBand();
      const chosen = bodySelect.value;
      const body: Record<string, unknown> = {
        lensSerial: lensSelect.value,
        aimAcross: { text: aimAcross.value, unit: 'm' },
        aimDown: { text: aimDown.value, unit: 'm' },
        bodyAcross: { text: bodyAcross.value, unit: 'm' },
        bodyDown: { text: bodyDown.value, unit: 'm' },
        standoff: { text: standoff.value, unit: standoffUnit.value },
        ratio: ratio.value,
        shiftAcrossPercent: shiftAcross.value,
        shiftDownPercent: shiftDown.value,
        circuitId: circuit.value,
      };
      if (chosen.startsWith('body:')) body['bodySerial'] = chosen.slice(5);
      else if (chosen.startsWith('hold:')) body['holdId'] = chosen.slice(5);
      else body['model'] = chosen.slice(6);
      try {
        if (placement === null) {
          await call(`/api/layouts/${layoutId}/placements`, {
            method: 'POST',
            key: newKey(),
            ifMatch: etag ?? undefined,
            body,
          });
        } else {
          await call(`/api/layouts/${layoutId}/placements/${placement.id}`, {
            method: 'PATCH',
            ifMatch: etag ?? undefined,
            body,
          });
        }
        close();
        await refresh();
      } catch (error) {
        if (!(error instanceof ApiProblem)) throw error;
        const errors = error.body.errors ?? {};
        for (const [pointer, copy] of Object.entries(errors)) {
          showFieldError(`placement${pointer.replace(/\/text$/, '')}`, copy);
        }
        if (error.body.errors === undefined) showBand(error.body.detail);
      }
    };

    append(dialog, [
      el('h2', { text: placement === null ? 'Place a body' : `Aim ${placement.bodySerial ?? placement.model}` }),
      el('form', { onsubmit: (event: Event) => event.preventDefault() }, [
        el('label', {}, ['Body', bodySelect]),
        field('Lens', lensSelect, 'placement/lensSerial'),
        field('Aim across', aimAcross, 'placement/aimAcross'),
        field('Aim down', aimDown, 'placement/aimDown'),
        el('label', {}, ['Body across', bodyAcross]),
        el('label', {}, ['Body down', bodyDown]),
        field('Standoff', standoff, 'placement/standoff'),
        el('label', {}, ['Standoff unit', standoffUnit]),
        field('Zoom ratio', ratio, 'placement/ratio'),
        field('Shift across', shiftAcross, 'placement/shiftAcrossPercent'),
        field('Shift down', shiftDown, 'placement/shiftDownPercent'),
        el('label', {}, ['Circuit', circuit]),
        el('div', { class: 'row-actions' }, [
          button('Save placement', () => void save()),
          button('Cancel', close, { class: 'quiet' }),
        ]),
      ]),
    ]);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialogHost.appendChild(dialog);
    dialog.showModal();
    bodySelect.focus();
  };

  const removePlacement = async (placement: Placement): Promise<void> => {
    clearBand();
    try {
      await call(`/api/layouts/${layoutId}/placements/${placement.id}`, {
        method: 'DELETE',
        ifMatch: etag ?? undefined,
      });
      await refresh();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const issue = async (): Promise<void> => {
    clearBand();
    issueStatus.textContent = 'Issuing the rig sheet';
    try {
      const sheet = await call<Sheet>(`/api/layouts/${layoutId}/issue`, {
        method: 'POST',
        key: newKey(),
        body: {},
      });
      issueStatus.textContent = 'Issued.';
      await refresh();
      clear(sheetLinkHost);
      sheetLinkHost.appendChild(
        el('a', { href: `/sheets/${sheet.id}`, text: 'Open the sheet', onclick: follow }),
      );
    } catch (error) {
      issueStatus.textContent = '';
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const drawPlacements = async (): Promise<void> => {
    clear(placementsList);
    for (const [index, placement] of layout.placements.entries()) {
      const name = placement.bodySerial ?? null;
      const aimLabel = name === null ? `Aim placement ${index + 1}` : `Aim ${name}`;
      const removeLabel = name === null ? `Remove placement ${index + 1}` : `Remove ${name}`;
      placementsList.appendChild(
        el('li', {}, [
          el('span', {
            text:
              placement.status === 'Needs a body'
                ? `Needs a body ${placement.model}`
                : `${name ?? placement.model} ${placement.model} on ${placement.lensSerial}`,
          }),
          el('span', { text: placement.status }),
          el('div', { class: 'row-actions' }, [
            button(aimLabel, () => openPlacementDialog(placement, null)),
            button(removeLabel, () => void removePlacement(placement), { class: 'quiet' }),
          ]),
        ]),
      );
    }
    clear(freeList);
    for (const model of picker.models) {
      freeList.appendChild(el('li', {}, [el('span', { text: `${model.model} ${model.free} free` })]));
    }
    clear(sheetLinkHost);
    if (layout.sheetStatus !== 'Draft' && layout.sheetId !== null) {
      sheetLinkHost.appendChild(
        el('a', { href: `/sheets/${layout.sheetId}`, text: 'Open the sheet', onclick: follow }),
      );
    }
    drawMarkers();
  };

  /** Aim markers, draggable on the same half-metre steps the spinbuttons use. */
  const drawMarkers = (): void => {
    clear(markers);
    for (const placement of layout.placements) {
      const marker = el('span', {
        class: 'aim-marker',
        'aria-hidden': 'true',
        'data-placement': placement.id,
      });
      const place = (across: number, down: number): void => {
        marker.style.left = `${(across / Number(site.widthMetres)) * 100}%`;
        marker.style.top = `${(down / Number(site.heightMetres)) * 100}%`;
      };
      place(Number(placement.aimAcross), Number(placement.aimDown));
      let dragging = false;
      marker.addEventListener('pointerdown', (event) => {
        dragging = true;
        marker.setPointerCapture((event as PointerEvent).pointerId);
      });
      marker.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const box = panner.getBoundingClientRect();
        const pointer = event as PointerEvent;
        const across = Math.round((((pointer.clientX - box.left) / box.width) * Number(site.widthMetres)) / STEP) * STEP;
        const down = Math.round((((pointer.clientY - box.top) / box.height) * Number(site.heightMetres)) / STEP) * STEP;
        place(across, down);
        marker.dataset['across'] = String(across);
        marker.dataset['down'] = String(down);
      });
      marker.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        const across = marker.dataset['across'];
        const down = marker.dataset['down'];
        if (across === undefined || down === undefined) return;
        void movePlacement(placement, across, down);
      });
      markers.appendChild(marker);
    }
  };

  const movePlacement = async (placement: Placement, across: string, down: string): Promise<void> => {
    clearBand();
    try {
      await call(`/api/layouts/${layoutId}/placements/${placement.id}`, {
        method: 'PATCH',
        ifMatch: etag ?? undefined,
        body: { aimAcross: { text: across, unit: 'm' }, aimDown: { text: down, unit: 'm' } },
      });
      await refresh();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const drawReadings = (): HTMLElement => {
    const rows = cells
      .filter((cell) => cell.ambientLux !== null)
      .slice(0, 60)
      .map((cell) =>
        el('tr', {}, [
          el('td', { text: cell.cell }),
          el('td', { text: `${cell.ambientLux} lx` }),
          el('td', { text: cell.contrastText ?? 'No reading' }),
          el('td', { text: cell.band }),
        ]),
      );
    return el('table', { 'aria-label': 'Cell readings' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Cell' }),
          el('th', { scope: 'col', text: 'Ambient' }),
          el('th', { scope: 'col', text: 'Contrast' }),
          el('th', { scope: 'col', text: 'Band' }),
        ]),
      ]),
      el('tbody', {}, rows),
    ]);
  };

  const refresh = async (): Promise<void> => {
    await load();
    drawWall(wallCanvas, { columns: site.columns, rows: site.rows, cells });
    drawSentence();
    await drawPlacements();
    clear(readingsHost);
    readingsHost.appendChild(drawReadings());
  };

  const sync_ = syncStatus();
  const readingsRegion = el('div', { role: 'region', 'aria-label': 'Readings' }, [
    el('h2', { text: 'Readings' }),
    announcement,
    sync_.node,
    button('Sync now', () => void sync()),
    readingsHost,
  ]);
  const bodiesRegion = el('div', { role: 'region', 'aria-label': 'Bodies' }, [
    el('h2', { text: 'Bodies' }),
    button('Place body', () => openPlacementDialog(null, current)),
    placementsList,
    freeList,
    button('Issue rig sheet', () => void issue()),
    issueStatus,
    sheetLinkHost,
  ]);

  const disclosure = button('Readings', () => {
    const expanded = disclosure.getAttribute('aria-expanded') === 'true';
    disclosure.setAttribute('aria-expanded', String(!expanded));
    sheetBody.hidden = expanded;
  });
  disclosure.setAttribute('aria-expanded', 'false');
  const sheetBody = el('div', { hidden: true }, [readingsRegion, bodiesRegion]);
  const bandLine = el('p', { class: 'status' });
  const phoneSheet = el('div', { class: 'phone-sheet' }, [bandLine, disclosure, sheetBody]);

  const workArea = el('div', { class: 'workspace' });
  const narrow = window.matchMedia('(max-width: 767px)');
  const layoutRegions = (): void => {
    clear(workArea);
    if (narrow.matches) {
      append(workArea, [wallRegion, phoneSheet]);
      sheetBody.hidden = disclosure.getAttribute('aria-expanded') !== 'true';
    } else {
      append(workArea, [wallRegion, readingsRegion, bodiesRegion]);
      sheetBody.hidden = true;
    }
  };
  narrow.addEventListener('change', layoutRegions);

  clear(screen);
  append(screen, [sentenceHost, staleHost, workArea, stage, dialogHost]);
  buildGrid();
  layoutRegions();
  await refresh();

  const asked = new URL(window.location.href).searchParams.get('cell');
  if (asked !== null && cellPosition(asked, site.columns) !== null && cellOf(asked) !== null) {
    arriveAt(asked);
  } else {
    drawSentence();
  }
  const lowest = lowestReadCell();
  bandLine.textContent = lowest?.band ?? 'No reading';

  const stopWatching = watchSync((state) => sync_.update(state));
  const stopListening = listen('/api/events', (event) => {
    if (
      (event.type === 'layout.changed' && event.aggregateId === layoutId) ||
      (event.type === 'reading.accepted' && event.aggregateId === siteId) ||
      event.type === 'sheet.changed' ||
      event.type === 'kit.moved' ||
      event.type === 'hold.changed'
    ) {
      void refresh();
    }
  });
  return () => {
    stopWatching();
    stopListening();
    narrow.removeEventListener('change', layoutRegions);
  };
}
