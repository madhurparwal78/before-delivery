// A short shower of falling notes. One element holds every note, clicks pass
// through it, and it is gone within three seconds. Reduced motion appends
// nothing at all.

import { prefersReducedMotion } from '../dom.js';

const COLOURS = ['var(--money-in)', 'var(--accent)'];

export function celebrate() {
  if (prefersReducedMotion()) return;
  const container = document.createElement('div');
  container.className = 'celebration';
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('data-celebration', 'true');

  for (let index = 0; index < 24; index += 1) {
    const note = document.createElement('span');
    note.className = 'note';
    note.style.left = `${Math.random() * 96}%`;
    note.style.background = COLOURS[index % COLOURS.length];
    note.style.animationDelay = `${Math.random() * 0.4}s`;
    note.style.animationDuration = `${1.6 + Math.random() * 0.7}s`;
    container.append(note);
  }

  document.body.append(container);
  setTimeout(() => container.remove(), 2800);
}
