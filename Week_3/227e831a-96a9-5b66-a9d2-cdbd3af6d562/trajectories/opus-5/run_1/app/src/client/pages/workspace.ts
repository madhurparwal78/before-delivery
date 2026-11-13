import { CATEGORY_ORDER, type Category } from '../../shared/categories.js';
import type {
  CarryMode,
  Item,
  Line,
  ListSummary,
  PackSheet,
  Share,
  SyncOp,
  SyncResponse,
  TripList,
} from '../../shared/types.js';
import { formatGrams } from '../../shared/weights.js';
import { api, type ApiResult } from '../api.js';
import type { AppContext } from '../app.js';
import { applyQueuedOps, rebuildList, unpackedUnits } from '../derive.js';
import { button, el, focusFirstField, openDialog, prefersReducedMotion, type DialogHandle } from '../dom.js';
import { Strata, type ChipInfo, type StrataMode } from '../strata.js';
import { cache, clearQueue, newOpId, queueOp, queuedOps, saveCache } from '../store.js';

const PACKED_BANNER = 'Packed — weights are frozen. Return to planning to change this list.';
const WALKED_BANNER = 'Walked — this list is kept for history and can\u2019t be changed.';
const SESSION_COPY = 'Your session ended. Sign in to finish this change.';
const SHEET_STALE = 'This pack sheet is out of date. Print again to include your latest changes.';

interface LineRowView {
  row: HTMLElement;
  quantity: HTMLInputElement | null;
  weight: HTMLElement;
  note: HTMLElement;
  marker: HTMLElement;
  radios: Map<CarryMode, HTMLInputElement>;
}

interface AvailableRowView {
  row: HTMLElement;
  left: HTMLElement;
  pack: HTMLButtonElement;
}

type HeldKind = 'line' | 'state' | 'sync';

interface HeldChange {
  kind: HeldKind;
  send: () => Promise<void>;
  focus: () => void;
}

