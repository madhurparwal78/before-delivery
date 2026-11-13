import { ApiProblem, call, callWithTag, newKey } from '../api.js';
import { append, button, clear, el } from '../dom.js';
import { type Opener, openDialog } from '../dialog.js';
import { listen } from '../events.js';
import { clearBand, follow, navigation, reducedMotion, showBand } from '../shell.js';
import { syncStatus } from '../sync.js';
import { sync, watchSync } from '../queue.js';
import { type CellLight, drawLoupe, drawWall } from '../wall.js';
import type { SiteSummary } from './walls.js';
import {
  type Picker,
  type Placement,
  openPlacementDialog,
  placementName,
} from './placement.js';
import { cellPosition, createWallView } from './wallview.js';

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

interface Reading {
  readonly id: string;
  readonly entered: { text: string; unit: string };
  readonly canonicalLux: string;
  readonly capturedAt: string;
  readonly counts: boolean;
}

interface Sheet {
  readonly id: string;
}

const STAGE_MILLISECONDS = 330;
const ROLL_MILLISECONDS = 200;
const STALE_COPY = 'These readings are stale; street lighting and foliage change.';

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
  let etag: string | null = null;
  let cells: CellLight[] = [];
  let picker: Picker;
  let current: string | null = null;
  let loaded = 0;

  const load = async (): Promise<void> => {
    const ticket = ++loaded;
    const answer = await callWithTag<Layout>(`/api/layouts/${layoutId}`);
    const fresh = (await call<{ items: CellLight[] }>(`/api/layouts/${layoutId}/cells`)).items;
    const choices = await call<Picker>(`/api/layouts/${layoutId}/picker`);
    if (ticket !== loaded) return;
    layout = answer.body;
    etag = answer.etag;
    cells = fresh;
    picker = choices;
  };
  await load();

  const cellOf = (name: string | null): CellLight | null =>
    name === null ? null : (cells.find((cell) => cell.cell === name) ?? null);

  const lowestReadCell = (): CellLight | null => {
    let lowest: CellLight | null = null;
    for (const cell of cells) {
      if (cell.contrast === null || cell.contributions.length === 0) continue;
      if (lowest === null || (lowest.contrast as number) > cell.contrast) lowest = cell;
    }
    return lowest;
  };

  /** What the sentence reads: the chosen cell, else the lowest contrast among covered cells with a reading. */
  const shown = (): CellLight | null => cellOf(current) ?? lowestReadCell();

  // --- the sentence -------------------------------------------------------------------------------
  const lead = el('span', { 'aria-hidden': 'true' });
  const figure = el('span', { class: 'figure', 'aria-hidden': 'true' });
  const slotCanvas = el('canvas', { width: 320, height: 100 });
  const slot = site.rectified
    ? el('button', { type: 'button', class: 'slot', 'aria-label': 'Open the full wall' }, [slotCanvas])
    : el('span', { class: 'slot unlit', 'aria-hidden': 'true' });
  const title = el('h1', {}, [el('span', { class: 'words' }, [lead, figure]), slot]);
  const staleHost = el('div');

  let lastFigure = '';
  const drawSentence = (): void => {
    let words = 'NO WALL YET';
    let number = '';
    if (site.rectified) {
      const cell = shown();
      if (cell === null || cell.contrastText === null) words = 'THIS WALL HAS NO READING HERE';
      else {
        words = 'THIS WALL READS AT ';
        number = cell.contrastText.toUpperCase();
      }
    }
    lead.textContent = words;
    figure.textContent = number;
    title.setAttribute('aria-label', `${words}${number}`);
    if (number !== '' && number !== lastFigure && lastFigure !== '' && !reducedMotion()) {
      figure.animate(
        [
          { transform: 'translateY(0.6em)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        { duration: ROLL_MILLISECONDS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
    lastFigure = number;
    clear(staleHost);
    if (site.stale) staleHost.appendChild(el('p', { class: 'stale', text: STALE_COPY }));
    if (site.rectified) {
      drawLoupe(slotCanvas, { columns: site.columns, rows: site.rows, cells, cell: shown()?.cell ?? null, span: 7 });
    }
  };

  // --- the wall -----------------------------------------------------------------------------------
  const announce = (name: string): void => {
    const cell = cellOf(name);
    if (cell === null || cell.contrastText === null) {
      wall.caption.textContent = `Cell ${name}, no reading.`;
      return;
    }
    wall.caption.textContent = `Cell ${name}, ${cell.contrastText}, ${cell.pixelsPerMetre} pixels per metre${cell.blended ? ', blended.' : '.'}`;
  };

  const bandLine = el('p', { class: 'band-line' });
  const facts = el('dl', { class: 'facts' });
  const cellReadings = el('tbody');

  const drawReadouts = (): void => {
    const cell = shown();
    bandLine.textContent = cell?.band ?? 'No reading';
    clear(facts);
    if (cell !== null) {
      const rowsOfFacts: [string, string][] = [
        ['Cell', cell.cell],
        ['Band', cell.band],
        ['Contrast', cell.contrastText ?? 'No reading'],
        ['Ambient', cell.ambientLux === null ? 'No reading' : `${cell.ambientLux} lx`],
        ['Total light', cell.totalLux === null ? 'No reading' : `${cell.totalLux} lx`],
        ['Pixels per metre', String(cell.pixelsPerMetre)],
        ['Blend', cell.blended ? 'Blended' : 'Single body'],
      ];
      for (const [name, value] of rowsOfFacts) append(facts, [el('dt', { text: name }), el('dd', { text: value })]);
    }
  };

  const drawCellReadings = async (): Promise<void> => {
    const name = current;
    const items = name === null ? [] : (await call<{ items: Reading[] }>(`/api/sites/${siteId}/cells/${name}/readings`)).items;
    if (name !== current) return;
    clear(cellReadings);
    for (const reading of items) {
      cellReadings.appendChild(
        el('tr', {}, [
          el('td', { text: `${reading.entered.text} ${reading.entered.unit}` }),
          el('td', { text: `${reading.canonicalLux} lx` }),
          el('td', { text: reading.counts ? 'Counts' : 'Older' }),
        ]),
      );
    }
  };

  const wall = createWallView(
    { columns: site.columns, rows: site.rows, widthMetres: Number(site.widthMetres), heightMetres: Number(site.heightMetres) },
    {
      arrived: (name) => {
        current = name;
        drawSentence();
        const address = new URL(window.location.href);
        address.searchParams.set('cell', name);
        history.replaceState(history.state, '', address.toString());
        announce(name);
        drawReadouts();
        void drawCellReadings();
      },
      shortcut: (key) => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const grid = wall.grid.contains(opener) ? opener : (wall.grid.querySelector<HTMLElement>('[tabindex="0"]') ?? opener);
        if (key === 'place') placeBody(null, grid);
        else openStage(grid);
      },
      aimMoved: (placement, across, down) => void movePlacement(placement as Placement, across, down),
    },
  );

  // --- the full wall stage ------------------------------------------------------------------------
  const stage = el('dialog', { class: 'stage', 'aria-label': 'Full wall' });
  const openStage = (opener: Opener): void => {
    const canvas = el('canvas', { width: site.columns * 32, height: site.rows * 32 });
    clear(stage);
    const closer = button('Close the full wall', () => handle.close());
    append(stage, [el('h2', { text: 'Full wall' }), canvas, closer]);
    drawWall(canvas, { columns: site.columns, rows: site.rows, cells, mode: 'show' });
    const from = slot.getBoundingClientRect();
    const handle = openDialog(stage, opener, async () => {
      await sweep(from, true);
      stage.close();
      stage.style.transform = '';
      stage.style.opacity = '';
    });
    void sweep(from, false);
  };

  /**
   * The stage grows from the slot's rectangle and closes back into it by the same path. It is driven by
   * the frame clock rather than a CSS animation, so the stage is where it appears to be whenever it is read.
   */
  const sweep = async (from: DOMRect, closing: boolean): Promise<void> => {
    if (reducedMotion()) return;
    const to = stage.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    stage.style.transformOrigin = 'top left';
    const place = (progress: number): void => {
      const eased = 1 - (1 - progress) ** 3;
      const open = closing ? 1 - eased : eased;
      stage.style.transform = `translate(${dx * (1 - open)}px, ${dy * (1 - open)}px) scale(${sx + (1 - sx) * open}, ${sy + (1 - sy) * open})`;
      stage.style.opacity = String(0.4 + 0.6 * open);
    };
    place(0);
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (): void => {
        const progress = Math.min(1, (performance.now() - started) / STAGE_MILLISECONDS);
        place(progress);
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    if (!closing) {
      stage.style.transform = '';
      stage.style.opacity = '';
    }
  };
  slot.addEventListener('click', () => openStage(slot));

  // --- bodies and placements ----------------------------------------------------------------------
  const placementsList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Placements' });
  const freeList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Free bodies' });
  const issueStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Issue' });
  const sheetLinkHost = el('p');

  const placeBody = (placement: Placement | null, opener: Opener): void => {
    openPlacementDialog({
      layoutId,
      columns: site.columns,
      rows: site.rows,
      circuits: site.circuits,
      picker,
      placement,
      cell: current,
      opener,
      etag: () => etag,
      saved: refresh,
    });
  };

  const removePlacement = async (placement: Placement): Promise<void> => {
    clearBand();
    try {
      await call(`/api/layouts/${layoutId}/placements/${placement.id}`, { method: 'DELETE', ifMatch: etag ?? undefined });
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
    await refresh();
  };

  const movePlacement = async (placement: Placement, across: string, down: string): Promise<void> => {
    clearBand();
    try {
      await call(`/api/layouts/${layoutId}/placements/${placement.id}`, {
        method: 'PATCH',
        ifMatch: etag ?? undefined,
        body: { aimAcross: { text: across, unit: 'm' }, aimDown: { text: down, unit: 'm' } },
      });
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
    await refresh();
  };

  const issue = async (): Promise<void> => {
    clearBand();
    issueStatus.textContent = 'Issuing the rig sheet';
    try {
      await call<Sheet>(`/api/layouts/${layoutId}/issue`, { method: 'POST', key: newKey(), body: {} });
      issueStatus.textContent = 'Issued.';
    } catch (error) {
      issueStatus.textContent = '';
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
    await refresh();
  };

  const aimButton = (label: string): HTMLElement | null =>
    [...placementsList.querySelectorAll<HTMLElement>('button')].find((node) => node.getAttribute('aria-label') === `Aim ${label}`) ?? null;

  /** Lists are rebuilt only when what they show changed, so a control under the pointer or the focus is never swapped for its twin. */
  const rebuilt = new Map<HTMLElement, string>();
  const rebuild = (host: HTMLElement, signature: unknown, build: () => void): void => {
    const next = JSON.stringify(signature);
    if (rebuilt.get(host) === next) return;
    rebuilt.set(host, next);
    const focused = host.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null;
    clear(host);
    build();
    if (focused != null) host.querySelector<HTMLElement>(`[aria-label="${focused}"]`)?.focus();
  };

  const drawPlacements = (): void => {
    rebuild(placementsList, [layout.placements, picker.holds], () => {
      for (const [index, placement] of layout.placements.entries()) {
        const name = placementName(placement, picker);
        const label = name ?? `placement ${index + 1}`;
        placementsList.appendChild(
          el('li', {}, [
            el('span', {
              text:
                placement.bodySerial === null && placement.status === 'Needs a body'
                  ? `Needs a body ${placement.model}`
                  : `${label} ${placement.model}`,
            }),
            el('span', { class: 'tag', text: placement.status }),
            el('div', { class: 'row-actions' }, [
              button(`Aim ${label}`, () => placeBody(placement, () => aimButton(label))),
              button(`Remove ${label}`, () => void removePlacement(placement)),
            ]),
          ]),
        );
      }
    });
    rebuild(freeList, picker.models, () => {
      for (const model of picker.models) freeList.appendChild(el('li', {}, [el('span', { text: `${model.model} ${model.free} free` })]));
    });
    rebuild(sheetLinkHost, [layout.sheetStatus, layout.sheetId], () => {
      if (layout.sheetStatus !== 'Draft' && layout.sheetId !== null) {
        sheetLinkHost.appendChild(el('a', { href: `/sheets/${layout.sheetId}`, class: 'action', text: 'Open the sheet', onclick: follow }));
      }
    });
    wall.setMarkers(layout.placements);
  };

  const refresh = async (): Promise<void> => {
    await load();
    wall.setCells(cells);
    drawSentence();
    drawReadouts();
    drawPlacements();
    if (current !== null) {
      announce(current);
      void drawCellReadings();
    }
  };

  // --- the screen ---------------------------------------------------------------------------------
  const sync_ = syncStatus();
  const readingsRegion = el('div', { role: 'region', 'aria-label': 'Readings' }, [
    el('h2', { text: 'Readings' }),
    facts,
    el('table', { 'aria-label': 'Cell readings' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Entered' }),
          el('th', { scope: 'col', text: 'Lux' }),
          el('th', { scope: 'col', text: 'Counts' }),
        ]),
      ]),
      cellReadings,
    ]),
    sync_.node,
    button('Sync now', () => void sync()),
  ]);
  const bodiesRegion = el('div', { role: 'region', 'aria-label': 'Bodies' }, [
    el('h2', { text: 'Bodies' }),
    button('Place body', () => placeBody(null, document.activeElement as HTMLElement)),
    placementsList,
    freeList,
    button('Issue rig sheet', () => void issue()),
    issueStatus,
    sheetLinkHost,
  ]);

  const sheetBody = el('div', { class: 'sheet-body', hidden: true }, [readingsRegion, bodiesRegion]);
  const disclosure = button('Readings', () => {
    const open = disclosure.getAttribute('aria-expanded') !== 'true';
    disclosure.setAttribute('aria-expanded', String(open));
    sheetBody.hidden = !open;
    if (open && !reducedMotion()) {
      sheetBody.animate([{ transform: 'translateY(1.5rem)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 200,
        easing: 'ease-out',
      });
    }
  });
  disclosure.setAttribute('aria-expanded', 'false');
  const phoneSheet = el('div', { class: 'phone-sheet' }, [
    el('div', { class: 'sheet-line' }, [bandLine, disclosure]),
    sheetBody,
  ]);

  const workArea = el('div', { class: 'workspace' });
  const narrow = window.matchMedia('(max-width: 767px)');
  const arrange = (): void => {
    clear(workArea);
    if (narrow.matches) {
      sheetBody.hidden = disclosure.getAttribute('aria-expanded') !== 'true';
      append(workArea, [wall.region, phoneSheet]);
    } else {
      append(workArea, [wall.region, readingsRegion, bodiesRegion]);
    }
  };
  narrow.addEventListener('change', arrange);

  clear(screen);
  append(screen, [title, staleHost, workArea, stage]);
  arrange();

  const asked = new URL(window.location.href).searchParams.get('cell');
  const known = asked !== null && cellPosition(asked, site.columns, site.rows) !== null ? asked : null;
  wall.settle(known);
  current = known;
  wall.setCells(cells);
  drawSentence();
  drawReadouts();
  drawPlacements();
  if (known !== null) {
    announce(known);
    void drawCellReadings();
  }
  void document.fonts.ready.then(() => {
    wall.setCells(cells);
    drawSentence();
  });

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
    wall.stop();
    narrow.removeEventListener('change', arrange);
  };
}
