export const DURATIONS = { feedback: 140, state: 280, entrance: 560 } as const;

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

export function reducedMotion(): boolean {
  return reducedQuery.matches;
}

/** Rotates an element to a new angle with the state duration, or at once with reduced motion. */
export function turnTo(element: HTMLElement, degrees: number): void {
  element.style.setProperty('--turn', `${degrees}deg`);
}

export interface RollOptions {
  /** Only digits whose value changed roll. */
  value: string;
  host: HTMLElement;
}

/** Writes a counter or countdown, rolling only the digits whose value changed. */
export function rollDigits({ value, host }: RollOptions): void {
  const previous = host.dataset['rolled'] ?? '';
  if (previous === value) return;
  host.dataset['rolled'] = value;

  const characters = [...value];
  const existing = [...host.querySelectorAll<HTMLElement>('[data-digit]')];
  if (existing.length !== characters.length) {
    host.replaceChildren(
      ...characters.map((character) => {
        const span = document.createElement('span');
        span.dataset['digit'] = '';
        span.textContent = character;
        return span;
      }),
    );
    return;
  }
  const previousCharacters = [...previous];
  for (const [index, character] of characters.entries()) {
    const span = existing[index];
    if (span === undefined) continue;
    if (previousCharacters[index] === character) continue;
    span.textContent = character;
    if (reducedMotion()) continue;
    span.classList.remove('is-rolling');
    void span.offsetWidth;
    span.classList.add('is-rolling');
  }
}

/** Runs the route wipe, or moves on at once with reduced motion. */
export async function routeWipe(direction: 'up' | 'down', run: () => Promise<void>): Promise<void> {
  const panel = document.querySelector<HTMLElement>('[data-route-wipe]');
  if (panel === null || reducedMotion()) {
    await run();
    return;
  }
  panel.dataset['direction'] = direction;
  panel.classList.add('is-covering');
  await wait(DURATIONS.entrance / 2);
  await run();
  panel.classList.remove('is-covering');
  panel.classList.add('is-clearing');
  await wait(DURATIONS.entrance / 2);
  panel.classList.remove('is-clearing');
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pointer effects follow the kind of pointer each event comes from, never device capability. */
export function isMousePointer(event: PointerEvent): boolean {
  return event.pointerType === 'mouse';
}
