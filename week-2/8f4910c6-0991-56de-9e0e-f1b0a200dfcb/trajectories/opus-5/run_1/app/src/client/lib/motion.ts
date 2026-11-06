/** The three published durations, in milliseconds. */
export const DURATION = { short: 140, middle: 300, long: 560 } as const;

const EASING = 'cubic-bezier(0.16, 0.84, 0.28, 1)';

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animate(node: Element, frames: Keyframe[], duration: number): Animation {
  return node.animate(frames, { duration, easing: EASING, fill: 'both' });
}

/** A paper panel covers the page, then reveals the next one. */
export async function routeCover(back: boolean): Promise<() => Promise<void>> {
  const panel = document.createElement('div');
  panel.className = 'route-cover';
  panel.setAttribute('aria-hidden', 'true');
  document.body.append(panel);
  if (reducedMotion()) {
    panel.remove();
    return async () => {
      const main = document.querySelector('.page');
      if (main) await animate(main, [{ opacity: 0 }, { opacity: 1 }], DURATION.short).finished;
    };
  }
  const from = back ? '-100%' : '100%';
  await animate(panel, [{ transform: `translateY(${from})` }, { transform: 'translateY(0)' }], DURATION.middle)
    .finished;
  return async () => {
    const to = back ? '100%' : '-100%';
    await animate(panel, [{ transform: 'translateY(0)' }, { transform: `translateY(${to})` }], DURATION.middle)
      .finished;
    panel.remove();
  };
}

/** Each heading line rises from behind its own lower edge. */
export function revealHeading(heading: HTMLElement): void {
  const text = heading.textContent ?? '';
  const words = text.split(' ');
  const lines = words.length > 3
    ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
    : [text];
  heading.textContent = '';
  lines.forEach((line, index) => {
    const mask = document.createElement('span');
    mask.className = 'heading-line';
    const inner = document.createElement('span');
    inner.className = 'heading-line-inner';
    inner.textContent = index === 0 ? line : ` ${line}`;
    if (!reducedMotion()) {
      inner.style.animationDelay = `${index * DURATION.short}ms`;
      inner.classList.add('heading-line-rise');
    }
    mask.append(inner);
    heading.append(mask);
  });
}

/** A copy of the portrait travels to the tray, and the count rolls. */
export function flyToTray(source: HTMLElement, target: HTMLElement): void {
  if (reducedMotion()) return;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.className = 'tray-ghost';
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  document.body.append(ghost);
  const animation = animate(
    ghost,
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      {
        transform: `translate(${to.left - from.left + to.width / 2}px, ${to.top - from.top}px) scale(0.1)`,
        opacity: 0.2,
      },
    ],
    DURATION.middle,
  );
  animation.finished.then(() => ghost.remove()).catch(() => ghost.remove());
}

export function rollCount(node: HTMLElement): void {
  if (reducedMotion()) {
    animate(node, [{ opacity: 0 }, { opacity: 1 }], DURATION.short);
    return;
  }
  animate(node, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], DURATION.middle);
}

/** The promoted chip's numeral rolls one glyph height per rank step. */
export function rollNumeral(node: HTMLElement, steps: number): void {
  if (reducedMotion()) {
    animate(node, [{ opacity: 0 }, { opacity: 1 }], DURATION.short);
    return;
  }
  animate(
    node,
    [{ transform: `translateY(${steps * 100}%)` }, { transform: 'translateY(0)' }],
    DURATION.long,
  );
}

export type Positions = Map<string, DOMRect>;

export function measure(nodes: Iterable<HTMLElement>): Positions {
  const positions: Positions = new Map();
  for (const node of nodes) {
    const key = node.dataset.chipId;
    if (key) positions.set(key, node.getBoundingClientRect());
  }
  return positions;
}

/** Chips glide from their old rung to the new one by moving the drawn chip. */
export function slideChips(nodes: Iterable<HTMLElement>, previous: Positions): void {
  if (reducedMotion()) return;
  for (const node of nodes) {
    const key = node.dataset.chipId;
    if (!key) continue;
    const before = previous.get(key);
    if (!before) continue;
    const after = node.getBoundingClientRect();
    const dy = before.top - after.top;
    if (Math.abs(dy) < 1) continue;
    animate(node, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], DURATION.middle);
  }
}

export function fadeOut(node: HTMLElement): Promise<void> {
  if (reducedMotion()) {
    node.remove();
    return Promise.resolve();
  }
  return animate(node, [{ opacity: 1 }, { opacity: 0 }], DURATION.short).finished.then(() => {
    node.remove();
  });
}
