/**
 * Every animation uses the Web Animations API, so the browser's animation list
 * shows it while it runs. Each animated element carries `data-anim` naming its
 * animation and `data-phase`, which under reduced motion is `end` at once.
 */

export type AnimName =
  | 'table-drawin'
  | 'token-slide'
  | 'turn-fuse'
  | 'piece-slide'
  | 'piece-capture'
  | 'disc-drop'
  | 'card-deal'
  | 'card-flip'
  | 'vehicle-drive'
  | 'block-place'
  | 'block-shard'
  | 'coin-count'
  | 'night-tint';

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Options {
  readonly keyframes: Keyframe[];
  readonly duration: number;
  readonly easing?: string;
  /** For card flip, the moment the card is edge-on. */
  readonly midAt?: number;
}

export function animate(
  element: HTMLElement | null,
  name: AnimName,
  options: Options,
): Animation | null {
  if (element === null) return null;
  element.dataset.anim = name;

  if (reducedMotion()) {
    element.dataset.phase = 'end';
    return null;
  }

  element.dataset.phase = 'start';
  const animation = element.animate(options.keyframes, {
    duration: options.duration,
    easing: options.easing ?? 'ease-out',
    fill: 'none',
  });

  const mid = options.midAt ?? options.duration / 2;
  const midTimer = window.setTimeout(() => {
    if (element.dataset.phase === 'start') element.dataset.phase = 'mid';
  }, mid);

  animation.finished
    .then(() => {
      window.clearTimeout(midTimer);
      element.dataset.phase = 'end';
    })
    .catch(() => {
      window.clearTimeout(midTimer);
      element.dataset.phase = 'end';
    });

  return animation;
}

export const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)';
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** A placed block grows from 60 percent of its size to full size. */
export const blockPlace = (element: HTMLElement | null): void => {
  animate(element, 'block-place', {
    keyframes: [{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }],
    duration: 150,
    easing: EASE_OUT,
  });
};

