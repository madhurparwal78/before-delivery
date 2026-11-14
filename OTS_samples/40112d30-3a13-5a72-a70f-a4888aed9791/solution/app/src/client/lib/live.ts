import { byId } from './dom.ts';

// The two live regions that exist on every page: #announcer (polite) and the assertive #alert.
// Text replaces the region's text at once; a sentence repeated in a row is cleared and set again in a microtask.

function say(id: string, text: string): void {
  const region = byId(id);
  if (!region) return;
  if (region.textContent === text && text !== '') {
    region.textContent = '';
    queueMicrotask(() => { region.textContent = text; });
  } else {
    region.textContent = text;
  }
}

export const announce = (text: string): void => say('announcer', text);
export const alertText = (text: string): void => say('alert', text);
