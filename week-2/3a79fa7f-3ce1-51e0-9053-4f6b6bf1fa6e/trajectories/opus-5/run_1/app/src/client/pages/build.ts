import { get, post } from '../api.js';
import { clear, el, formatCents, svgIcon, uniqueId } from '../dom.js';
import { openCartDrawer } from '../shell.js';
import { loadCatalog, setCart } from '../store.js';
import { announce, countTo, gauge, updateGauge } from '../ui.js';
import { createViewer, parseViewParam, viewParamString, type CameraPreset, type ViewerHandle } from '../viewer/index.js';
import type { Build, Cart, Catalog, ComponentItem, SlotName } from '../types.js';

const SLOT_LABELS: { slot: SlotName; label: string }[] = [
  { slot: 'wing', label: 'Wing' },
  { slot: 'mast', label: 'Mast' },
  { slot: 'propulsion', label: 'Propulsion' },
  { slot: 'battery', label: 'Battery' },
  { slot: 'controller', label: 'Controller' },
];

interface Picks {
  board_sku: string;
  wing: string;
  mast: string;
  propulsion: string;
  battery: string;
  controller: string;
  spares: number;
  rider_kg: number;
  gear: number;
}

function boardNameOf(catalog: Catalog, sku: string): string {
  return catalog.boards.find((board) => board.sku === sku)?.name ?? sku;
}

function boardFamily(catalog: Catalog, sku: string): string {
  return boardNameOf(catalog, sku).split(' ')[0] ?? '';
}

function defaultPicks(catalog: Catalog, boardSku: string, riderKg: number, gear: number): Picks {
  const board = catalog.boards.find((item) => item.sku === boardSku) ?? catalog.boards[0]!;
  return {
    board_sku: board.sku,
    wing: board.defaults.wing,
    mast: board.defaults.mast,
    propulsion: board.defaults.propulsion,
    battery: board.defaults.battery,
    controller: board.defaults.controller,
    spares: 0,
    rider_kg: riderKg,
    gear,
  };
}

/** A sold-out size cannot be chosen, so a stale address falls back to a size that can ship. */
function inStockBoardSku(catalog: Catalog, wanted: string): string {
  const asked = catalog.boards.find((board) => board.sku === wanted);
  if (asked?.in_stock) return asked.sku;
  const family = asked?.name.split(' ')[0];
  const sameFamily = catalog.boards.find((board) => board.in_stock && board.name.startsWith(`${family} `));
  return sameFamily?.sku ?? catalog.boards.find((board) => board.in_stock)?.sku ?? wanted;
}

function picksFromAddress(catalog: Catalog): Picks {
  const params = new URLSearchParams(window.location.search);
  const asked = catalog.boards.some((board) => board.sku === params.get('board'))
    ? (params.get('board') as string)
    : 'DR-49';
  const boardSku = inStockBoardSku(catalog, asked);
  const riderRaw = Number(params.get('rider'));
  const gearRaw = Number(params.get('gear'));
  const riderKg = Number.isInteger(riderRaw) && riderRaw >= 50 && riderRaw <= 120 && riderRaw % 5 === 0 ? riderRaw : 80;
  const gear = Number.isInteger(gearRaw) && gearRaw >= 1 && gearRaw <= 10 ? gearRaw : 5;
  const picks = defaultPicks(catalog, boardSku, riderKg, gear);
  for (const { slot } of SLOT_LABELS) {
    const wanted = params.get(slot);
    const part = catalog.components.find((item) => item.sku === wanted && item.slot === slot);
    if (part && part.fits.includes(boardFamily(catalog, boardSku))) picks[slot] = part.sku;
  }
  const spares = Number(params.get('spares'));
  if (spares === 0 || spares === 1 || spares === 2) picks.spares = spares;
  return picks;
}

function picksFromBuild(build: Build): Picks {
  return {
    board_sku: build.board_sku,
    wing: build.slots.wing.sku,
    mast: build.slots.mast.sku,
    propulsion: build.slots.propulsion.sku,
    battery: build.slots.battery.sku,
    controller: build.slots.controller.sku,
    spares: build.spares,
    rider_kg: build.rider_kg,
    gear: build.gear,
  };
}

function slotDelta(catalog: Catalog, boardSku: string, slot: SlotName, sku: string): number {
  const board = catalog.boards.find((item) => item.sku === boardSku);
  const chosen = catalog.components.find((item) => item.sku === sku);
  const fallback = catalog.components.find((item) => item.sku === board?.defaults[slot]);
  if (!chosen || !fallback) return 0;
  return Math.max(0, chosen.price_cents - fallback.price_cents);
}

