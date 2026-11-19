import { el } from './dom';

const GAP_MS = 60;

interface Region {
  node: HTMLElement;
  queue: string[];
  timer: number | null;
}

const regions = new WeakMap<HTMLElement, Region>();

const regionOf = (node: HTMLElement): Region => {
  const found = regions.get(node);
  if (found !== undefined) return found;
  const made: Region = { node, queue: [], timer: null };
  regions.set(node, made);
  return made;
};

const flush = (region: Region): void => {
  const next = region.queue.shift();
  if (next === undefined) {
    region.timer = null;
    return;
  }
  region.node.replaceChildren(el('span', { text: next }));
  region.timer = window.setTimeout(() => flush(region), GAP_MS);
};

/**
 * Writes one line to a live region as its own update. Steps that follow each other
 * reach the region one after another, never joined, and a line identical to the one
 * already shown is written again so it is announced again.
 */
export const announce = (node: HTMLElement, text: string): void => {
  const region = regionOf(node);
  region.queue.push(text);
  if (region.timer === null) flush(region);
};

