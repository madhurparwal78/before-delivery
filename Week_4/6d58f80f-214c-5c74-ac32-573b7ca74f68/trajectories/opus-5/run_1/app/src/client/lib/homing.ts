const CHIP_CAP = 8;
const STAGGER_MS = 40;
const FLIGHT_MS = 420;

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Chip {
  fileId: string;
  name: string;
  /** The folder this chip flies to, then its ancestors from nearest to furthest. */
  chain: string[];
}

export interface FlightTarget {
  /** The destination folder, then its ancestors from nearest to furthest. */
  chain: string[];
}

const rectOf = (element: Element | null): DOMRect | null =>
  element === null ? null : element.getBoundingClientRect();

/**
 * The chip lands on the destination's tree node, or at phone width on its path-bar segment,
 * falling back to the nearest visible ancestor.
 */
const targetRect = (target: FlightTarget): DOMRect | null => {
  const phone = window.innerWidth < 768;
  if (phone) {
    for (const id of target.chain) {
      const found = rectOf(document.querySelector(`[data-path-segment="${id}"]`));
      if (found !== null) return found;
    }
    return rectOf(document.querySelector('[data-path-segment]'));
  }
  for (const id of target.chain) {
    const found = rectOf(document.querySelector(`[data-tree-node="${id}"]`));
    if (found !== null) return found;
  }
  return null;
};

const curve = (from: DOMRect, to: DOMRect): Keyframe[] => {
  const startX = from.left + from.width / 2;
  const startY = from.top + from.height / 2;
  const endX = to.left + to.width / 2;
  const endY = to.top + to.height / 2;
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy) || 1;
  const bow = Math.max(distance * 0.18, 24);
  const controlX = (startX + endX) / 2 - (dy / distance) * bow;
  const controlY = (startY + endY) / 2 + (dx / distance) * bow;
  const frames: Keyframe[] = [];
  const steps = 14;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = (1 - t) ** 2 * startX + 2 * (1 - t) * t * controlX + t ** 2 * endX;
    const y = (1 - t) ** 2 * startY + 2 * (1 - t) * t * controlY + t ** 2 * endY;
    frames.push({
      offset: t,
      transform: `translate(${x - startX}px, ${y - startY}px) scale(${1 - t * 0.25})`,
      opacity: step === steps ? 0.1 : 1,
    });
  }
  return frames;
};

const chipElement = (text: string, id: string, at: DOMRect): HTMLElement => {
  const chip = document.createElement('span');
  chip.className = 'homing-chip';
  chip.dataset.homingChip = id;
  chip.textContent = text;
  chip.style.left = `${at.left}px`;
  chip.style.top = `${at.top}px`;
  chip.style.maxWidth = `${Math.max(at.width, 120)}px`;
  return chip;
};

const layer = (): HTMLElement => {
  const existing = document.getElementById('homing-layer');
  if (existing !== null) return existing;
  const created = document.createElement('div');
  created.id = 'homing-layer';
  document.body.append(created);
  return created;
};

const showStaticBadge = (target: FlightTarget, count: number): void => {
  const phone = window.innerWidth < 768;
  const selector = phone ? 'data-path-segment' : 'data-tree-node';
  let host: Element | null = null;
  for (const id of target.chain) {
    host = document.querySelector(`[${selector}="${id}"]`);
    if (host !== null) break;
  }
  if (host === null) return;
  const badge = document.createElement('span');
  badge.className = 'homing-badge';
  badge.textContent = `+${count}`;
  host.append(badge);
  const clear = (): void => {
    badge.remove();
    window.removeEventListener('focusin', clear);
    window.removeEventListener('keydown', clear);
  };
  window.addEventListener('focusin', clear);
  window.addEventListener('keydown', clear);
};

export interface FlightOptions {
  chips: Chip[];
  target: FlightTarget;
  /** Called when the last chip lands, so counts step together. */
  onLanded: () => void;
}

/** The homing flight: name chips lift out of their rows and fly to the destination. */
export const flyHome = (options: FlightOptions): void => {
  const rows = new Map<string, HTMLElement>();
  for (const chip of options.chips) {
    const row = document.querySelector<HTMLElement>(`[data-file-row="${chip.fileId}"]`);
    if (row !== null) rows.set(chip.fileId, row);
  }

  if (prefersReducedMotion()) {
    if (options.chips.length > 0) showStaticBadge(options.target, options.chips.length);
    options.onLanded();
    return;
  }

  const destination = targetRect(options.target);
  if (destination === null) {
    for (const row of rows.values()) row.classList.add('row-collapsing');
    options.onLanded();
    return;
  }

  const host = layer();
  const flying = options.chips.slice(0, CHIP_CAP);
  const extra = options.chips.length - flying.length;
  let last = 0;

  flying.forEach((chip, index) => {
    const row = rows.get(chip.fileId);
    const from = rectOf(row ?? null);
    if (from === null) return;
    const to = targetRect({ chain: chip.chain }) ?? destination;
    const element = chipElement(chip.name, chip.fileId, from);
    host.append(element);
    const delay = index * STAGGER_MS;
    last = Math.max(last, delay + FLIGHT_MS);
    const animation = element.animate(curve(from, to), {
      duration: FLIGHT_MS,
      delay,
      easing: 'cubic-bezier(0.22, 0.9, 0.2, 1)',
      fill: 'forwards',
    });
    animation.finished.then(() => element.remove(), () => element.remove());
    window.setTimeout(() => row?.classList.add('row-collapsing'), delay);
  });

  if (extra > 0) {
    const firstRow = rows.get(options.chips[CHIP_CAP]?.fileId ?? '');
    const from = rectOf(firstRow ?? null) ?? destination;
    const element = chipElement(`+${extra}`, 'more', from);
    host.append(element);
    const delay = CHIP_CAP * STAGGER_MS;
    last = Math.max(last, delay + FLIGHT_MS);
    const animation = element.animate(curve(from, destination), {
      duration: FLIGHT_MS,
      delay,
      easing: 'cubic-bezier(0.22, 0.9, 0.2, 1)',
      fill: 'forwards',
    });
    animation.finished.then(() => element.remove(), () => element.remove());
    for (const chip of options.chips.slice(CHIP_CAP)) {
      window.setTimeout(() => rows.get(chip.fileId)?.classList.add('row-collapsing'), delay);
    }
  }

  window.setTimeout(() => options.onLanded(), last);
};