export async function renderBuild(main: HTMLElement): Promise<void> {
  const catalog = await loadCatalog();
  const savedCode = window.location.pathname.startsWith('/build/')
    ? decodeURIComponent(window.location.pathname.slice('/build/'.length))
    : null;

  let picks: Picks;
  if (savedCode) {
    const result = await get<Build>(`/api/builds/${encodeURIComponent(savedCode)}`);
    if (!result.ok) {
      main.replaceChildren(
        el('section', { class: 'band wrap stack' }, [
          el('h1', {}, 'We could not find that build.'),
          el('a', { href: '/build', class: 'btn' }, 'Start a new build'),
        ]),
      );
      return;
    }
    picks = picksFromBuild(result.body);
  } else {
    picks = picksFromAddress(catalog);
  }

  let addressCode: string | null = savedCode;
  let requestToken = 0;
  let shownRideMin = 0;
  let firstPaint = true;

  const viewer: ViewerHandle = createViewer({
    catalog,
    withControls: true,
    onViewSettled: (preset, pose) => writeAddress(preset, pose),
  });

  const totalNode = el('p', { class: 'summary-total' }, 'Build total');
  const financingNode = el('p', { class: 'financing-line' });
  const rideNumber = el('span', { 'data-ride-min': '0' }, 'Up to 0 min');
  const gaugeNode = gauge(1);
  const rideRow = el('p', { class: 'ride-readout' }, [rideNumber, gaugeNode]);
  const partLines = el('div', { class: 'stack' });
  const sparesLine = el('p', { style: 'margin:0' }, 'Spares: 0');
  const advisorLink = el('a', { href: '/callback' }, 'Talk to an advisor about this build');
  const advisorWrapper = el('p', { hidden: true }, advisorLink);

  const saveButton = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Save build');
  const addButton = el('button', { class: 'btn', type: 'button' }, 'Add to cart');
  const copyButton = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Copy link');
  const alert = el('div', { class: 'alert-region', role: 'alert' });

  const summary = el('section', { class: 'summary-panel', role: 'region', 'aria-label': 'Build summary' }, [
    alert,
    totalNode,
    financingNode,
    rideRow,
    partLines,
    sparesLine,
    advisorWrapper,
    el('div', { class: 'summary-actions' }, [saveButton, addButton, copyButton]),
  ]);

  const stickyTotal = el('span', {}, '');
  const stickyRide = el('span', { class: 'caption' }, '');
  const stickyAdd = el('button', { class: 'btn btn-small', type: 'button', 'aria-hidden': 'true', tabindex: '-1' }, 'Add to cart');
  stickyAdd.addEventListener('click', () => addButton.click());
  const sticky = el('div', { class: 'sticky-summary' }, [el('span', { class: 'stack' }, [stickyTotal, stickyRide]), stickyAdd]);

  const optionsColumn = el('div', { class: 'build-options' });
  const page = el('section', { class: 'band wrap build-page' }, [
    el('h1', {}, 'Build your board'),
    el('div', { class: 'build-layout' }, [
      optionsColumn,
      el('div', { class: 'build-viewer-column' }, [viewer.shell, summary]),
    ]),
    sticky,
  ]);
  main.replaceChildren(page);

  function writeAddress(preset: CameraPreset, pose: { yaw: number; pitch: number; distance: number }): void {
    const viewPart = viewParamString(preset, pose);
    if (addressCode) {
      window.history.replaceState({}, '', `/build/${addressCode}?${viewPart}`);
      return;
    }
    const params = new URLSearchParams({
      board: picks.board_sku,
      wing: picks.wing,
      mast: picks.mast,
      propulsion: picks.propulsion,
      battery: picks.battery,
      controller: picks.controller,
      spares: String(picks.spares),
      rider: String(picks.rider_kg),
      gear: String(picks.gear),
    });
    window.history.replaceState({}, '', `/build?${params.toString()}&${viewPart}`);
  }

  function refreshAddress(): void {
    const { preset, pose } = viewer.currentView();
    writeAddress(preset, pose);
  }

  function paintSummary(next: Build, animateSwap: boolean): void {
    totalNode.textContent = `Build total ${formatCents(next.total_cents)}`;
    stickyTotal.textContent = formatCents(next.total_cents);
    if (next.financing.length === 0) {
      financingNode.textContent = '';
      financingNode.removeAttribute('data-monthly-cents');
    } else {
      const monthly = Math.min(...next.financing.map((term) => term.monthly_cents));
      financingNode.textContent = `As low as ${formatCents(monthly)}/mo`;
      financingNode.setAttribute('data-monthly-cents', String(monthly));
    }

    rideNumber.setAttribute('data-ride-min', String(next.total_ride_min));
    stickyRide.textContent = `Up to ${next.total_ride_min} min`;
    viewer.setBuild(next, animateSwap);
    if (firstPaint) {
      firstPaint = false;
      shownRideMin = next.total_ride_min;
    }
    countTo(
      rideNumber,
      shownRideMin,
      next.total_ride_min,
      (value) => `Up to ${value} min`,
      () => {
        shownRideMin = next.total_ride_min;
        updateGauge(gaugeNode, next.battery_bars);
        viewer.setBatteryFill(next.battery_bars);
      },
    );

    clear(partLines);
    for (const { slot, label } of SLOT_LABELS) {
      partLines.appendChild(el('p', { style: 'margin:0' }, `${label}: ${next.slots[slot].name}`));
    }
    sparesLine.textContent = `Spares: ${next.spares}`;
    announce(`Build total ${formatCents(next.total_cents)}, up to ${next.total_ride_min} min.`);
  }

  async function requote(animateSwap: boolean): Promise<void> {
    const mine = ++requestToken;
    const result = await post<Build>('/api/builds/quote', picks);
    if (mine !== requestToken) return;
    if (!result.ok) {
      const body = result.body as unknown as { message: string; fields?: Record<string, string> };
      alert.textContent = body.message;
      return;
    }
    alert.textContent = '';
    paintSummary(result.body, animateSwap);
    refreshAddress();
  }

  function onChange(animateSwap: boolean): void {
    addressCode = null;
    advisorWrapper.hidden = true;
    void requote(animateSwap);
  }

  function boardGroup(): HTMLElement {
    const groupName = uniqueId('board');
    const options = catalog.boards.map((board) => {
      const id = uniqueId('board-option');
      const noteId = `${id}-note`;
      const soldOut = !board.in_stock;
      const input = el('input', {
        type: 'radio',
        name: groupName,
        id,
        value: board.sku,
        checked: board.sku === picks.board_sku,
        disabled: soldOut,
        'aria-describedby': soldOut ? noteId : null,
      });
      input.addEventListener('change', () => {
        picks = defaultPicks(catalog, board.sku, picks.rider_kg, picks.gear);
        paintOptions();
        onChange(true);
      });
      return el('div', { class: `option${board.sku === picks.board_sku ? ' option-selected' : ''}${soldOut ? ' option-disabled' : ''}` }, [
        input,
        el('label', { for: id, class: 'option-body' }, [
          el('span', { class: 'option-name' }, [
            board.sku === picks.board_sku ? svgIcon('tick') : null,
            soldOut ? svgIcon('notAllowed') : null,
            el('span', {}, board.name),
          ]),
          el('span', { class: 'option-note', id: noteId }, soldOut ? 'Out of Stock' : formatCents(board.price_cents)),
        ]),
      ]);
    });
    return el('fieldset', {}, [el('legend', {}, 'Board'), el('div', { role: 'radiogroup', 'aria-label': 'Board' }, options)]);
  }

  function slotGroup(slot: SlotName, label: string): HTMLElement {
    const groupName = uniqueId(slot);
    const family = boardFamily(catalog, picks.board_sku);
    const board = catalog.boards.find((item) => item.sku === picks.board_sku);
    const parts = catalog.components.filter((item: ComponentItem) => item.slot === slot);
    const options = parts.map((part) => {
      const id = uniqueId(`${slot}-option`);
      const noteId = `${id}-note`;
      const fits = part.fits.includes(family);
      const chosen = picks[slot] === part.sku;
      const isDefault = board?.defaults[slot] === part.sku;
      const delta = slotDelta(catalog, picks.board_sku, slot, part.sku);
      const note = !fits
        ? `Not compatible with ${family}`
        : isDefault
          ? 'Included'
          : `+${formatCents(delta)}`;
      const input = el('input', {
        type: 'radio',
        name: groupName,
        id,
        value: part.sku,
        checked: chosen,
        disabled: !fits,
        'aria-describedby': noteId,
      });
      input.addEventListener('change', () => {
        picks[slot] = part.sku;
        paintOptions();
        onChange(true);
      });
      const wrapper = el('div', { class: `option${chosen ? ' option-selected' : ''}${fits ? '' : ' option-disabled'}` }, [
        input,
        el('label', { for: id, class: 'option-body' }, [
          el('span', { class: 'option-name' }, [
            chosen ? svgIcon('tick') : null,
            fits ? null : svgIcon('notAllowed'),
            el('span', {}, part.name),
          ]),
          el('span', { class: 'option-note', id: noteId }, note),
        ]),
      ]);
      if (!fits) {
        const ghostOn = (): void => viewer.setGhost(part.sku);
        const ghostOff = (): void => viewer.setGhost(null);
        wrapper.addEventListener('mouseenter', ghostOn);
        wrapper.addEventListener('mouseleave', ghostOff);
        input.addEventListener('focus', ghostOn);
        input.addEventListener('blur', ghostOff);
      }
      return wrapper;
    });
    return el('fieldset', {}, [el('legend', {}, label), el('div', { role: 'radiogroup', 'aria-label': label }, options)]);
  }

  function sparesGroup(): HTMLElement {
    const groupName = uniqueId('spares');
    const options = [0, 1, 2].map((count) => {
      const id = uniqueId('spares-option');
      const input = el('input', {
        type: 'radio',
        name: groupName,
        id,
        value: String(count),
        checked: picks.spares === count,
      });
      input.addEventListener('change', () => {
        picks.spares = count;
        paintOptions();
        onChange(false);
      });
      return el('div', { class: `option${picks.spares === count ? ' option-selected' : ''}` }, [
        input,
        el('label', { for: id, class: 'option-body' }, el('span', { class: 'option-name' }, [
          picks.spares === count ? svgIcon('tick') : null,
          el('span', {}, String(count)),
        ])),
      ]);
    });
    return el('fieldset', {}, [
      el('legend', {}, 'Spare batteries'),
      el('div', { role: 'radiogroup', 'aria-label': 'Spare batteries' }, options),
    ]);
  }

  function slider(label: string, min: number, max: number, step: number, value: number, text: (value: number) => string, onInput: (value: number) => void): HTMLElement {
    const readout = el('span', { class: 'slider-value' }, text(value));
    const id = uniqueId('slider');
    const input = el('input', {
      type: 'range',
      id,
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      'aria-label': label,
      'aria-valuetext': text(value),
    });
    input.addEventListener('input', () => {
      const next = Number(input.value);
      readout.textContent = text(next);
      input.setAttribute('aria-valuetext', text(next));
      onInput(next);
    });
    return el('div', { class: 'field' }, [
      el('label', { for: id }, label),
      el('div', { class: 'slider-row' }, [input, readout]),
    ]);
  }

  function paintOptions(): void {
    clear(optionsColumn);
    optionsColumn.append(
      boardGroup(),
      ...SLOT_LABELS.map(({ slot, label }) => slotGroup(slot, label)),
      sparesGroup(),
      slider('Rider weight', 50, 120, 5, picks.rider_kg, (value) => `${value} kg`, (value) => {
        picks.rider_kg = value;
        onChange(false);
      }),
      slider('Speed gear', 1, 10, 1, picks.gear, (value) => `Gear ${value}`, (value) => {
        picks.gear = value;
        onChange(false);
      }),
    );
  }

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    const result = await post<Build>('/api/builds', picks);
    saveButton.disabled = false;
    saveButton.textContent = 'Save build';
    if (!result.ok) {
      const body = result.body as unknown as { message: string };
      alert.textContent = body.message;
      return;
    }
    addressCode = result.body.code;
    advisorWrapper.hidden = false;
    const { preset, pose } = viewer.currentView();
    const viewPart = viewParamString(preset, pose);
    advisorLink.href = `/callback?build=${addressCode}&${viewPart}`;
    window.history.pushState({}, '', `/build/${addressCode}?${viewPart}`);
    announce('Build saved.');
  });

  addButton.addEventListener('click', async () => {
    alert.textContent = '';
    addButton.disabled = true;
    addButton.textContent = 'Adding...';
    const saved = await post<Build>('/api/builds', picks);
    if (!saved.ok) {
      addButton.disabled = false;
      addButton.textContent = 'Add to cart';
      alert.textContent = (saved.body as unknown as { message: string }).message;
      return;
    }
    const result = await post<Cart>('/api/cart/lines', { type: 'build', code: saved.body.code, quantity: 1 });
    addButton.disabled = false;
    addButton.textContent = 'Add to cart';
    if (!result.ok) {
      alert.textContent = (result.body as unknown as { message: string }).message;
      return;
    }
    setCart(result.body);
    openCartDrawer(`${saved.body.board_name} build ${saved.body.code}`, addButton);
  });

  copyButton.addEventListener('click', async () => {
    const address = window.location.href;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      /* the address stays in the bar when the clipboard is unavailable */
    }
    announce('Link copied.');
  });

  paintOptions();
  if (savedCode) {
    addressCode = savedCode;
    advisorWrapper.hidden = false;
  }
  viewer.applyViewParam(parseViewParam(new URLSearchParams(window.location.search)));
  await requote(false);
  if (addressCode) {
    const { preset, pose } = viewer.currentView();
    advisorLink.href = `/callback?build=${addressCode}&${viewParamString(preset, pose)}`;
  }
}
