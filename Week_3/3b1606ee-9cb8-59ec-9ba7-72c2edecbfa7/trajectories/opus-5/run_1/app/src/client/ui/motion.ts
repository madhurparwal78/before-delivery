/** Motion means one thing: a letter changed hands. */

const EASE = 'cubic-bezier(0.2, 0.9, 0.2, 1)';
const FADE_MS = 120;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animate(
  element: Element,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation {
  return element.animate(frames, { easing: EASE, fill: 'both', ...options });
}

export function fadeIn(element: Element): void {
  if (reducedMotion()) {
    animate(element, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS });
    return;
  }
  animate(
    element,
    [
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 200 },
  );
}

export function fadeOut(element: Element): Promise<void> {
  const animation = animate(element, [{ opacity: 1 }, { opacity: 0 }], {
    duration: reducedMotion() ? FADE_MS : 200,
  });
  return animation.finished.then(() => undefined);
}

export interface FoldTarget {
  /** Where the folded letter shrinks to. */
  rect: DOMRect;
}

/**
 * The send signature: the lower third folds up, the top third folds down over it,
 * the flap closes, and the folded letter shrinks into its place.
 */
export async function foldAndSend(
  source: HTMLElement,
  text: string,
  target: FoldTarget,
): Promise<void> {
  if (reducedMotion()) return;
  const start = source.getBoundingClientRect();
  const letter = document.createElement('div');
  letter.className = 'folding-letter';
  letter.setAttribute('aria-hidden', 'true');
  letter.style.left = `${start.left}px`;
  letter.style.top = `${start.top}px`;
  letter.style.width = `${start.width}px`;
  letter.style.height = `${start.height}px`;

  const thirds: HTMLElement[] = [];
  for (const part of ['top', 'middle', 'bottom']) {
    const third = document.createElement('div');
    third.className = `folding-third folding-${part}`;
    if (part === 'bottom') third.textContent = text;
    letter.append(third);
    thirds.push(third);
  }
  const flap = document.createElement('div');
  flap.className = 'folding-flap';
  letter.append(flap);
  document.body.append(letter);

  const bottom = thirds[2] as HTMLElement;
  const top = thirds[0] as HTMLElement;

  const shrinkStart = 670 / 1070;
  const folds = [
    animate(bottom, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-180deg)' }], {
      duration: 333,
    }),
    animate(top, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(180deg)' }], {
      duration: 345,
      delay: 125,
    }),
    animate(flap, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
      duration: 200,
      delay: 470,
    }),
    // The folded letter holds still until the flap closes, then shrinks into its row.
    animate(
      letter,
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0, easing: 'linear' },
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: shrinkStart, easing: EASE },
        {
          transform: `translate(${target.rect.left - start.left}px, ${
            target.rect.top - start.top
          }px) scale(${Math.max(0.1, target.rect.width / Math.max(1, start.width))})`,
          opacity: 0.2,
          offset: 1,
        },
      ],
      { duration: 1070 },
    ),
  ];
  await Promise.all(folds.map((animation) => animation.finished));
  letter.remove();
}

/** The postmark strikes: slightly enlarged and level, settling tilted. */
export function strikePostmark(postmark: HTMLElement): void {
  if (reducedMotion()) {
    postmark.style.transform = 'rotate(-8deg)';
    return;
  }
  animate(
    postmark,
    [
      { transform: 'scale(1.18) rotate(0deg)', opacity: 0.4 },
      { transform: 'scale(1) rotate(-8deg)', opacity: 1 },
    ],
    { duration: 200 },
  );
}

/** A later state change re-strikes the postmark and rolls the time's digits. */
export function restrikePostmark(postmark: HTMLElement, label: HTMLElement): void {
  if (reducedMotion()) {
    label.classList.add('inked');
    window.setTimeout(() => label.classList.remove('inked'), 2000);
    return;
  }
  animate(
    postmark,
    [
      { transform: 'scale(1.12) rotate(0deg)' },
      { transform: 'scale(1) rotate(-8deg)' },
    ],
    { duration: 200 },
  );
}

/** The digits change one at a time from left to right, finishing within half a second. */
export function rollDigits(time: HTMLElement, text: string): void {
  if (reducedMotion()) {
    time.textContent = text;
    return;
  }
  time.replaceChildren();
  const characters = [...text];
  const step = characters.length === 0 ? 0 : Math.min(60, 420 / characters.length);
  characters.forEach((character, index) => {
    const span = document.createElement('span');
    span.className = 'digit';
    span.textContent = character;
    time.append(span);
    animate(span, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 80,
      delay: index * step,
    });
  });
}

/** Opening a received letter unfolds it: the same folds in reverse. */
export function unfold(element: HTMLElement): void {
  if (reducedMotion()) return;
  animate(
    element,
    [
      { transform: 'scaleY(0.2) rotateX(40deg)', opacity: 0.3 },
      { transform: 'scaleY(1) rotateX(0deg)', opacity: 1 },
    ],
    { duration: 460 },
  );
}

/** The list or sheet stripe steps one bar at a time while it loads. */
export function setLoading(element: HTMLElement, loading: boolean): void {
  element.classList.toggle('loading', loading);
}
