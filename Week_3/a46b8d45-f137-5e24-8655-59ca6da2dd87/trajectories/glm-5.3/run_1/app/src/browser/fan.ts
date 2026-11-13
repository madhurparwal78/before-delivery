// The exploded fitting fan. The fan root carries the published attributes,
// parts glide along the model's axis, and every change shows before the next frame.
import { fanScale } from './fanscale.js';

export interface FanPart {
  bookletNumber: number;
  name: string;
  partNumber: string;
  status: string;
}

export interface FanModel {
  slug: string;
  name: string;
  axis: 'x' | 'y' | 'iso' | null;
}

interface FanOptions {
  model: FanModel;
  parts: FanPart[];
  selected: number | null;
  readonly locked: boolean;
  initialSeparation: number;
  reducedMotion: boolean;
  strings: () => { separateParts: string; fanHeading: string; diagramUnavailable: string; partsList: string; partButton: (n: number, name: string) => string };
  onSelect: (bookletNumber: number) => void;
}

const SELECT_MS = 160;

/** Gap g: 48 px at 768 px wide and up, 28 px below. */
function gapPx(): number {
  return window.innerWidth >= 768 ? 48 : 28;
}

/** All rounding in the fan is half up on the exact decimal value. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5 + 1e-9);
}

/** Creates the fitting fan and returns its root element and update functions. */
export function createFan(options: FanOptions): {
  root: HTMLElement;
  setSeparation: (value: number) => void;
  setSelected: (bookletNumber: number | null) => void;
  teardown: () => void;
} {
  const { model, parts, locked } = options;
  const hasDiagram = model.axis !== null;
  const root = document.createElement('section');
  root.setAttribute('role', 'region');
  root.className = 'fan';

  let separation = options.initialSeparation;
  let selected = options.selected;
  let selectTimer: number | null = null;

  const s = (): number => separation / 100;

  const updateAttributes = (): void => {
    const g = gapPx();
    const n = parts.length;
    root.setAttribute('data-fan-separation', String(roundHalfUp(s() * g * (n - 1))));
    root.setAttribute('data-fan-scale', fanScale(s()));
    root.setAttribute('data-fan-axis', model.axis ?? 'none');
    root.setAttribute('data-active-part', selected === null ? 'none' : String(selected));
  };

  const partButtons: HTMLButtonElement[] = [];

  const layoutParts = (): void => {
    const g = gapPx();
    const scale = 1 - 0.25 * s();
    for (let k = 0; k < parts.length; k++) {
      const button = partButtons[k];
      if (!button) continue;
      const offset = roundHalfUp(s() * k * g);
      button.setAttribute('data-part-offset', String(offset));
      let tx = '0px';
      let ty = '0px';
      if (model.axis === 'x') { tx = `${offset}px`; ty = '0px'; }
      else if (model.axis === 'y') { tx = '0px'; ty = `${offset}px`; }
      else if (model.axis === 'iso') {
        tx = `${roundHalfUp(offset * Math.cos(Math.PI / 6))}px`;
        ty = `${roundHalfUp(-offset * Math.sin(Math.PI / 6))}px`;
      }
      button.style.setProperty('--tx', tx);
      button.style.setProperty('--ty', ty);
      button.style.transform = `translate(var(--tx), var(--ty)) scale(${scale.toFixed(3)})`;
    }
  };

  // --- Controls ---
  if (hasDiagram) {
    const sliderLabel = document.createElement('label');
    sliderLabel.textContent = options.strings().separateParts;
    sliderLabel.className = 'fan-slider-label';
    root.appendChild(sliderLabel);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(separation);
    slider.className = 'fan-slider';
    slider.setAttribute('aria-label', options.strings().separateParts);
    slider.addEventListener('input', () => {
      separation = Number(slider.value);
      updateAttributes();
      layoutParts();
    });
    slider.addEventListener('keydown', (e) => {
      const current = Number(slider.value);
      let next: number | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = current + 5;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = current - 5;
      else if (e.key === 'PageUp') next = current + 25;
      else if (e.key === 'PageDown') next = current - 25;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 100;
      if (next !== null) {
        e.preventDefault();
        separation = Math.max(0, Math.min(100, next));
        slider.value = String(separation);
        updateAttributes();
        layoutParts();
      }
    });
    root.appendChild(slider);
  }

  const diagramArea = document.createElement('div');
  diagramArea.className = hasDiagram ? 'fan-diagram' : 'fan-list-area';

  if (!hasDiagram) {
    const heading = document.createElement('h3');
    heading.textContent = options.strings().diagramUnavailable;
    heading.className = 'fan-fallback-heading';
    root.appendChild(heading);
    const list = document.createElement('ul');
    list.setAttribute('role', 'list');
    list.className = 'fan-fallback-list';
    list.setAttribute('aria-label', options.strings().partsList);
    for (const part of parts) {
      const li = document.createElement('li');
      const button = makePartButton(part);
      li.appendChild(button);
      list.appendChild(li);
    }
    root.appendChild(list);
  } else {
    for (const part of parts) {
      diagramArea.appendChild(makePartButton(part));
    }
    root.appendChild(diagramArea);
  }

  function makePartButton(part: FanPart): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fan-part';
    button.setAttribute('aria-pressed', selected === part.bookletNumber ? 'true' : 'false');
    if (part.status === 'withdrawn') button.setAttribute('aria-disabled', 'true');
    const label = options.strings().partButton(part.bookletNumber, part.name);
    button.setAttribute('aria-label', label);
    button.dataset['booklet'] = String(part.bookletNumber);

    const outline = document.createElement('span');
    outline.className = 'fan-part-shape';
    outline.setAttribute('aria-hidden', 'true');
    const callout = document.createElement('span');
    callout.className = 'fan-callout';
    callout.setAttribute('aria-hidden', 'true');
    callout.textContent = String(part.bookletNumber);
    button.appendChild(outline);
    button.appendChild(callout);

    button.addEventListener('click', () => {
      if (locked || part.status === 'withdrawn') return;
      options.onSelect(part.bookletNumber);
    });
    partButtons.push(button);
    return button;
  }

  // Bracket shortcut: ] next active part, [ previous, never wrapping, focus stays.
  const bracketShortcut = (e: KeyboardEvent): void => {
    if (e.key !== ']' && e.key !== '[') return;
    if (!root.contains(document.activeElement)) return;
    if (locked) return;
    const active = parts.filter((p) => p.status !== 'withdrawn');
    if (active.length === 0) return;
    const currentIndex = selected === null ? -1 : active.findIndex((p) => p.bookletNumber === selected);
    let target: number;
    if (e.key === ']') {
      target = currentIndex === -1 ? 0 : currentIndex + 1;
      if (target >= active.length) return;
    } else {
      target = currentIndex === -1 ? active.length - 1 : currentIndex - 1;
      if (target < 0) return;
    }
    const part = active[target];
    if (part) options.onSelect(part.bookletNumber);
  };

  document.addEventListener('keydown', bracketShortcut);

  // The fan root needs its region name: it is set by the page that mounts it.
  updateAttributes();
  layoutParts();

  return {
    root,
    setSeparation(value: number) {
      separation = Math.max(0, Math.min(100, value));
      updateAttributes();
      layoutParts();
    },
    setSelected(bookletNumber: number | null) {
      // A second selection during the glide is the one that stays: the newest
      // selection always wins and no leftover timer re-selects anything.
      if (selectTimer !== null) { window.clearTimeout(selectTimer); selectTimer = null; }
      selected = bookletNumber;
      for (const button of partButtons) {
        const booklet = Number(button.dataset['booklet']);
        button.setAttribute('aria-pressed', booklet === selected ? 'true' : 'false');
        button.classList.toggle('is-selected', booklet === selected);
      }
      updateAttributes();
      if (!options.reducedMotion) {
        selectTimer = window.setTimeout(() => { selectTimer = null; }, SELECT_MS);
      }
    },
    teardown() {
      document.removeEventListener('keydown', bracketShortcut);
      if (selectTimer !== null) window.clearTimeout(selectTimer);
    },
  };
}

