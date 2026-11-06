import { el, reducedMotion, setCountingNumber, countingNumber } from './dom.js';
import { HOOF_NAMES } from './copy.js';
import type { Comparison, Line } from './api.js';

/**
 * The axis wipe. The previous visit's after photo is the base layer; the current
 * visit's photo sits on top, visible only to the left of a vertical divider. Both
 * visits' lines are drawn over the whole stage at every divider position: previous
 * dashed in steel blue, current solid in forge orange.
 */
const HOOVES = ['LF', 'RF', 'LH', 'RH'] as const;

/** The two line inks, matching the palette's previous and current roles. */
const STEEL_BLUE = '#355470';
const FORGE_ORANGE = '#b2480d';
const INK = '#241a12';
export type Hoof = (typeof HOOVES)[number];

export interface StageOptions {
  /** Called when the hoof changes, so the panel can refetch and push history. */
  onHoofChange?: (hoof: Hoof) => void;
  onPairChange?: (previousVisitId: string, currentVisitId: string) => void;
  /** Shows the visit pickers and hoof radios; a vet page shows them read-only. */
  showVisitPickers: boolean;
  thumbnails?: Partial<Record<Hoof, string | null>>;
}

export interface StageHandle {
  root: HTMLElement;
  stageElement: HTMLElement;
  setComparison: (comparison: Comparison | null, options?: { keepDivider?: boolean }) => void;
  hoof: () => Hoof;
  setHoof: (hoof: Hoof, notify: boolean) => void;
  dividerValue: () => number;
  setThumbnail: (hoof: Hoof, url: string | null) => void;
  /** The SVG layer of the current visit, used to turn clicks into stored pixels. */
  currentLayer: () => SVGSVGElement | null;
}

function lineElements(line: Line, colour: string, dashed: boolean): SVGElement[] {
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  for (const node of [outline, stroke]) {
    node.setAttribute('x1', String(line.x1));
    node.setAttribute('y1', String(line.y1));
    node.setAttribute('x2', String(line.x2));
    node.setAttribute('y2', String(line.y2));
    node.setAttribute('vector-effect', 'non-scaling-stroke');
  }
  // A thin ink outline keeps the line visible over light and dark hoof photos.
  outline.setAttribute('stroke', INK);
  outline.setAttribute('stroke-width', '6');
  stroke.setAttribute('stroke', colour);
  stroke.setAttribute('stroke-width', '4');
  if (dashed) stroke.setAttribute('stroke-dasharray', '10 7');
  return [outline, stroke];
}

function layerFor(side: { photo: { width: number; height: number } | null }): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const width = side.photo?.width ?? 1200;
  const height = side.photo?.height ?? 900;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg;
}