/** A broken block bursts into shards that fade out and are then removed. */
export function blockShards(host: HTMLElement | null): void {
  if (host === null) return;
  const count = 8;
  for (let i = 0; i < count; i += 1) {
    const shard = document.createElement('span');
    shard.className = 'shard';
    shard.dataset.anim = 'block-shard';
    shard.style.left = '50%';
    shard.style.top = '50%';
    host.appendChild(shard);

    const angle = (i / count) * Math.PI * 2;
    const distance = 18 + (i % 3) * 4;
    if (reducedMotion()) {
      shard.dataset.phase = 'end';
      shard.remove();
      continue;
    }
    shard.dataset.phase = 'start';
    const animation = shard.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${
            Math.sin(angle) * distance
          }px))`,
          opacity: 0,
        },
      ],
      { duration: 340, easing: EASE_OUT },
    );
    window.setTimeout(() => {
      if (shard.dataset.phase === 'start') shard.dataset.phase = 'mid';
    }, 170);
    animation.finished
      .then(() => {
        shard.dataset.phase = 'end';
        shard.remove();
      })
      .catch(() => shard.remove());
  }
}

/** The counter counts to its new value, showing at least five distinct values. */
export function countCoins(
  element: HTMLElement | null,
  from: number,
  to: number,
  onStep: (value: number) => void,
): void {
  if (element !== null) element.dataset.anim = 'coin-count';
  if (from === to) {
    if (element !== null) element.dataset.phase = 'end';
    onStep(to);
    return;
  }
  if (reducedMotion()) {
    if (element !== null) element.dataset.phase = 'end';
    onStep(to);
    return;
  }
  if (element !== null) element.dataset.phase = 'start';

  const duration = 550;
  const steps = 12;
  let step = 0;
  const timer = window.setInterval(() => {
    step += 1;
    if (step >= steps) {
      window.clearInterval(timer);
      onStep(to);
      if (element !== null) element.dataset.phase = 'end';
      return;
    }
    if (step === Math.floor(steps / 2) && element !== null) element.dataset.phase = 'mid';
    onStep(Math.round(from + ((to - from) * step) / steps));
  }, duration / steps);
}

/** A disc falls, then makes one upward bounce of 6 to 10 pixels. */
export const discDrop = (element: HTMLElement | null, rowsFallen: number): void => {
  const fall = 120 + 40 * rowsFallen;
  const start = -(rowsFallen + 1) * 100;
  animate(element, 'disc-drop', {
    keyframes: [
      { transform: `translateY(${start}%)` },
      { transform: 'translateY(0)', offset: 0.8 },
      { transform: 'translateY(-8px)', offset: 0.9 },
      { transform: 'translateY(0)' },
    ],
    duration: fall,
    easing: EASE_IN,
  });
};

/** The moved piece slides in a straight line without changing size. */
export const pieceSlide = (
  element: HTMLElement | null,
  deltaX: number,
  deltaY: number,
): void => {
  animate(element, 'piece-slide', {
    keyframes: [
      { transform: `translate(${-deltaX}px, ${-deltaY}px)` },
      { transform: 'translate(0, 0)' },
    ],
    duration: 220,
    easing: EASE_OUT,
  });
};

export const pieceCapture = (element: HTMLElement | null): void => {
  animate(element, 'piece-capture', {
    keyframes: [{ opacity: 1 }, { opacity: 0 }],
    duration: 220,
    easing: EASE_OUT,
  });
};

/** A played card turns half a turn; its face stays hidden until edge-on. */
export const cardFlip = (element: HTMLElement | null): void => {
  animate(element, 'card-flip', {
    keyframes: [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
    duration: 250,
    easing: EASE_IN_OUT,
    midAt: 125,
  });
};

export const cardDeal = (element: HTMLElement | null, order: number): void => {
  const animation = animate(element, 'card-deal', {
    keyframes: [
      { transform: 'translate(0, 0) scale(0.6)', opacity: 0.2 },
      { transform: 'none', opacity: 1 },
    ],
    duration: 200,
    easing: EASE_OUT,
  });
  if (animation !== null) animation.currentTime = 0;
  if (element !== null && !reducedMotion()) {
    element.style.animationDelay = `${order * 60}ms`;
  }
};

/** The vehicle moves tile to tile through every stored step, in order. */
export async function driveVehicle(
  element: HTMLElement | null,
  steps: readonly string[],
  tilePixels: number,
  onArrive: (index: number) => void,
): Promise<void> {
  if (element === null) return;
  element.dataset.anim = 'vehicle-drive';
  if (reducedMotion()) {
    element.dataset.phase = 'end';
    onArrive(steps.length);
    return;
  }
  element.dataset.phase = 'start';
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const dx = step === 'E' ? tilePixels : step === 'W' ? -tilePixels : 0;
    const dy = step === 'S' ? tilePixels : step === 'N' ? -tilePixels : 0;
    const animation = element.animate(
      [{ transform: `translate(${-dx}px, ${-dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 110, easing: 'linear' },
    );
    if (i === Math.floor(steps.length / 2)) element.dataset.phase = 'mid';
    onArrive(i + 1);
    await animation.finished.catch(() => undefined);
  }
  element.dataset.phase = 'end';
}

/** The table tile grows along its own outline into the full board panel. */
export const tableDrawIn = (element: HTMLElement | null, tile: DOMRect | null): void => {
  if (element === null) return;
  if (tile === null || reducedMotion()) {
    element.dataset.anim = 'table-drawin';
    element.dataset.phase = 'end';
    return;
  }
  const panel = element.getBoundingClientRect();
  const scaleX = tile.width / Math.max(1, panel.width);
  const scaleY = tile.height / Math.max(1, panel.height);
  const shiftX = tile.left + tile.width / 2 - (panel.left + panel.width / 2);
  const shiftY = tile.top + tile.height / 2 - (panel.top + panel.height / 2);
  animate(element, 'table-drawin', {
    keyframes: [
      { transform: `translate(${shiftX}px, ${shiftY}px) scale(${scaleX}, ${scaleY})` },
      { transform: 'translate(0, 0) scale(1, 1)' },
    ],
    duration: 460,
    easing: EASE_OUT,
  });
};

export const tokenSlide = (element: HTMLElement | null): void => {
  animate(element, 'token-slide', {
    keyframes: [{ transform: 'scale(0.7)', opacity: 0.4 }, { transform: 'none', opacity: 1 }],
    duration: 330,
    easing: EASE_OUT,
  });
};

export const nightTint = (element: HTMLElement | null, level: number): void => {
  if (element === null) return;
  element.dataset.anim = 'night-tint';
  element.dataset.nightLevel = String(level);
  if (reducedMotion()) {
    element.dataset.phase = 'end';
    element.style.opacity = String(level);
    return;
  }
  const from = Number(element.style.opacity === '' ? '0' : element.style.opacity);
  element.style.opacity = String(level);
  animate(element, 'night-tint', {
    keyframes: [{ opacity: from }, { opacity: level }],
    duration: 1000,
    easing: EASE_IN_OUT,
  });
};
