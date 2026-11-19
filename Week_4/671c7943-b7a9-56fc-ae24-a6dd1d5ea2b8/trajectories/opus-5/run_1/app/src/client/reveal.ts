import { listen, onDispose, onFrame } from './dom.js';

interface Trigger {
  element: HTMLElement;
  ratio: number;
  run: () => void;
}

let triggers: Trigger[] = [];

export function onReveal(element: HTMLElement, ratio: number, run: () => void): void {
  triggers.push({ element, ratio, run });
}

function check(): void {
  const height = window.innerHeight;
  triggers = triggers.filter((trigger) => {
    if (trigger.element.getBoundingClientRect().top >= height * trigger.ratio) return true;
    trigger.run();
    return false;
  });
}

export function startReveals(): void {
  onDispose(() => {
    triggers = [];
  });
  listen(window, 'scroll', () => onFrame(check), { passive: true });
  listen(window, 'resize', () => onFrame(check));
  check();
}
