import { need } from './dom.js';

export function announce(message: string): void {
  need<HTMLElement>('[data-status]').textContent = message;
}
