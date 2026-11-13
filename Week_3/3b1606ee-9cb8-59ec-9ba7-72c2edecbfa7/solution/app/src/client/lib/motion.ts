import { prefersReducedMotion } from './hooks';

/** Fast out, soft in, settling with no bounce. */
export const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** The send sequence ends 1040 ms after Send: fold 0-320, top fold 120-440, flap 440-640, shrink 640-1040. */
const HOLD_MS = 760;

interface SendMotion {
  /** Resolves when the folded paper is almost home, so the postmark can be struck. */
  landing: Promise<void>;
}

const sends = new Map<string, SendMotion>();
let slide: { conversationId: string; before: number } | null = null;

export const sendMotionFor = (letterId: string): SendMotion | undefined => sends.get(letterId);

export function takeRowSlide(): { conversationId: string; before: number } | null {
  const pending = slide;
  slide = null;
  return pending;
}

function paper(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function rectOf(selector: string): DOMRect | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/**
 * The composer's text folds in thirds, closes its flap and shrinks into the conversation's row (two or three
 * panes) or the foot of the letter sheet (one pane). Under reduced motion nothing turns: the letter simply fades in.
 */
export function beginSend(letterId: string, conversationId: string, source: HTMLElement, text: string): void {
  if (prefersReducedMotion()) {
    sends.set(letterId, { landing: Promise.resolve() });
    return;
  }
  const from = source.getBoundingClientRect();
  const row = rectOf(`[data-testid="conversation-row"][data-conversation-id="${conversationId}"]`);
  const listTop = document.querySelector('[aria-label="Conversations"]')?.getBoundingClientRect().top;
  const sheet = rectOf('[aria-label="Letters"]');
  const target =
    row && listTop !== undefined
      ? { x: row.left, y: listTop, w: row.width, h: row.height }
      : sheet
        ? { x: sheet.left, y: sheet.bottom - 72, w: sheet.width, h: 72 }
        : { x: from.left, y: from.top - 80, w: from.width, h: 72 };
  if (row) slide = { conversationId, before: row.top };

  const overlay = paper('fold');
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  const stage = paper('fold__stage');
  const third = from.height / 3;
  const upper = paper('fold__third fold__third--top');
  const middle = paper('fold__third fold__third--mid');
  const lower = paper('fold__third fold__third--low');
  for (const part of [upper, middle, lower]) part.style.height = `${third}px`;
  upper.style.top = '0px';
  middle.style.top = `${third}px`;
  lower.style.top = `${third * 2}px`;
  const front = paper('fold__face');
  front.textContent = text;
  lower.append(front, paper('fold__face fold__face--back'));
  const flap = paper('fold__flap');
  flap.style.top = `${third}px`;
  stage.append(middle, lower, upper, flap);
  overlay.append(stage);
  document.body.append(overlay);

  const frames = (a: string, b: string): Keyframe[] => [{ transform: a }, { transform: b }];
  const timing = (duration: number, delay = 0): KeyframeAnimationOptions => ({ duration, delay, easing: EASE, fill: 'forwards' });
  lower.animate(frames('rotateX(0deg)', 'rotateX(-180deg)'), timing(320));
  upper.animate(frames('rotateX(0deg)', 'rotateX(180deg)'), timing(320, 120));
  flap.animate(frames('scaleY(0)', 'scaleY(1)'), timing(200, 440));
  const dx = target.x + target.w / 2 - (from.left + from.width / 2);
  const dy = target.y + target.h / 2 - (from.top + from.height / 2);
  const shrink = stage.animate(frames('translate(0, 0) scale(1)', `translate(${dx}px, ${dy}px) scale(${Math.max(0.1, target.w / from.width)})`), timing(400, 640));
  const hold = overlay.animate([{ opacity: 1 }, { opacity: 1 }], { duration: HOLD_MS });
  void shrink.finished.then(() => {
    overlay.remove();
    sends.delete(letterId);
  });
  sends.set(letterId, { landing: hold.finished.then(() => undefined) });
}

/** A letter written just now stays hidden until its folded twin arrives, then appears. */
export function arrive(element: HTMLElement): void {
  if (prefersReducedMotion()) {
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100 });
    return;
  }
  element.animate([{ opacity: 0 }, { opacity: 0 }], { duration: HOLD_MS });
}

/** The postmark ring is struck: slightly enlarged and level, it settles to full size, tilted 8 degrees anticlockwise. */
export function strike(ring: HTMLElement): void {
  ring.animate([{ transform: 'rotate(0deg) scale(1.15)' }, { transform: 'rotate(-8deg) scale(1)' }], { duration: 200, easing: EASE });
}

/** The conversation's row slides from where it was to its new place, as the folded paper arrives. */
export function slideRow(row: HTMLElement, before: number): void {
  const delta = before - row.getBoundingClientRect().top;
  if (delta === 0) return;
  row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: 400, delay: 640, easing: EASE, fill: 'backwards' });
}

/** A newly opened letter unfolds: the folds of Send in reverse order, in under half a second. */
export function unfold(element: HTMLElement): void {
  element.animate(
    [
      { transform: 'perspective(700px) rotateX(-100deg)', opacity: 0, transformOrigin: 'top center' },
      { transform: 'perspective(700px) rotateX(-40deg)', opacity: 1, transformOrigin: 'top center', offset: 0.4 },
      { transform: 'perspective(700px) rotateX(0deg)', opacity: 1, transformOrigin: 'top center' },
    ],
    { duration: 380, easing: EASE },
  );
}
