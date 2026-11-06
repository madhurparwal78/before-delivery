import { clamp } from './dom.js';

/** How far the page has scrolled, 0 at the very top and 1 at the very bottom. */
export function pageFraction(): number {
  const travel = document.documentElement.scrollHeight - window.innerHeight;
  return travel <= 0 ? 0 : clamp(window.scrollY / travel, 0, 1);
}

/** 0 when the element's top edge is at the top of the screen, 1 when its bottom is at the bottom. */
export function windowProgress(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const travel = rect.height - window.innerHeight;
  if (travel <= 0) return passProgress(element);
  return clamp(-rect.top / travel, 0, 1);
}

/** 0 when the element's top reaches the bottom of the screen, 1 when its bottom reaches the top. */
export function passProgress(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  return clamp((window.innerHeight - rect.top) / (rect.height + window.innerHeight), 0, 1);
}

/** The share of the element that is on screen, used to pick the scene being shown. */
export function onScreenShare(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return visible <= 0 ? 0 : visible / window.innerHeight;
}