export function mountWorkspace(root: HTMLElement, context: AppContext, listId: string): void {
  let list: TripList = cache.listsById[listId] ?? {
    id: listId,
    name: '',
    state: 'planning',
    lines: [],
    categories: [],
    totals: {
      baseGrams: 0,
      wornGrams: 0,
      consumableGrams: 0,
      skinOutGrams: 0,
      goalGrams: context.profile().goalGrams,
      deltaGrams: context.profile().goalGrams,
      display: { base: '', worn: '', consumable: '', skinOut: '', goal: '', delta: '' },
    },
  };
  let confirmed: TripList = structuredClone(list);
  let sheets: PackSheet[] = [];
  let statePending = false;
  let strataCollapsed = true;
  let signInDialog: DialogHandle | null = null;
  const held: HeldChange[] = [];
  const chains = new Map<string, Promise<void>>();
  const provisional = new Map<string, Array<(lineId: string) => void>>();
  const offlineFrom = new Map<string, number>();
  const lineRows = new Map<string, LineRowView>();
  const availableRows = new Map<string, AvailableRowView>();
  const groupRows = new Map<Category, { row: HTMLElement; heading: HTMLElement }>();

  const heading = el('h1', { tabindex: '-1' });
  const banner = el('p', { class: 'banner' });
  const baseFigure = el('span', { class: 'figure base-figure' });
  const wornFigure = el('span', { class: 'figure' });
  const consumableFigure = el('span', { class: 'figure' });
  const skinOutFigure = el('span', { class: 'figure' });
  const deltaFigure = el('span', { class: 'figure delta' });
  const totals = el('section', { class: 'totals-strip', role: 'region', 'aria-label': 'Pack totals' }, [
    el('div', {}, [el('span', { class: 'label' }, ['Base']), baseFigure]),
    el('div', {}, [el('span', { class: 'label' }, ['Worn']), wornFigure]),
    el('div', {}, [el('span', { class: 'label' }, ['Consumable']), consumableFigure]),
    el('div', {}, [el('span', { class: 'label' }, ['Skin-out']), skinOutFigure]),
    el('div', {}, [deltaFigure]),
  ]);

  const packUpdates = el('div', { class: 'live', role: 'status', 'aria-label': 'Pack updates' });
  const syncResults = el('div', { class: 'live', role: 'status', 'aria-label': 'Sync results' });
  const listState = el('div', { class: 'live', role: 'status', 'aria-label': 'List state' });
  const sheetStatus = el('div', { class: 'live', role: 'status', 'aria-label': 'Pack sheet' });
  const sharing = el('div', { class: 'live', role: 'status', 'aria-label': 'Sharing' });

  const markPacked = button('Mark packed', { class: 'primary' }, () => changeState('packed'));
  const returnPlanning = button('Return to planning', { class: 'secondary' }, () =>
    changeState('planning'),
  );
  const markWalked = button('Mark walked', { class: 'secondary' }, () => changeState('walked'));
  const printSheet = button('Print pack sheet', { class: 'secondary' }, () => print());
  const downloadSheet = el('a', { class: 'download-sheet', download: '' }, ['Download pack sheet']);
  const staleNotice = el('p', { class: 'notice stale' }, [SHEET_STALE]);
  const shareList = button('Share list', { class: 'secondary' }, (event) =>
    openShare(event.currentTarget as HTMLElement),
  );
  const actions = el('div', { class: 'actions' });

  const availableBody = el('tbody');
  const closetZone = el('section', { class: 'zone closet-zone', role: 'region', 'aria-label': 'Closet', tabindex: '-1' }, [
    el('table', { class: 'ledger' }, [el('caption', {}, ['Available gear']), availableBody]),
  ]);
  const packBody = el('tbody');
  const packZone = el('section', { class: 'zone pack-zone', role: 'region', 'aria-label': 'Pack list', tabindex: '-1' }, [
    el('table', { class: 'ledger' }, [el('caption', {}, ['Pack list']), packBody]),
  ]);

  const strata = new Strata();
  const summaryLine = el('p', { class: 'strata-summary' });
  const strataToggle = button('Pack Strata', { class: 'strata-toggle', 'aria-expanded': 'false' }, () => {
    strataCollapsed = !strataCollapsed;
    strataToggle.setAttribute('aria-expanded', strataCollapsed ? 'false' : 'true');
    if (strataCollapsed && strata.region.contains(document.activeElement)) strataToggle.focus();
    strata.setCollapsed(strataCollapsed);
    if (!strataCollapsed) strata.render(list, context.profile(), 'none');
  });
  const strip = el('div', { class: 'strata-strip' }, [strataToggle, summaryLine]);
  const zones = el('div', { class: 'zones' }, [strip, closetZone, packZone, strata.region]);

  strata.setHooks({
    countBase: (from, to, ms) => countBase(from, to, ms),
    setBase: (grams) => {
      baseFigure.textContent = formatGrams(grams, context.profile().unit);
    },
  });

  root.append(
    el('div', { class: 'sheet workspace' }, [
      heading,
      banner,
      totals,
      actions,
      packUpdates,
      syncResults,
      listState,
      sheetStatus,
      sharing,
      zones,
    ]),
  );

  let countToken = 0;
  function countBase(from: number, to: number, ms: number): void {
    const unit = context.profile().unit;
    const token = ++countToken;
    const started = performance.now();
    const step = (now: number): void => {
      if (token !== countToken) return;
      const progress = Math.min((now - started) / ms, 1);
      const value = Math.round(from + (to - from) * progress);
      baseFigure.textContent = formatGrams(progress === 1 ? to : value, unit);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const phone = window.matchMedia('(max-width: 767px)');
  function applyBreakpoint(): void {
    if (phone.matches) {
      if (!zones.contains(strip)) zones.insertBefore(strip, closetZone);
      strata.setCollapsed(strataCollapsed);
    } else {
      strip.remove();
      strata.setCollapsed(false);
    }
    strata.render(list, context.profile(), 'none');
  }
  phone.addEventListener('change', applyBreakpoint);

  function announcePack(): void {
    packUpdates.textContent = `Base weight ${list.totals.display.base}. ${list.totals.display.delta}.`;
  }

  function paintActions(): void {
    const legal: HTMLElement[] = [];
    if (list.state === 'planning') legal.push(markPacked);
    if (list.state === 'packed') legal.push(returnPlanning, markWalked);
    actions.replaceChildren(...legal, printSheet, shareList);
    const newest = sheets[0];
    if (newest !== undefined) {
      downloadSheet.setAttribute('href', newest.url);
      actions.append(downloadSheet);
      if (!newest.current) actions.append(staleNotice);
    }
  }

  function paintHeading(): void {
    heading.textContent = list.name;
    heading.append(el('span', { class: 'state' }, [list.state]));
    banner.textContent =
      list.state === 'packed' ? PACKED_BANNER : list.state === 'walked' ? WALKED_BANNER : '';
    banner.classList.toggle('visible', banner.textContent !== '');
  }

  function lineRow(line: Line): LineRowView {
    const radios = new Map<CarryMode, HTMLInputElement>();
    const cells: HTMLElement[] = [];
    let quantity: HTMLInputElement | null = null;
    const editable = list.state === 'planning';
    const name = el('span', { class: 'line-name' }, [line.name]);
    const note = el('span', { class: 'line-meta' }, [line.carryNote]);
    const marker = el('span', { class: 'marker' }, [line.inCloset ? '' : 'Not in closet']);
    const weight = el('td', { class: 'weight figure' }, [line.weightDisplay]);

    if (editable) {
      const decrease = button('\u2212', { class: 'step', 'aria-label': `Decrease ${line.name}` }, () =>
        setQuantity(line.itemId, currentQuantity(line.itemId) - 1),
      );
      const increase = button('+', { class: 'step', 'aria-label': `Increase ${line.name}` }, () =>
        setQuantity(line.itemId, currentQuantity(line.itemId) + 1),
      );
      quantity = el('input', {
        type: 'number',
        class: 'field figure quantity',
        'aria-label': `Quantity of ${line.name}`,
        min: '1',
        max: String(ownedUnits(line.itemId)),
        value: String(line.quantity),
      });
      quantity.addEventListener('keydown', (event) => {
        const key = event.key;
        if (/^[A-Za-z+=\-]$/.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
        }
      });
      quantity.addEventListener('input', () => {
        const value = Number((quantity as HTMLInputElement).value);
        if (!Number.isFinite(value) || value < 1) return;
        setQuantity(line.itemId, value);
      });
      const modeRadios = (['base', 'worn', 'consumable'] as const).map((mode) => {
        const radio = el('input', {
          type: 'radio',
          name: `mode-${line.id}`,
          class: 'mode-radio',
          'aria-label': mode === 'base' ? 'Base' : mode === 'worn' ? 'Worn' : 'Consumable',
          value: mode,
          checked: line.mode === mode,
        });
        radio.addEventListener('change', () => {
          if (radio.checked) setMode(line.itemId, mode);
        });
        radios.set(mode, radio);
        return el('label', { class: 'mode-label' }, [radio, radio.getAttribute('aria-label') ?? '']);
      });
      const unpack = button('Unpack', { class: 'secondary unpack', 'aria-label': `Unpack ${line.name}` }, () =>
        unpackLine(line.itemId),
      );
      cells.push(
        el('td', { class: 'quantity-cell' }, [decrease, quantity, increase]),
        el('td', {}, [name, note, marker]),
        weight,
        el('td', {}, [
          el('div', { class: 'mode-group', role: 'radiogroup', 'aria-label': `Carry mode for ${line.name}` }, modeRadios),
        ]),
        el('td', {}, [unpack]),
      );
    } else {
      cells.push(
        el('td', { class: 'quantity-cell' }, [String(line.quantity)]),
        el('td', {}, [name, note, marker]),
        weight,
        el('td', {}, []),
        el('td', {}, []),
      );
    }

    const row = el('tr', { class: 'ledger-row line-row', 'data-item': line.itemId }, cells);
    row.addEventListener('keydown', (event) => onRowShortcut(event, line.itemId));
    return { row, quantity, weight, note, marker, radios };
  }

  function onRowShortcut(event: KeyboardEvent, itemId: string): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (list.state !== 'planning') return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'number') return;
    const key = event.key.toLowerCase();
    const line = list.lines.find((candidate) => candidate.itemId === itemId);
    if (line === undefined) return;
    if (key === 'w') {
      event.preventDefault();
      setMode(itemId, line.mode === 'worn' ? 'base' : 'worn');
    } else if (key === 'c') {
      event.preventDefault();
      setMode(itemId, line.mode === 'consumable' ? 'base' : 'consumable');
    } else if (key === 'b') {
      event.preventDefault();
      setMode(itemId, 'base');
    } else if (key === 'u') {
      event.preventDefault();
      unpackLine(itemId);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setQuantity(itemId, line.quantity + 1);
    } else if (event.key === '-') {
      event.preventDefault();
      setQuantity(itemId, line.quantity - 1);
    }
  }

  function availableRow(item: Item): AvailableRowView {
    const left = el('span', { class: 'line-meta left-text' });
    const pack = button('Pack', { class: 'primary pack', 'aria-label': `Pack ${item.name}` }, () =>
      packItem(item.id),
    );
    const row = el('tr', { class: 'ledger-row available-row', 'data-available': item.id }, [
      el('td', {}, [pack]),
      el('td', {}, [
        el('span', { class: 'line-name' }, [item.name]),
        el('span', { class: 'line-meta' }, [item.category]),
        left,
      ]),
      el('td', { class: 'weight figure' }, [item.weightDisplay]),
    ]);
    row.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() !== 'p') return;
      event.preventDefault();
      packItem(item.id);
    });
    return { row, left, pack };
  }

  function paintPackList(): void {
    const unit = context.profile().unit;
    for (const [id, view] of [...lineRows]) {
      if (!list.lines.some((line) => line.id === id)) {
        view.row.remove();
        lineRows.delete(id);
      }
    }
    const desired: HTMLElement[] = [];
    for (const category of CATEGORY_ORDER) {
      const lines = list.lines.filter((line) => line.category === category);
      const group = groupRows.get(category);
      if (lines.length === 0) {
        if (group !== undefined) {
          group.row.remove();
          groupRows.delete(category);
        }
        continue;
      }
      const entry = list.categories.find((candidate) => candidate.category === category);
      const text = `${category} ${formatGrams(entry?.subtotalGrams ?? 0, unit)}`;
      let holder = group;
      if (holder === undefined) {
        const headingNode = el('h3', { class: 'group-heading' }, [text]);
        holder = {
          row: el('tr', { class: 'group-row' }, [
            el('th', { colspan: '5', scope: 'colgroup' }, [headingNode]),
          ]),
          heading: headingNode,
        };
        groupRows.set(category, holder);
      } else {
        holder.heading.textContent = text;
      }
      desired.push(holder.row);
      for (const line of lines) {
        let view = lineRows.get(line.id);
        if (view === undefined) {
          view = lineRow(line);
          lineRows.set(line.id, view);
        }
        updateLineRow(view, line);
        desired.push(view.row);
      }
    }
    desired.forEach((node, index) => {
      const current = packBody.children[index] ?? null;
      if (current !== node) packBody.insertBefore(node, current);
    });
  }

  function updateLineRow(view: LineRowView, line: Line): void {
    if (view.quantity !== null && document.activeElement !== view.quantity) {
      view.quantity.value = String(line.quantity);
    }
    if (view.quantity !== null) view.quantity.max = String(ownedUnits(line.itemId));
    view.weight.textContent = line.weightDisplay;
    view.note.textContent = line.carryNote;
    view.marker.textContent = line.inCloset ? '' : 'Not in closet';
    const radio = view.radios.get(line.mode);
    if (radio !== undefined && !radio.checked) radio.checked = true;
  }

  function paintAvailable(): void {
    if (list.state !== 'planning') {
      availableBody.replaceChildren();
      availableRows.clear();
      return;
    }
    const wanted = cache.items.filter(
      (item) => item.status === 'active' && unpackedUnits(item, list) > 0,
    );
    for (const [id, view] of [...availableRows]) {
      if (!wanted.some((item) => item.id === id)) {
        view.row.remove();
        availableRows.delete(id);
      }
    }
    for (const item of wanted) {
      let view = availableRows.get(item.id);
      if (view === undefined) {
        view = availableRow(item);
        availableRows.set(item.id, view);
        availableBody.append(view.row);
      }
      const left = unpackedUnits(item, list);
      view.left.textContent = left > 0 && left < item.unitsOwned ? `${left} left` : '';
    }
  }

  function paintTotals(mode: StrataMode, chip?: ChipInfo): void {
    const display = list.totals.display;
    wornFigure.textContent = display.worn;
    consumableFigure.textContent = display.consumable;
    skinOutFigure.textContent = display.skinOut;
    deltaFigure.textContent = display.delta;
    deltaFigure.classList.toggle('over-goal', list.totals.baseGrams > list.totals.goalGrams);
    summaryLine.textContent = `Base ${display.base}, ${display.delta}.`;
    if (mode === 'none') baseFigure.textContent = display.base;
    strata.render(list, context.profile(), mode, chip);
  }

  function paint(
    options: {
      mode?: StrataMode;
      chip?: ChipInfo;
      between?: () => void;
      availableFirst?: boolean;
    } = {},
  ): void {
    list = rebuildList(list, cache.items, context.profile());
    cache.listsById[list.id] = list;
    saveCache();
    paintHeading();
    paintActions();
    if (options.availableFirst === true) {
      paintAvailable();
      options.between?.();
      paintPackList();
    } else {
      paintPackList();
      options.between?.();
      paintAvailable();
    }
    paintTotals(options.mode ?? 'none', options.chip);
  }

  function currentQuantity(itemId: string): number {
    return list.lines.find((line) => line.itemId === itemId)?.quantity ?? 0;
  }

  function ownedUnits(itemId: string): number {
    return cache.items.find((item) => item.id === itemId)?.unitsOwned ?? 0;
  }

  function lineOf(itemId: string): Line | undefined {
    return list.lines.find((line) => line.itemId === itemId);
  }

  /** Changes to one line take effect in the order the hiker made them. */
  function inOrder(itemId: string, work: () => Promise<void>): void {
    const previous = chains.get(itemId) ?? Promise.resolve();
    const next = previous.then(work, work);
    chains.set(itemId, next);
  }

  let pendingWork = 0;

  /** A late answer never moves the screen back from the hiker's last input. */
  function adoptServer(serverList: TripList): void {
    confirmed = structuredClone(serverList);
    if (pendingWork > 0) return;
    list = serverList;
  }

  /** Falls back to the last state the server confirmed. */
  function showConfirmed(): void {
    list = structuredClone(confirmed);
    paint();
  }

  async function send(
    itemId: string,
    request: () => Promise<ApiResult<{ list: TripList }>>,
    onRefused: (result: Exclude<ApiResult<{ list: TripList }>, { ok: true }>) => void,
    focusBack: () => void,
  ): Promise<void> {
    pendingWork += 1;
    const result = await request();
    pendingWork -= 1;
    if (result.ok) {
      adoptServer(result.data.list);
      if (pendingWork === 0) paint();
      void refreshSheetCurrency();
      void refreshLists();
      return;
    }
    if (result.status === 401) {
      holdChange('line', async () => {
        await send(itemId, request, onRefused, focusBack);
      }, focusBack);
      return;
    }
    if (result.offline) {
      context.setOffline(true);
      return;
    }
    onRefused(result);
  }

  function queueOffline(op: Omit<SyncOp, 'opId'>): void {
    queueOp({ ...op, opId: newOpId() });
  }

  function packItem(itemId: string): void {
    const item = cache.items.find((candidate) => candidate.id === itemId);
    if (item === undefined) return;
    const existing = lineOf(itemId);
    if (existing !== undefined) {
      setQuantity(itemId, existing.quantity + 1);
      return;
    }
    const fromRect = (availableRows.get(itemId)?.row ?? closetZone).getBoundingClientRect();
    const temporaryId = `pending-${itemId}`;
    list.lines = [
      ...list.lines,
      {
        id: temporaryId,
        itemId,
        name: item.name,
        category: item.category,
        quantity: 1,
        mode: 'base',
        unitWeightGrams: item.weightGrams,
        lineWeightGrams: item.weightGrams,
        baseGrams: item.weightGrams,
        wornGrams: 0,
        consumableGrams: 0,
        carryNote: '',
        weightDisplay: item.weightDisplay,
        inCloset: true,
      },
    ];
    paint({
      mode: 'pack',
      chip: {
        name: item.name,
        weightGrams: item.weightGrams,
        from: fromRect,
        category: item.category,
      },
      between: () => {
        lineRows.get(temporaryId)?.quantity?.focus();
      },
    });
    announcePack();
    if (context.offline()) {
      offlineFrom.set(itemId, 1);
      queueOffline({ listId: list.id, itemId, type: 'pack', quantity: 1, mode: 'base' });
      return;
    }
    provisional.set(itemId, []);
    inOrder(itemId, () => sendPack(item, temporaryId));
  }

  /** Inputs made on a provisional line wait for the id the server issues. */
  async function sendPack(item: Item, temporaryId: string): Promise<void> {
    const itemId = item.id;
    pendingWork += 1;
    const result = await api<{ list: TripList }>('POST', `/api/lists/${list.id}/lines`, {
      body: { itemId },
    });
    pendingWork -= 1;
    if (result.ok) {
      const created = result.data.list.lines.find((line) => line.itemId === itemId);
      const heldInputs = provisional.get(itemId) ?? [];
      provisional.delete(itemId);
      const view = lineRows.get(temporaryId);
      if (created !== undefined && view !== undefined) {
        lineRows.delete(temporaryId);
        lineRows.set(created.id, view);
        const local = lineOf(itemId);
        if (local !== undefined) local.id = created.id;
      }
      adoptServer(result.data.list);
      if (pendingWork === 0 && heldInputs.length === 0) paint();
      for (const followUp of heldInputs) followUp(created?.id ?? temporaryId);
      void refreshSheetCurrency();
      void refreshLists();
      return;
    }
    if (result.status === 401) {
      holdChange(
        'line',
        () => sendPack(item, temporaryId),
        () => {
          const lineId = lineOf(itemId)?.id ?? temporaryId;
          lineRows.get(lineId)?.quantity?.focus();
        },
      );
      return;
    }
    if (result.offline) {
      context.setOffline(true);
      provisional.delete(itemId);
      offlineFrom.set(itemId, 1);
      queueOffline({ listId: list.id, itemId, type: 'pack', quantity: 1, mode: 'base' });
      return;
    }
    provisional.delete(itemId);
    if (result.code === 'item_retired') {
      packUpdates.textContent = `${item.name} is no longer in your closet.`;
      await rereadAfterRefusal('closet');
      return;
    }
    if (result.code === 'list_not_editable') {
      packUpdates.textContent = `${list.name} is ${stateFromMessage(result.message)} on another device and can't be edited.`;
      await rereadAfterRefusal('heading');
      return;
    }
    packUpdates.textContent = Object.values(result.fields)[0] ?? result.message;
    await rereadAfterRefusal('heading');
  }

  /** Sends against the line id the server issued, holding inputs until it has. */
  function withLine(
    itemId: string,
    known: string | null,
    work: (lineId: string) => void,
  ): void {
    const pendingList = provisional.get(itemId);
    if (pendingList !== undefined) {
      pendingList.push(work);
      return;
    }
    const lineId = known ?? lineOf(itemId)?.id;
    if (lineId === undefined) return;
    work(lineId);
  }

  function setQuantity(itemId: string, wanted: number): void {
    const line = lineOf(itemId);
    if (line === undefined) return;
    const owned = ownedUnits(itemId);
    const quantity = Math.max(1, Math.min(wanted, Math.max(owned, 1)));
    if (quantity === line.quantity) return;
    const previous = line.quantity;
    line.quantity = quantity;
    paint({ mode: 'change' });
    announcePack();
    if (context.offline()) {
      const from = offlineFrom.get(itemId) ?? previous;
      offlineFrom.set(itemId, quantity);
      queueOffline({
        listId: list.id,
        itemId,
        type: 'set_quantity',
        quantity,
        fromQuantity: from,
      });
      return;
    }
    const control = document.activeElement as HTMLElement | null;
    withLine(itemId, null, (lineId) => {
      inOrder(itemId, () =>
        send(
          itemId,
          () =>
            api<{ list: TripList }>('PATCH', `/api/lists/${list.id}/lines/${lineId}`, {
              body: { quantity },
            }),
          (result) => void refusedLineWrite(result),
          () => control?.focus(),
        ),
      );
    });
  }

  function setMode(itemId: string, mode: CarryMode): void {
    const line = lineOf(itemId);
    if (line === undefined) return;
    if (line.mode === mode) return;
    line.mode = mode;
    paint({ mode: 'change' });
    announcePack();
    if (context.offline()) {
      queueOffline({ listId: list.id, itemId, type: 'set_mode', mode });
      return;
    }
    const control = document.activeElement as HTMLElement | null;
    withLine(itemId, null, (lineId) => {
      inOrder(itemId, () =>
        send(
          itemId,
          () =>
            api<{ list: TripList }>('PATCH', `/api/lists/${list.id}/lines/${lineId}`, {
              body: { mode },
            }),
          (result) => void refusedLineWrite(result),
          () => control?.focus(),
        ),
      );
    });
  }

  function unpackLine(itemId: string): void {
    const line = lineOf(itemId);
    if (line === undefined) return;
    const item = cache.items.find(
      (candidate) => candidate.id === itemId && candidate.status === 'active',
    );
    const removedLineId = line.id;
    const index = list.lines.indexOf(line);
    const neighbour = list.lines[index + 1] ?? list.lines[index - 1];
    const chipFrom = (availableRows.get(itemId)?.row ?? closetZone).getBoundingClientRect();
    list.lines = list.lines.filter((candidate) => candidate !== line);
    paint({
      mode: 'unpack',
      availableFirst: true,
      chip: {
        name: line.name,
        weightGrams: line.unitWeightGrams,
        from: chipFrom,
        category: line.category,
      },
      between: () => {
        const pack = item === undefined ? undefined : availableRows.get(itemId)?.pack;
        if (pack !== undefined) {
          pack.focus();
          return;
        }
        const next = neighbour === undefined ? undefined : lineRows.get(neighbour.id);
        const unpackButton = next?.row.querySelector<HTMLElement>('button.unpack');
        if (unpackButton !== undefined && unpackButton !== null) unpackButton.focus();
        else packZone.focus();
      },
    });
    announcePack();
    if (context.offline()) {
      offlineFrom.delete(itemId);
      queueOffline({ listId: list.id, itemId, type: 'unpack' });
      return;
    }
    withLine(itemId, removedLineId, (lineId) => {
      inOrder(itemId, () =>
        send(
          itemId,
          () => api<{ list: TripList }>('DELETE', `/api/lists/${list.id}/lines/${lineId}`),
          (result) => void refusedLineWrite(result),
          () => {},
        ),
      );
    });
  }

  function stateFromMessage(message: string): string {
    const match = / is (planning|packed|walked) and can't be edited\.$/.exec(message);
    return match?.[1] ?? 'packed';
  }

  async function refusedLineWrite(result: { code: string; message: string; fields?: Record<string, string> }): Promise<void> {
    if (result.code === 'list_not_editable') {
      packUpdates.textContent = `${list.name} is ${stateFromMessage(result.message)} on another device and can't be edited.`;
      await rereadAfterRefusal('heading');
      return;
    }
    packUpdates.textContent = Object.values(result.fields ?? {})[0] ?? result.message;
    await rereadAfterRefusal('heading');
  }

  /** The losing device shows exactly the server's state. */
  async function rereadAfterRefusal(focus: 'heading' | 'closet' | 'none'): Promise<void> {
    await reload();
    if (focus === 'heading') heading.focus();
    if (focus === 'closet') closetZone.focus();
  }

  async function reload(): Promise<void> {
    const [listResult, closetResult] = await Promise.all([
      api<{ list: TripList }>('GET', `/api/lists/${list.id}`),
      api<{ items: Item[] }>('GET', '/api/closet'),
    ]);
    if (closetResult.ok) cache.items = closetResult.data.items;
    if (listResult.ok) {
      list = listResult.data.list;
      confirmed = structuredClone(list);
      context.setOffline(false);
    } else if (listResult.offline) {
      context.setOffline(true);
    } else if (listResult.status === 404) {
      context.navigate('/trips');
      return;
    } else if (listResult.status === 401) {
      context.signedOut();
      return;
    }
    replayQueue();
    saveCache();
    paint();
    await refreshSheets();
  }

  /** Changes queued on this device stay on screen across reloads. */
  function replayQueue(): void {
    const ops = queuedOps().filter((op) => op.listId === list.id);
    applyQueuedOps(list, cache.items, ops);
    for (const op of ops) {
      if (op.type === 'unpack') offlineFrom.delete(op.itemId);
      else if (op.quantity !== undefined) offlineFrom.set(op.itemId, op.quantity);
    }
  }

  async function refreshLists(): Promise<void> {
    const result = await api<{ lists: ListSummary[] }>('GET', '/api/lists');
    if (result.ok) {
      cache.lists = result.data.lists;
      saveCache();
    }
  }

  async function refreshSheets(): Promise<void> {
    const result = await api<{ sheets: PackSheet[] }>('GET', `/api/lists/${list.id}/pack-sheets`);
    if (result.ok) {
      sheets = result.data.sheets;
      paintActions();
    }
  }

  async function refreshSheetCurrency(): Promise<void> {
    if (sheets.length === 0) return;
    await refreshSheets();
  }

  function changeState(to: 'planning' | 'packed' | 'walked'): void {
    if (statePending) return;
    statePending = true;
    void api<{ list: TripList }>('POST', `/api/lists/${list.id}/state`, { body: { to } }).then(
      async (result) => {
        statePending = false;
        if (result.ok) {
          list = result.data.list;
          confirmed = structuredClone(list);
          lineRows.clear();
          packBody.replaceChildren();
          groupRows.clear();
          listState.textContent =
            to === 'packed'
              ? 'List marked packed.'
              : to === 'planning'
                ? 'List returned to planning.'
                : 'List marked walked.';
          paint();
          heading.focus();
          void refreshSheetCurrency();
          void refreshLists();
          return;
        }
        if (result.status === 401) {
          holdChange('state', async () => {
            changeState(to);
          }, () => heading.focus());
          return;
        }
        if (result.offline) {
          context.setOffline(true);
          return;
        }
        if (result.code === 'lines_not_in_closet') {
          listState.textContent =
            'Some lines are not in your closet. Unpack them before marking this list packed.';
        } else if (result.code === 'empty_list') {
          listState.textContent = 'Add at least one item before marking this list packed.';
        } else {
          listState.textContent = result.message;
        }
        lineRows.clear();
        packBody.replaceChildren();
        groupRows.clear();
        await reload();
        heading.focus();
      },
    );
  }

  function print(): void {
    sheetStatus.textContent = 'Rendering pack sheet...';
    void api<{ sheet: PackSheet }>('POST', `/api/lists/${list.id}/pack-sheets`, { body: {} }).then(
      async (result) => {
        if (result.ok) {
          sheetStatus.textContent = 'Pack sheet ready.';
          sheets = [result.data.sheet, ...sheets];
          paintActions();
          return;
        }
        if (result.status === 401) {
          context.signedOut();
          return;
        }
        if (result.offline || result.status === 503) {
          sheetStatus.textContent =
            "Pack sheets can't be printed right now. Your list is unchanged; try again later.";
          return;
        }
        sheetStatus.textContent = result.message;
      },
    );
  }

  function openShare(opener: HTMLElement): void {
    const handle = openDialog({ name: 'Share list', opener });
    const expires = el('input', { type: 'date', id: 'share-expires', class: 'field' });
    const linkField = el('input', { type: 'text', id: 'share-link', class: 'field', readonly: true, 'aria-label': 'Share link' });
    const expired = el('p', { class: 'notice expired' });
    const create = button('Create link', { class: 'primary' }, () => {
      const body = expires.value === '' ? {} : { expiresOn: expires.value };
      void api<{ share: Share }>('POST', `/api/lists/${list.id}/share`, { body }).then((result) => {
        if (result.ok) {
          show(result.data.share);
          sharing.textContent = 'Share link created.';
          return;
        }
        expired.textContent = Object.values(result.fields)[0] ?? result.message;
      });
    });
    const copy = button('Copy link', { class: 'secondary' }, () => {
      void navigator.clipboard?.writeText(linkField.value);
    });
    const revoke = button('Revoke link', { class: 'secondary' }, () => {
      void api('DELETE', `/api/lists/${list.id}/share`).then(() => {
        linkField.value = '';
        expired.textContent = '';
        create.textContent = 'Create link';
        sharing.textContent = 'Share link revoked.';
      });
    });
    const close = button('Close', { class: 'secondary' }, () => {
      handle.close();
    });

    function show(share: Share | null): void {
      if (share === null) {
        linkField.value = '';
        create.textContent = 'Create link';
        expired.textContent = '';
        return;
      }
      linkField.value = `${window.location.origin}${share.url}`;
      create.textContent = 'Create new link';
      expired.textContent = share.expired
        ? `This link expired on ${share.expiresOn}. Create a new link to share again.`
        : '';
      if (share.expiresOn !== null) expires.value = share.expiresOn;
    }

    handle.body.append(
      el('div', { class: 'gear-form' }, [
        el('div', { class: 'form-row' }, [
          el('label', { for: 'share-expires' }, ['Expires on']),
          expires,
        ]),
        expired,
        el('div', { class: 'form-row' }, [
          el('label', { for: 'share-link' }, ['Share link']),
          linkField,
        ]),
        el('div', { class: 'form-actions' }, [create, copy, revoke, close]),
      ]),
    );
    void api<{ share: Share | null }>('GET', `/api/lists/${list.id}/share`).then((result) => {
      if (result.ok) show(result.data.share);
    });
    focusFirstField(handle);
  }

  /** A change that found the session ended waits for the next sign-in. */
  function holdChange(kind: HeldKind, resend: () => Promise<void>, focus: () => void): void {
    held.push({ kind, send: resend, focus });
    if (kind !== 'sync') showConfirmed();
    if (signInDialog !== null) return;
    const opener = document.activeElement as HTMLElement | null;
    const handle = openDialog({
      name: 'Sign in again',
      opener,
      onCancel: () => cancelHeld(),
    });
    signInDialog = handle;
    const passphrase = el('input', { type: 'password', id: 'again-passphrase', class: 'field' });
    const error = el('p', { class: 'field-error' });
    const form = el('form', { class: 'gear-form' }, [
      el('p', { class: 'notice' }, [SESSION_COPY]),
      el('div', { class: 'form-row' }, [
        el('label', { for: 'again-passphrase' }, ['Passphrase']),
        passphrase,
        error,
      ]),
      el('div', { class: 'form-actions' }, [
        el('button', { type: 'submit', class: 'primary' }, ['Sign in']),
        button('Cancel', { class: 'secondary' }, () => {
          handle.close({ restoreFocus: false });
          signInDialog = null;
          cancelHeld();
        }),
      ]),
    ]);
    handle.body.append(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void api('POST', '/api/session', { body: { passphrase: passphrase.value } }).then(
        async (result) => {
          if (!result.ok) {
            error.textContent = "That passphrase didn't match.";
            return;
          }
          handle.close({ restoreFocus: false });
          signInDialog = null;
          const pending = held.splice(0, held.length);
          for (const change of pending) await change.send();
          pending[pending.length - 1]?.focus();
        },
      );
    });
    focusFirstField(handle);
  }

  function cancelHeld(): void {
    const pending = held.splice(0, held.length);
    signInDialog = null;
    showConfirmed();
    packUpdates.textContent = 'Change not saved. Sign in to keep packing.';
    pending[pending.length - 1]?.focus();
  }

  /** Queued offline changes replay in order, each applied once or refused. */
  async function runSync(): Promise<void> {
    const ops = queuedOps();
    if (ops.length === 0) return;
    const result = await api<SyncResponse>('POST', '/api/sync', { body: { ops } });
    if (!result.ok) {
      if (result.status === 401) {
        holdChange('sync', async () => {
          await runSync();
        }, () => heading.focus());
        return;
      }
      return;
    }
    clearQueue();
    offlineFrom.clear();
    const applied = result.data.results.filter((entry) => entry.result === 'applied').length;
    const sentences = result.data.results
      .map((entry, index) => {
        if (entry.result === 'applied') return null;
        const op = ops[index] as SyncOp;
        const item = cache.items.find((candidate) => candidate.id === op.itemId);
        const name = item?.name ?? list.name;
        if (entry.reason === 'item_retired') {
          return `Not synced: ${name} is no longer in your closet.`;
        }
        if (entry.reason === 'quantity_exceeds_owned') {
          return `Not synced: you own only ${item?.unitsOwned ?? 0} of ${name}.`;
        }
        if (entry.reason === 'list_not_editable') {
          return `Not synced: ${list.name} is ${list.state} and can't be edited.`;
        }
        if (entry.reason === 'line_changed') {
          return `Not synced: ${name} was changed on another device.`;
        }
        return `Not synced: ${name} had already changed.`;
      })
      .filter((sentence): sentence is string => sentence !== null);
    syncResults.textContent = [
      `Back online. Synced ${applied} of ${ops.length} changes.`,
      ...sentences,
    ].join(' ');
    await reload();
  }

  context.onReconnect(() => {
    void runSync();
  });

  applyBreakpoint();
  replayQueue();
  paint();
  void reload().then(() => {
    if (!context.offline()) void runSync();
  });
  if (prefersReducedMotion()) root.classList.add('reduced-motion');
}