export function createStage(options: StageOptions): StageHandle {
  let hoof: Hoof = 'LF';
  let divider = 50;
  let comparison: Comparison | null = null;
  let glideFrame = 0;

  const previousImage = el('img', { class: 'previous', alt: '' });
  const currentImage = el('img', { class: 'current', alt: '' });
  const lineHost = el('div');
  const dividerLine = el('div', { class: 'divider-line' });
  const stage = el('div', { class: 'stage' }, [previousImage, currentImage, lineHost, dividerLine]);

  const slider = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: '50',
    role: 'slider',
    'aria-label': 'Comparison divider',
    'aria-valuetext': '50% current',
  }) as HTMLInputElement;

  const readout = el('div', {
    class: 'readout',
    role: 'status',
    'aria-label': 'Angle readout',
  });

  const hoofRadios = new Map<Hoof, HTMLInputElement>();
  const hoofThumbs = new Map<Hoof, HTMLImageElement>();
  const hoofGroup = el('div', { role: 'radiogroup', 'aria-label': 'Hoof', class: 'hoof-grid' });
  for (const candidate of HOOVES) {
    const input = el('input', {
      type: 'radio',
      name: 'hoof-pick',
      value: candidate,
      'aria-label': HOOF_NAMES[candidate] as string,
    }) as HTMLInputElement;
    input.checked = candidate === hoof;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      setHoof(candidate, true);
    });
    const thumb = el('img', { alt: '', hidden: true }) as HTMLImageElement;
    hoofRadios.set(candidate, input);
    hoofThumbs.set(candidate, thumb);
    hoofGroup.append(el('label', {}, [input, thumb, HOOF_NAMES[candidate] as string]));
  }

  const previousPicker = el('select', { 'aria-label': 'Previous visit' }) as HTMLSelectElement;
  const currentPicker = el('select', { 'aria-label': 'Current visit' }) as HTMLSelectElement;
  const pickers = el('div', { class: 'inline' }, [
    options.showVisitPickers
      ? el('div', { class: 'field' }, [el('label', { for: 'previous-visit', text: 'Previous visit' }), previousPicker])
      : null,
    options.showVisitPickers
      ? el('div', { class: 'field' }, [el('label', { for: 'current-visit', text: 'Current visit' }), currentPicker])
      : null,
  ]);
  previousPicker.id = 'previous-visit';
  currentPicker.id = 'current-visit';

  /** With reduced motion a three-way control sets the divider. */
  const positionGroup = el('div', { role: 'radiogroup', 'aria-label': 'Divider position', class: 'row-actions' });
  const positionRadios: { value: number; input: HTMLInputElement }[] = [];
  for (const entry of [
    { label: 'Previous', value: 0 },
    { label: 'Split', value: 50 },
    { label: 'Current', value: 100 },
  ]) {
    const input = el('input', {
      type: 'radio',
      name: 'divider-position',
      'aria-label': entry.label,
      value: String(entry.value),
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      if (input.checked) setDivider(entry.value, false);
    });
    positionRadios.push({ value: entry.value, input });
    positionGroup.append(el('label', { class: 'inline' }, [input, entry.label]));
  }

  function syncPositionRadios(): void {
    for (const entry of positionRadios) entry.input.checked = divider === entry.value;
  }

  function applyDivider(): void {
    stage.style.setProperty('--divider', `${divider}%`);
    slider.value = String(Math.round(divider));
    slider.setAttribute('aria-valuetext', `${Math.round(divider)}% current`);
    syncPositionRadios();
  }

  function setDivider(value: number, glide: boolean): void {
    const next = Math.max(0, Math.min(100, value));
    if (!glide || reducedMotion()) {
      cancelAnimationFrame(glideFrame);
      divider = next;
      applyDivider();
      return;
    }
    const from = divider;
    const started = performance.now();
    cancelAnimationFrame(glideFrame);
    const step = (frame: number): void => {
      const progress = Math.min(1, (frame - started) / 440);
      // Springy: a slight overshoot before it rests.
      const eased =
        progress === 1
          ? 1
          : 1 - Math.cos(progress * Math.PI * 1.15) * (1 - progress) - progress * 0;
      divider = from + (next - from) * Math.min(1.08, eased);
      if (progress === 1) divider = next;
      applyDivider();
      if (progress < 1) glideFrame = requestAnimationFrame(step);
    };
    glideFrame = requestAnimationFrame(step);
  }

  /** Each keyboard step glides over about a quarter of a second. */
  slider.addEventListener('keydown', (event) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -10,
      PageUp: 10,
    };
    if (event.key in steps) {
      event.preventDefault();
      setDivider(divider + (steps[event.key] as number), false);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setDivider(0, false);
    } else if (event.key === 'End') {
      event.preventDefault();
      setDivider(100, false);
    }
  });

  slider.addEventListener('input', () => setDivider(Number(slider.value), false));

  // Pressing and dragging anywhere on the stage moves the divider under the pointer.
  let dragging = false;
  const moveToPointer = (clientX: number): void => {
    const rect = stage.getBoundingClientRect();
    setDivider(((clientX - rect.left) / rect.width) * 100, false);
  };
  stage.addEventListener('pointerdown', (event) => {
    dragging = true;
    stage.setPointerCapture(event.pointerId);
    moveToPointer(event.clientX);
  });
  stage.addEventListener('pointermove', (event) => {
    if (dragging) moveToPointer(event.clientX);
  });
  stage.addEventListener('pointerup', (event) => {
    dragging = false;
    stage.releasePointerCapture(event.pointerId);
  });
  stage.addEventListener('pointercancel', () => {
    dragging = false;
  });

  function setHoof(next: Hoof, notify: boolean): void {
    hoof = next;
    for (const [candidate, input] of hoofRadios) input.checked = candidate === next;
    if (notify) options.onHoofChange?.(next);
  }

  let currentSvg: SVGSVGElement | null = null;

  /**
   * The readout is drawn twice: a visible copy whose numerals count, hidden from the
   * reader, and a hidden copy carrying the server's exact lines, which is what the
   * `Angle readout` region reads out and is final from the first frame.
   */
  interface ReadoutNumbers {
    wallPrevious: HTMLElement;
    wallCurrent: HTMLElement;
    pasternPrevious: HTMLElement;
    pasternCurrent: HTMLElement;
  }
  let numbers: ReadoutNumbers | null = null;
  let spokenLines: HTMLElement | null = null;
  let shown: { wallPrevious: number; wallCurrent: number; pasternPrevious: number; pasternCurrent: number } | null =
    null;

  const degrees = (value: number): string => `${value.toFixed(1)}\u00b0`;

  function renderReadout(next: Comparison): void {
    const angles = {
      wallPrevious: next.previous.hoof_wall.angle,
      wallCurrent: next.current.hoof_wall.angle,
      pasternPrevious: next.previous.pastern.angle,
      pasternCurrent: next.current.pastern.angle,
    };

    if (numbers === null || spokenLines === null) {
      const hidden = { spoken: false } as const;
      const wallPrevious = countingNumber(angles.wallPrevious, degrees, hidden);
      const wallCurrent = countingNumber(angles.wallCurrent, degrees, hidden);
      const pasternPrevious = countingNumber(angles.pasternPrevious, degrees, hidden);
      const pasternCurrent = countingNumber(angles.pasternCurrent, degrees, hidden);
      wallPrevious.classList.add('previous');
      pasternPrevious.classList.add('previous');
      wallCurrent.classList.add('current');
      pasternCurrent.classList.add('current');

      const wallLine = el('p', { 'aria-hidden': 'true' }, [
        'Hoof wall ',
        wallPrevious,
        ` \u2192 `,
        wallCurrent,
        ' (',
        el('span', { 'data-difference': 'hoof_wall', text: '' }),
        '\u00b0)',
      ]);
      const pasternLine = el('p', { 'aria-hidden': 'true' }, [
        'Pastern ',
        pasternPrevious,
        ` \u2192 `,
        pasternCurrent,
        ' (',
        el('span', { 'data-difference': 'pastern', text: '' }),
        '\u00b0)',
      ]);
      const alignmentLine = el('p', { 'aria-hidden': 'true', 'data-alignment': '', text: '' });
      spokenLines = el('div', { class: 'visually-hidden' });
      readout.replaceChildren(wallLine, pasternLine, alignmentLine, spokenLines);
      numbers = { wallPrevious, wallCurrent, pasternPrevious, pasternCurrent };
    } else {
      const from = shown ?? angles;
      setCountingNumber(numbers.wallPrevious, from.wallPrevious, angles.wallPrevious, degrees);
      setCountingNumber(numbers.wallCurrent, from.wallCurrent, angles.wallCurrent, degrees);
      setCountingNumber(numbers.pasternPrevious, from.pasternPrevious, angles.pasternPrevious, degrees);
      setCountingNumber(numbers.pasternCurrent, from.pasternCurrent, angles.pasternCurrent, degrees);
    }

    // The signed differences and the labels come straight from the server's lines.
    const wallDifference = /\(([^)]+)\u00b0\)/.exec(next.readout[0]);
    const pasternDifference = /\(([^)]+)\u00b0\)/.exec(next.readout[1]);
    const wallSpan = readout.querySelector('[data-difference="hoof_wall"]');
    const pasternSpan = readout.querySelector('[data-difference="pastern"]');
    if (wallSpan instanceof HTMLElement) wallSpan.textContent = wallDifference?.[1] ?? '';
    if (pasternSpan instanceof HTMLElement) pasternSpan.textContent = pasternDifference?.[1] ?? '';
    const alignmentSpan = readout.querySelector('[data-alignment]');
    if (alignmentSpan instanceof HTMLElement) alignmentSpan.textContent = next.readout[2];

    spokenLines.replaceChildren(...next.readout.map((line) => el('p', { text: line })));
    shown = angles;
  }

  function setComparison(next: Comparison | null, settings: { keepDivider?: boolean } = {}): void {
    const previousPair =
      comparison === null
        ? null
        : `${comparison.previous.visit_id ?? comparison.previous.business_date}|` +
          `${comparison.current.visit_id ?? comparison.current.business_date}|${comparison.hoof}`;
    comparison = next;
    if (next === null) {
      previousImage.removeAttribute('src');
      currentImage.removeAttribute('src');
      lineHost.replaceChildren();
      readout.replaceChildren(el('p', { text: 'No marked pair for this hoof yet.' }));
      numbers = null;
      spokenLines = null;
      shown = null;
      currentSvg = null;
      return;
    }

    if (next.previous.photo !== null) previousImage.src = next.previous.photo.url;
    if (next.current.photo !== null) currentImage.src = next.current.photo.url;

    const previousLayer = layerFor(next.previous);
    for (const node of lineElements(next.previous.hoof_wall, STEEL_BLUE, true)) previousLayer.append(node);
    for (const node of lineElements(next.previous.pastern, STEEL_BLUE, true)) previousLayer.append(node);
    const currentLayerSvg = layerFor(next.current);
    for (const node of lineElements(next.current.hoof_wall, FORGE_ORANGE, false)) currentLayerSvg.append(node);
    for (const node of lineElements(next.current.pastern, FORGE_ORANGE, false)) currentLayerSvg.append(node);
    lineHost.replaceChildren(previousLayer, currentLayerSvg);
    currentSvg = currentLayerSvg;

    if (options.showVisitPickers && next.marked_visits !== undefined) {
      const fill = (picker: HTMLSelectElement, selected: string | undefined): void => {
        const before = picker.value;
        picker.replaceChildren();
        for (const visit of next.marked_visits ?? []) {
          picker.append(el('option', { value: visit.visit_id, text: visit.business_date }));
        }
        picker.value = selected ?? before;
      };
      fill(previousPicker, next.previous.visit_id);
      fill(currentPicker, next.current.visit_id);
    }

    renderReadout(next);

    const newPair = `${next.previous.visit_id ?? next.previous.business_date}|${
      next.current.visit_id ?? next.current.business_date
    }|${next.hoof}`;
    // Choosing another hoof or visit sends the divider to the middle; a live update
    // leaves it, the pair, the hoof and focus exactly as they were.
    if (settings.keepDivider !== true && previousPair !== newPair) setDivider(50, previousPair !== null);
  }

  const onPairPick = (): void => {
    options.onPairChange?.(previousPicker.value, currentPicker.value);
  };
  previousPicker.addEventListener('change', onPairPick);
  currentPicker.addEventListener('change', onPairPick);

  applyDivider();

  const region = el('div', { class: 'stage-wrap', role: 'region', 'aria-label': 'Hoof comparison' }, [
    stage,
    el('div', { class: 'stage-controls' }, [slider]),
    reducedMotion() ? positionGroup : null,
    el('div', { class: 'panel-split' }, [hoofGroup, readout]),
    options.showVisitPickers ? pickers : null,
  ]);

  // The reduced-motion control appears whenever that preference is set.
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
    if (event.matches && !positionGroup.isConnected) {
      stage.parentElement?.insertBefore(positionGroup, stage.nextSibling?.nextSibling ?? null);
    } else if (!event.matches && positionGroup.isConnected) {
      positionGroup.remove();
    }
  });

  return {
    root: region,
    stageElement: stage,
    setComparison,
    hoof: () => hoof,
    setHoof,
    dividerValue: () => divider,
    setThumbnail: (candidate, url) => {
      const thumb = hoofThumbs.get(candidate);
      if (thumb === undefined) return;
      if (url === null) {
        thumb.hidden = true;
        thumb.removeAttribute('src');
      } else {
        thumb.src = url;
        thumb.hidden = false;
      }
    },
    currentLayer: () => currentSvg,
  };
}

export { HOOVES };
