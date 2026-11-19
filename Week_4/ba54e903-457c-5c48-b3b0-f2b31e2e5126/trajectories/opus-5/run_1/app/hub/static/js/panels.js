// Closed regions are unavailable: not in the accessibility tree, Tab order or pointer.
// Escape closes the region that was opened last and hands focus back to its opener.

const openers = new WeakMap();
const stack = [];

export function openPanel(panel, opener, focusTarget) {
  panel.hidden = false;
  if (opener) {
    openers.set(panel, opener);
    if (opener.hasAttribute('aria-expanded')) opener.setAttribute('aria-expanded', 'true');
  }
  const place = stack.indexOf(panel);
  if (place >= 0) stack.splice(place, 1);
  stack.push(panel);
  if (focusTarget) focusTarget.focus();
}

export function closePanel(panel, { restoreFocus = true } = {}) {
  const place = stack.indexOf(panel);
  if (place >= 0) stack.splice(place, 1);
  if (panel.hidden) return;
  panel.hidden = true;
  const opener = openers.get(panel);
  openers.delete(panel);
  if (opener) {
    if (opener.hasAttribute('aria-expanded')) opener.setAttribute('aria-expanded', 'false');
    if (restoreFocus) opener.focus();
  }
}

export function closeTopPanel() {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const panel = stack[index];
    if (!panel.hidden) {
      closePanel(panel);
      return true;
    }
    stack.splice(index, 1);
  }
  return false;
}
