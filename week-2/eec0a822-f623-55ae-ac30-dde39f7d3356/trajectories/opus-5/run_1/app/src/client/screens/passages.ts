import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import {
  createMessageBox,
  FieldSet,
  handOffMessage,
  takeHandOffMessage,
  withPending,
} from '../lib/forms.js';
import { announcePassage } from '../lib/live.js';
import { easePath, setRollingFigure } from '../lib/motion.js';
import { link, navigate, type RouteContext } from '../lib/router.js';
import { createStrip, isWide } from '../lib/strip.js';
import {
  button,
  combobox,
  dataTable,
  listItem,
  quietButton,
  spinbutton,
  stripList,
  textbox,
} from '../lib/views.js';
import { formatInstant, MESSAGES } from '../../shared/copy.js';
import { formatChargePct, formatDistance, formatSpeed } from '../../shared/format.js';
import { can } from '../../shared/roles.js';
import type { Anchorage, Passage, PassageLeg, YachtProfile } from '../lib/types.js';

const RESERVE_PCT = 20;
const MIN_SPEED = 4;
const MAX_SPEED = 12;

interface LegDraft {
  toAnchorageId: string;
  speedKn: number;
}

interface EnergyInputs {
  readonly batteryKwh: number;
  readonly hotelKw: number;
  readonly solarKw: number;
  readonly dragKwPerKnCubed: number;
}

function haversineNm(from: Anchorage, to: Anchorage): number {
  const radians = Math.PI / 180;
  const lat1 = from.latitude * radians;
  const lat2 = to.latitude * radians;
  const dLat = lat2 - lat1;
  const dLon = (to.longitude - from.longitude) * radians;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Mirrors the server's passage energy rule so figures match once saved. */
function computeLegs(options: {
  readonly yacht: EnergyInputs;
  readonly anchorages: ReadonlyMap<string, Anchorage>;
  readonly startAnchorageId: string;
  readonly departsAt: Date;
  readonly startChargePct: number;
  readonly legs: readonly LegDraft[];
}): PassageLeg[] {
  let fromId = options.startAnchorageId;
  let departsAt = options.departsAt;
  let charge = (options.startChargePct / 100) * options.yacht.batteryKwh;
  const computed: PassageLeg[] = [];
  for (const [index, leg] of options.legs.entries()) {
    const from = options.anchorages.get(fromId);
    const to = options.anchorages.get(leg.toAnchorageId);
    if (from === undefined || to === undefined) continue;
    const distanceNm = haversineNm(from, to);
    const hours = distanceNm / leg.speedKn;
    const draw =
      options.yacht.dragKwPerKnCubed * leg.speedKn ** 3 +
      options.yacht.hotelKw -
      options.yacht.solarKw;
    charge = Math.min(options.yacht.batteryKwh, Math.max(0, charge - draw * hours));
    const arrivesAt = new Date(
      Math.round((departsAt.getTime() + hours * 3_600_000) / 1000) * 1000,
    );
    const percent = Math.floor(
      Math.round((charge / options.yacht.batteryKwh) * 100 * 1_000_000) / 1_000_000,
    );
    computed.push({
      index,
      fromAnchorageId: fromId,
      toAnchorageId: leg.toAnchorageId,
      speedKn: leg.speedKn,
      distanceNm,
      departsAt: `${departsAt.toISOString().slice(0, 19)}Z`,
      arrivesAt: `${arrivesAt.toISOString().slice(0, 19)}Z`,
      arrivalBase: to.base,
      arrivalChargePct: percent,
      reserve: percent < RESERVE_PCT ? 'below_reserve' : 'ok',
    });
    fromId = leg.toAnchorageId;
    departsAt = arrivesAt;
  }
  return computed;
}

export async function passagesScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Passages');
  if (page === null) return;
  const table = dataTable('Passages', ['Passage', 'Yacht', 'Departs', 'Status'], 'No passages yet.');
  const actions = el('p', { class: 'card-links' });
  if (can(page.member.role, 'passages_write')) {
    actions.appendChild(link('New passage', `/w/${workspaceSlug}/passages/new`));
  }
  page.main.append(actions, table.section);
  const yachtFilter = context.query.get('yacht');
  const result = await api.get<{ passages: readonly Passage[] }>(
    `/api/w/${workspaceSlug}/passages${yachtFilter === null ? '' : `?yachtSlug=${encodeURIComponent(yachtFilter)}`}`,
  );
  if (!result.ok) return;
  table.setRows(
    result.data.passages.map((passage) => [
      link(passage.name, `/w/${workspaceSlug}/passages/${passage.id}`),
      passage.yachtSlug,
      formatInstant(passage.departsAt, passage.base),
      passage.status === 'sent' ? 'Sent' : 'Draft',
    ]),
  );
}

