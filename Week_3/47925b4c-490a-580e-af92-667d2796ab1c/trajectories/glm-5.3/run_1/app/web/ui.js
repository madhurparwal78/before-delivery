// Rendering helpers shared by the screens: published copy drawn character for character.

import { BAND } from './app.js';

export const COPY = {
  syncWaiting: (n) => `Waiting to sync ${n}`,
  syncNeedsFixing: (n) => `Needs fixing ${n}`,
  syncSending: 'Sending readings',
  rectifySuccess: (residual) => `Rectified to ${residual} m.`,
  kitSuccess: 'Movement recorded.',
  hirePending: 'Asking the hire desk',
  hireHeld: (mmss) => `Held for ${mmss}`,
  hireAskedUnsettled: 'Asked; still checking with the hire desk',
  hireHired: (serial) => `Hired in. ${serial} is on your shelf.`,
  hireLapsed: 'This hold has lapsed. Bodies drawn on it need a body again.',
  hireReleased: 'Released.',
  hireQuote: (total) => `Quote ${total} including 21% VAT.`,
  issuePending: 'Issuing the rig sheet',
  issueSuccess: 'Issued.',
  masksProgress: (phase, done, total) => `${phase}: ${done} of ${total}`,
  masksStoreDown: "The sheet store isn't answering. The mask bundle will carry on when it returns.",
  rigTick: (name) => `${name} marked live.`,
  rigUntick: (name) => `${name} marked not live.`,
  outOfStep: 'This sheet is out of step with the layout. Ask the artist before rigging.',
  stale: 'These readings are stale; street lighting and foliage change.',
};

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of flat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

function flat(children) {
  return children.flatMap((child) => (Array.isArray(child) ? flat(child) : [child]));
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function fragment(...children) {
  const frag = document.createDocumentFragment();
  append(frag, children);
  return frag;
}

// A live region that screen readers can trust: replace text in place.
export function announce(status, text) {
  clear(status);
  status.append(text);
}

export function sentence(container, text, slotContent) {
  clear(container);
  const heading = h('h1', { class: 'sentence' });
  const parts = slotContent === null ? [text] : splitAtSlot(text);
  append(heading, parts.map((part, index) => (index === 1
    ? (typeof slotContent === 'function' ? slotContent() : slotContent)
    : part)));
  container.append(heading);
  return heading;
}

function splitAtSlot(text) {
  const marker = text.indexOf('<slot>');
  if (marker === -1) return [text, null, ''];
  return [text.slice(0, marker), '<slot>', text.slice(marker + 6)];
}

export function outageBand() {
  return h('div', { role: 'alert', class: 'outage-band', 'aria-live': 'assertive', hidden: '' });
}

export function showProblem(band, problem) {
  clear(band);
  band.append(problem.detail ?? 'Something went wrong on our side.');
  band.hidden = false;
}

export function hideProblem(band) {
  band.hidden = true;
  clear(band);
}

export function statusRegion(name) {
  return h('div', { role: 'status', 'aria-live': 'polite', class: 'status', 'data-name': name });
}

export function fieldError(id, text) {
  return h('p', { class: 'field-error', id, hidden: text === null ? true : null }, text ?? '');
}

export function labelled(labelText, control, errorId) {
  const id = control.id || `field-${crypto.randomUUID()}`;
  control.id = id;
  const describedBy = errorId ? [errorId] : [];
  if (describedBy.length > 0) control.setAttribute('aria-describedby', describedBy.join(' '));
  return h('label', {}, labelText, control);
}

export function cellAnnouncement(cell, figures) {
  if (figures === null || figures.contrast === null) return `Cell ${cell}, no reading.`;
  const blended = figures.blended ? ', blended.' : '.';
  return `Cell ${cell}, ${figures.contrastText}, ${figures.pixelsPerMetre} pixels per metre${blended}`;
}

export { BAND };
