import { formatCountdown, parseInstant } from '../domain/time.ts';
import { rollDigits } from './motion.ts';
import { serverNow } from './net.ts';

const ticking = new Set<HTMLElement>();

function tick(): void {
  for (const node of ticking) {
    const deadline = node.dataset['deadline'] ?? '';
    const instant = deadline === '' ? null : parseInstant(deadline);
    rollDigits({
      host: node,
      value: instant === null ? '00:00:00' : formatCountdown(instant - serverNow()),
    });
  }
}

/** Every countdown counts by the server's clock and rolls only the digits that changed. */
export function startCountdowns(): void {
  ticking.clear();
  for (const node of document.querySelectorAll<HTMLElement>('[data-countdown]')) {
    ticking.add(node);
  }
  tick();
  window.setInterval(tick, 1000);
}

export function setDeadline(node: HTMLElement, instant: string): void {
  node.dataset['deadline'] = instant;
  ticking.add(node);
  tick();
}