export async function newPassageScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'New passage');
  if (page === null) return;
  const [yachtsResult, anchoragesResult] = await Promise.all([
    api.get<{ yachts: readonly YachtProfile[] }>(`/api/w/${workspaceSlug}/yachts`),
    api.get<{ anchorages: readonly Anchorage[] }>(`/api/w/${workspaceSlug}/anchorages`),
  ]);
  if (!yachtsResult.ok || !anchoragesResult.ok) return;
  const yachts = [...yachtsResult.data.yachts].sort((left, right) =>
    left.name < right.name ? -1 : 1,
  );
  const anchorages = anchoragesResult.data.anchorages;
  const fields = new FieldSet();
  const messages = createMessageBox();
  const yacht = combobox(
    'Yacht',
    yachts.map((entry) => ({ value: entry.slug, label: entry.name })),
    yachts[0]?.slug,
  );
  const name = textbox('Passage name');
  const departureDate = textbox('Departure date');
  const departureTime = textbox('Departure time');
  const startCharge = spinbutton('Starting charge', 100, 0, 100);
  const startAnchorage = combobox(
    'Start anchorage',
    anchorages.map((anchorage) => ({ value: anchorage.id, label: anchorage.name })),
  );
  const baseAnchorage = (slug: string): string => {
    const found = yachts.find((entry) => entry.slug === slug);
    return found?.base === 'lavrio' ? 'lavrio-base' : 'split-base';
  };
  startAnchorage.value = baseAnchorage(yacht.value);
  yacht.addEventListener('change', () => {
    startAnchorage.value = baseAnchorage(yacht.value);
  });
  const create = button('Create passage');
  create.addEventListener('click', () => {
    void withPending(create, 'Creating passage', async () => {
      const result = await api.post<{ passage: Passage }>(`/api/w/${workspaceSlug}/passages`, {
        yachtSlug: yacht.value,
        name: name.value,
        startAnchorageId: startAnchorage.value,
        departureDate: departureDate.value,
        departureTime: departureTime.value,
        startChargePct: Number(startCharge.value),
        legs: [],
      });
      if (result.ok) {
        handOffMessage(MESSAGES.passageCreated);
        navigate(`/w/${workspaceSlug}/passages/${result.data.passage.id}`);
        return;
      }
      const body = failure(result);
      if (body.errors !== undefined) {
        fields.showErrors(body.errors)?.focus();
        return;
      }
      if (!handleAccessFailure(result, messages)) messages.show(MESSAGES.unexpected, 'problem');
    });
  });
  page.main.append(
    el(
      'form',
      { class: 'narrow-form', novalidate: true, onsubmit: (event: Event) => event.preventDefault() },
      fields.problems,
      fields.field('yachtSlug', 'Yacht', yacht),
      fields.field('name', 'Passage name', name),
      fields.field('departureDate', 'Departure date', departureDate, 'YYYY-MM-DD'),
      fields.field('departureTime', 'Departure time', departureTime, 'HH:MM, the yacht\u2019s base time'),
      fields.field('startChargePct', 'Starting charge', startCharge),
      fields.field('startAnchorageId', 'Start anchorage', startAnchorage),
      messages.node,
      create,
    ),
  );
}

