import { el, prefersReducedMotion } from '../dom.js';
import { currentSession } from '../shell.js';

const SPECIMEN = 'Quenby & Co. sets every letter by rule.';

/** The typography chapter's weight specimen. */
export function weightFigure(): HTMLElement {
  const readout = el('p', { class: 'figure-readout' }, 'Weight 400');
  const announcement = el('p', {
    class: 'visually-hidden',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Weight announcement',
  });
  const specimenText = el('p', { class: 'specimen-text' }, SPECIMEN);
  specimenText.style.fontWeight = '400';
  specimenText.style.transition = prefersReducedMotion() ? 'font-weight 0s' : 'font-weight 500ms ease-out';

  const slider = el('input', {
    type: 'range',
    min: '250',
    max: '900',
    step: '1',
    value: '400',
    'aria-label': 'Weight',
    class: 'weight-slider',
  }) as HTMLInputElement;

  let timer = 0;
  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    readout.textContent = `Weight ${value}`;
    specimenText.style.fontWeight = String(value);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      announcement.textContent = `Weight ${value}`;
    }, currentSession().config.weightAnnounceDelayMs);
  });

  return el(
    'div',
    { class: 'figure' },
    el(
      'figure',
      { 'aria-label': 'Weight specimen', class: 'weight-figure' },
      specimenText,
      el('figcaption', {}, 'Display type runs from weight 250 to 900; body text sits at 400.'),
    ),
    slider,
    readout,
    announcement,
    el(
      'p',
      { class: 'figure-text' },
      'Drag the weight slider, or use the arrow keys, to set any weight between 250 and 900. The specimen renders at the weight you pick.',
    ),
  );
}
