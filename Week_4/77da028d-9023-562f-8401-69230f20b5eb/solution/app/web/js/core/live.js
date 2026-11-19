// Live regions: created once with their accessible name, then only their text changes.
import { h } from './dom.js';

export function liveRegion(name, { visible = true, extraClass = '' } = {}) {
  return h('div', {
    role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'aria-label': name,
    class: `${visible ? 'live' : 'sr-only'} ${extraClass}`.trim(),
  });
}

// One announcement is one text node, so the same copy repeated is still a new mutation.
export function announce(region, text) {
  region.textContent = text;
}
