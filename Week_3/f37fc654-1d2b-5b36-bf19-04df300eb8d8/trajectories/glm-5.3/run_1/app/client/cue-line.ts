/** The cue-line question, guide cursor and typing schedule. */
import { el } from './dom.js';

export interface TypedLineCallbacks {
  onSettled?: () => void;
}

const LETTER_DELAY_MS = 40;
const LETTER_START_MS = 400;
const CHIP_DELAY_MS = 60;

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Renders a heading that types letter by letter with the colour trail. */
export function renderTypedHeading(
  heading: HTMLHeadingElement,
  text: string,
  cursor: HTMLElement,
  done: () => void,
): void {
  heading.textContent = '';
  heading.setAttribute('aria-label', text);
  heading.setAttribute('data-typed', '0');
  heading.dataset['question'] = text;
  if (prefersReducedMotion()) {
    // Under reduced motion the whole line appears at once, white.
    heading.setAttribute('data-typed', String(text.length));
    heading.textContent = text;
    cursor.classList.add('cursor-parked');
    done();
    return;
  }
  const letters: HTMLElement[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? ' ';
    const span = el('span', { 'data-letter': 'hidden', 'aria-hidden': 'true' });
    span.textContent = ch;
    heading.append(span);
    letters.push(span);
  }
  const openAt = performance.now();
  let settled = false;
  const settleTimer = window.setTimeout(() => {
    settled = true;
    done();
  }, LETTER_START_MS + LETTER_DELAY_MS * text.length + 600);
  const tick = (): void => {
    const now = performance.now() - openAt;
    let count = 0;
    for (let i = 0; i < letters.length; i++) {
      const appearAt = LETTER_START_MS + LETTER_DELAY_MS * i;
      if (now < appearAt) break;
      count = i + 1;
      const span = letters[i];
      if (!span) continue;
      const age = now - appearAt;
      if (age < 200) span.setAttribute('data-letter', 'violet');
      else if (age < 400) span.setAttribute('data-letter', 'cyan');
      else span.setAttribute('data-letter', 'white');
    }
    heading.setAttribute('data-typed', String(count));
    // The cursor follows just after the newest letter.
    const newest = letters[Math.max(0, count - 1)];
    if (newest) {
      const rect = newest.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      cursor.style.transform = `translate(${rect.right - headingRect.left}px, ${rect.bottom - headingRect.top}px)`;
    } else {
      cursor.style.transform = 'translate(0, 0)';
    }
    if (count >= letters.length && now > LETTER_START_MS + LETTER_DELAY_MS * letters.length + 400) {
      if (!settled) {
        settled = true;
        window.clearTimeout(settleTimer);
        cursor.classList.add('cursor-parked');
        done();
      }
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Rises the answer controls into place one after another, 60 ms apart. */
export function riseControls(container: HTMLElement): void {
  if (prefersReducedMotion()) return;
  const groups = Array.from(container.querySelectorAll<HTMLElement>('[data-rise]'));
  groups.forEach((group, i) => {
    group.style.animationDelay = `${i * CHIP_DELAY_MS}ms`;
    group.classList.add('rise-in');
  });
}

export function createCursor(): HTMLElement {
  const cursor = el('span', { class: 'spindrift-cursor', 'aria-hidden': 'true' });
  const tag = el('span', { class: 'cursor-tag' }, 'SPINDRIFT');
  cursor.append(tag);
  return cursor;
}
