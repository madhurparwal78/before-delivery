import { announce as copy } from '../domain/copy.ts';
import { announce } from './store/store.ts';

let timer: number | null = null;

/** The saved sentence follows the write, within a second of typing stopping. */
export function noticeSaved(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    announce(copy.saved);
  }, 400);
}