export async function passageDetailScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const workspaceSlug = context.params.ws;
  const passageId = context.params.passageId;
  const first = await api.get<{ passage: Passage }>(
    `/api/w/${workspaceSlug}/passages/${passageId}`,
  );
  if (!first.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  const passage = first.data.passage;
  const page = await staffPage(host, workspaceSlug, passage.name);
  if (page === null) return;
  const editable = can(page.member.role, 'passages_write');
  const [anchoragesResult, yachtResult] = await Promise.all([
    api.get<{ anchorages: readonly Anchorage[] }>(`/api/w/${workspaceSlug}/anchorages`),
    api.get<{ yacht: YachtProfile }>(`/api/w/${workspaceSlug}/yachts/${passage.yachtSlug}`),
  ]);
  if (!anchoragesResult.ok || !yachtResult.ok) return;
  const anchorages = anchoragesResult.data.anchorages;
  const anchorageMap = new Map(anchorages.map((anchorage) => [anchorage.id, anchorage]));
  const yacht = yachtResult.data.yacht;

  const passageUpdates = el('div', {
    id: 'passage-updates',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Passage updates',
    class: 'live-region',
  });
  const messages = createMessageBox();
  takeHandOffMessage(messages);
  const fields = new FieldSet();

  const departureDate = textbox('Departure date', passage.departureDate);
  const departureTime = textbox('Departure time', passage.departureTime);
  const startCharge = spinbutton('Starting charge', passage.startChargePct, 0, 100);
  for (const control of [departureDate, departureTime, startCharge]) {
    control.disabled = !editable;
  }

  const legs: LegDraft[] = passage.legs.map((leg) => ({
    toAnchorageId: leg.toAnchorageId,
    speedKn: leg.speedKn,
  }));
  let departsAt = new Date(passage.departsAt);
  let computed = passage.legs.slice();
  let selected = 0;

  const ribbonHost = el('div', { class: 'ribbon', role: 'img', 'aria-label': 'Charge ribbon' });
  const ribbonSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ribbonSvg.setAttribute('viewBox', '0 0 1000 160');
  ribbonSvg.setAttribute('preserveAspectRatio', 'none');
  ribbonSvg.setAttribute('aria-hidden', 'true');
  ribbonSvg.setAttribute('focusable', 'false');
  const reserveLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  reserveLine.setAttribute('class', 'ribbon-reserve');
  reserveLine.setAttribute('x1', '0');
  reserveLine.setAttribute('x2', '1000');
  reserveLine.setAttribute('y1', String(160 - 0.2 * 160));
  reserveLine.setAttribute('y2', String(160 - 0.2 * 160));
  const chargePath = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path',
  ) as SVGPathElement;
  chargePath.setAttribute('class', 'ribbon-line');
  chargePath.setAttribute('d', 'M 0 0');
  const marks = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  marks.setAttribute('class', 'ribbon-marks');
  ribbonSvg.append(reserveLine, chargePath, marks);
  ribbonHost.appendChild(ribbonSvg);

  const legsStrip = stripList('Legs', 'No legs yet.', 'Legs position');
  const addLeg = button('Add leg');
  const setSpeeds = button('Set speeds');
  const savePassage = button('Save passage');
  const sendToCrew = button('Send to crew');
  const actionBar = el('div', { class: 'action-bar' }, savePassage, sendToCrew);

  const sheetSliderHost = el('div', { class: 'sheet-sliders' });

  const speedSliders: HTMLInputElement[] = [];
  const legCards: HTMLElement[] = [];
  const bands: HTMLElement[] = [];
  const chargeFigures: HTMLElement[] = [];
  const arrivalTexts: HTMLElement[] = [];
  const belowLabels: HTMLElement[] = [];

  const strip = createStrip({
    viewport: legsStrip.viewport,
    track: legsStrip.list,
    progress: legsStrip.progress,
    onIndexChange: (index) => {
      selected = index;
    },
  });

  const ribbonShape = (list: readonly PassageLeg[]): string => {
    if (list.length === 0) return 'M 0 160 L 1000 160';
    const step = 1000 / list.length;
    const points = [`M 0 ${160 - (passage.startChargePct / 100) * 160}`];
    for (const [index, leg] of list.entries()) {
      points.push(`L ${((index + 1) * step).toFixed(2)} ${(160 - (leg.arrivalChargePct / 100) * 160).toFixed(2)}`);
    }
    return points.join(' ');
  };

  const paintRibbon = (list: readonly PassageLeg[]): void => {
    easePath(chargePath, ribbonShape(list));
    marks.replaceChildren();
    const step = 1000 / Math.max(1, list.length);
    for (const [index, leg] of list.entries()) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String((index + 1) * step));
      dot.setAttribute('cy', String(160 - (leg.arrivalChargePct / 100) * 160));
      dot.setAttribute('r', '4');
      marks.appendChild(dot);
    }
    const lowest = list.length === 0 ? '' : String(Math.min(...list.map((leg) => leg.arrivalChargePct)));
    ribbonHost.setAttribute('data-min-charge', lowest);
  };

  const refreshFigures = (changedIndex: number | null): void => {
    computed = computeLegs({
      yacht,
      anchorages: anchorageMap,
      startAnchorageId: passage.startAnchorageId,
      departsAt,
      startChargePct: Number(startCharge.value),
      legs,
    });
    for (const [index, leg] of computed.entries()) {
      const card = legCards[index];
      if (card === undefined) continue;
      card.setAttribute('data-arrival-charge', String(leg.arrivalChargePct));
      card.setAttribute('data-reserve', leg.reserve);
      setRollingFigure(chargeFigures[index], `Arrives with ${formatChargePct(leg.arrivalChargePct)}`);
      arrivalTexts[index].textContent = formatInstant(leg.arrivesAt, leg.arrivalBase);
      belowLabels[index].hidden = leg.reserve === 'ok';
      bands[index].classList.toggle('is-below', leg.reserve === 'below_reserve');
    }
    paintRibbon(computed);
    sendToCrew.disabled =
      !editable || computed.length === 0 || computed.some((leg) => leg.reserve === 'below_reserve');
    if (changedIndex !== null && computed[changedIndex] !== undefined) {
      const leg = computed[changedIndex];
      announcePassage(
        MESSAGES.chargeAnnouncement(
          changedIndex + 1,
          anchorageMap.get(leg.toAnchorageId)?.name ?? '',
          leg.arrivalChargePct,
          leg.reserve === 'below_reserve',
        ),
      );
    }
  };

  const focusLeg = (index: number): void => {
    selected = Math.max(0, Math.min(index, legs.length - 1));
    if (legs.length === 0) return;
    const slider = speedSliders[selected];
    if (slider !== null && slider !== undefined && slider.offsetParent !== null) {
      slider.focus();
    } else {
      const sheetSlider = sheetSliderHost.querySelectorAll<HTMLInputElement>('input[type=range]')[selected];
      if (sheetSlider !== undefined && sheetSlider.offsetParent !== null) sheetSlider.focus();
      else legCards[selected].querySelector<HTMLElement>('button')?.focus();
    }
    if (isWide()) strip.moveTo(selected);
    else legCards[selected].scrollIntoView({ block: 'nearest' });
  };

  const buildSlider = (index: number): HTMLInputElement => {
    // Only the planner's editors get sliders; crew read the sent passage.
    const slider = el('input', {
      type: 'range',
      class: 'speed-slider',
      min: String(MIN_SPEED),
      max: String(MAX_SPEED),
      step: '0.5',
      value: String(legs[index].speedKn),
      'aria-label': `Leg ${index + 1} speed`,
      'aria-valuetext': formatSpeed(legs[index].speedKn),
    }) as HTMLInputElement;
    const change = (next: number): void => {
      const clamped = Math.max(MIN_SPEED, Math.min(MAX_SPEED, next));
      legs[index].speedKn = clamped;
      for (const other of [speedSliders[index], ...sheetSlidersFor(index)]) {
        if (other === undefined) continue;
        other.value = String(clamped);
        other.setAttribute('aria-valuetext', formatSpeed(clamped));
      }
      speedTexts[index]?.forEach((node) => {
        node.textContent = formatSpeed(clamped);
      });
      refreshFigures(index);
    };
    slider.addEventListener('input', () => change(Number(slider.value)));
    slider.addEventListener('keydown', (event) => {
      const keys: Record<string, number> = {
        ArrowLeft: -0.5,
        ArrowDown: -0.5,
        ArrowRight: 0.5,
        ArrowUp: 0.5,
        PageDown: -2,
        PageUp: 2,
      };
      if (event.key in keys) {
        event.preventDefault();
        change(legs[index].speedKn + keys[event.key]);
      } else if (event.key === 'Home') {
        event.preventDefault();
        change(MIN_SPEED);
      } else if (event.key === 'End') {
        event.preventDefault();
        change(MAX_SPEED);
      }
    });
    return slider;
  };

  const speedTexts: HTMLElement[][] = [];
  const sheetSliders: HTMLInputElement[] = [];
  const sheetSlidersFor = (index: number): HTMLInputElement[] =>
    sheetSliders[index] === undefined ? [] : [sheetSliders[index]];

  const buildLegs = (): void => {
    speedSliders.length = 0;
    legCards.length = 0;
    bands.length = 0;
    chargeFigures.length = 0;
    arrivalTexts.length = 0;
    belowLabels.length = 0;
    speedTexts.length = 0;
    sheetSliders.length = 0;
    const items = legs.map((leg, index) => {
      const from = anchorageMap.get(index === 0 ? passage.startAnchorageId : legs[index - 1].toAnchorageId);
      const to = anchorageMap.get(leg.toAnchorageId);
      const chargeFigure = el('p', { class: 'card-figure rolling-figure' });
      const arrivalText = el('p', { class: 'card-figure' });
      const below = el('p', { class: 'below-reserve' }, 'Below reserve');
      const band = el('div', { class: 'reserve-band', 'aria-hidden': 'true' });
      const distance = el(
        'p',
        { class: 'card-figure' },
        formatDistance(from === undefined || to === undefined ? 0 : haversineNm(from, to)),
      );
      const speedText = el('p', { class: 'card-figure' }, formatSpeed(leg.speedKn));
      const slider = buildSlider(index);
      const remove = quietButton(`Remove leg ${index + 1}`);
      remove.addEventListener('click', () => {
        legs.splice(index, 1);
        buildLegs();
        refreshFigures(null);
      });
      const card = el(
        'div',
        { class: 'leg-card', 'data-arrival-charge': '0', 'data-reserve': 'ok' },
        band,
        el('h3', { class: 'card-heading' }, `Leg ${index + 1}: ${from?.name ?? ''} to ${to?.name ?? ''}`),
        distance,
        arrivalText,
        chargeFigure,
        below,
        speedText,
        editable ? el('div', { class: 'leg-slider' }, slider) : null,
        editable ? remove : null,
      );
      speedSliders.push(slider);
      legCards.push(card);
      bands.push(band);
      chargeFigures.push(chargeFigure);
      arrivalTexts.push(arrivalText);
      belowLabels.push(below);
      speedTexts.push([speedText]);
      return listItem(card);
    });
    legsStrip.setItems(items);
    strip.refresh();
  };

  legsStrip.section.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
    if (event.key === '[') {
      event.preventDefault();
      focusLeg(selected - 1);
    } else if (event.key === ']') {
      event.preventDefault();
      focusLeg(selected + 1);
    }
  });

  addLeg.addEventListener('click', () => {
    const current = legs.length === 0 ? passage.startAnchorageId : legs[legs.length - 1].toAnchorageId;
    const options = anchorages.filter((anchorage) => anchorage.id !== current);
    openDialog({
      name: 'Add leg',
      opener: addLeg,
      build: (handle) => {
        const arriveAt = combobox(
          'Arrive at',
          options.map((anchorage) => ({ value: anchorage.id, label: anchorage.name })),
          options[0]?.id,
        );
        const confirm = button('Add leg');
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());
        confirm.addEventListener('click', () => {
          legs.push({ toAnchorageId: arriveAt.value, speedKn: 6 });
          buildLegs();
          refreshFigures(legs.length - 1);
          handle.close();
        });
        return {
          body: [
            el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Arrive at'), arriveAt),
            el('div', { class: 'dialog-actions' }, confirm, cancel),
          ],
          first: () => arriveAt,
        };
      },
    });
  });

  setSpeeds.addEventListener('click', () => {
    openDialog({
      name: 'Leg speeds',
      kind: 'sheet',
      opener: setSpeeds,
      build: () => {
        sheetSliderHost.replaceChildren();
        sheetSliders.length = 0;
        for (const [index] of legs.entries()) {
          const slider = buildSlider(index);
          sheetSliders[index] = slider;
          const text = el('p', { class: 'card-figure' }, formatSpeed(legs[index].speedKn));
          speedTexts[index] = [...(speedTexts[index] ?? []), text];
          sheetSliderHost.appendChild(
            el('div', { class: 'sheet-slider' }, el('p', {}, `Leg ${index + 1}`), slider, text),
          );
        }
        const sheetSave = button('Save passage');
        sheetSave.addEventListener('click', () => void save(sheetSave));
        return {
          body: [sheetSliderHost, el('div', { class: 'sticky-bar' }, sheetSave)],
          first: () => sheetSliders[selected] ?? sheetSliders[0] ?? sheetSave,
        };
      },
    });
  });

  const body = (): Record<string, unknown> => ({
    name: passage.name,
    startAnchorageId: passage.startAnchorageId,
    departureDate: departureDate.value,
    departureTime: departureTime.value,
    startChargePct: Number(startCharge.value),
    legs: legs.map((leg) => ({ toAnchorageId: leg.toAnchorageId, speedKn: leg.speedKn })),
  });

  const save = async (trigger: HTMLButtonElement): Promise<void> => {
    await withPending(trigger, 'Saving passage', async () => {
      const result = await api.put<{ passage: Passage }>(
        `/api/w/${workspaceSlug}/passages/${passageId}`,
        body(),
      );
      if (result.ok) {
        messages.show(MESSAGES.passageSaved);
        departsAt = new Date(result.data.passage.departsAt);
        refreshFigures(null);
        return;
      }
      const problems = failure(result);
      if (problems.errors !== undefined) {
        fields.showErrors(problems.errors)?.focus();
        return;
      }
      if (!handleAccessFailure(result, messages)) messages.show(MESSAGES.unexpected, 'problem');
    });
  };

  savePassage.addEventListener('click', () => void save(savePassage));
  sendToCrew.addEventListener('click', () => {
    void withPending(sendToCrew, 'Sending to crew', async () => {
      const result = await api.post(`/api/w/${workspaceSlug}/passages/${passageId}/send`);
      if (result.ok) {
        messages.show(MESSAGES.passageSent);
        return;
      }
      const problems = failure(result);
      if (problems.error === 'below_reserve') messages.show(MESSAGES.sendBelowReserve, 'problem');
      else if (problems.error === 'no_legs') messages.show(MESSAGES.sendNoLegs, 'problem');
      else if (!handleAccessFailure(result, messages)) messages.show(MESSAGES.unexpected, 'problem');
    });
  });

  const controls = el(
    'div',
    { class: 'passage-controls' },
    fields.problems,
    fields.field('departureDate', 'Departure date', departureDate),
    fields.field('departureTime', 'Departure time', departureTime),
    fields.field('startChargePct', 'Starting charge', startCharge),
  );
  for (const control of [departureDate, departureTime, startCharge]) {
    control.addEventListener('change', () => refreshFigures(null));
  }

  page.main.append(
    passageUpdates,
    messages.node,
    controls,
    legsStrip.section,
    editable ? el('div', { class: 'card-links' }, addLeg, setSpeeds) : el('div'),
    editable ? actionBar : el('div'),
  );
  legsStrip.section.classList.add('passage-chart');
  legsStrip.section.insertBefore(ribbonHost, legsStrip.section.children[1]);
  buildLegs();
  refreshFigures(null);
  legsStrip.progress.hidden = !isWide();
  setSpeeds.hidden = isWide();

  const onResize = (): void => {
    legsStrip.progress.hidden = !isWide();
    setSpeeds.hidden = isWide();
    strip.refresh();
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
