import { byId, need, reducedMotion } from './dom.js';
import { startGuide } from './guide.js';
import { wireSoundButton } from './sound.js';

const REEL_STATES = [
  { zoom: '1', focus: '4', score: '—' },
  { zoom: '2', focus: '4', score: '—' },
  { zoom: '2', focus: '8', score: '100 / 100' },
];

export function startTitle(): void {
  const guide = startGuide();
  wireSoundButton();
  need('reset-view').addEventListener('click', () => guide?.reset());

  const zoomSlider = need<HTMLInputElement>('demo-zoom');
  const focusSlider = need<HTMLInputElement>('demo-focus');
  const zoomOut = need('reel-zoom');
  const focusOut = need('reel-focus');
  zoomSlider.addEventListener('input', () => {
    zoomOut.textContent = (Number(zoomSlider.value) / 100).toFixed(2);
  });
  focusSlider.addEventListener('input', () => {
    focusOut.textContent = focusSlider.value;
  });

  const reel = byId('reel');
  const steps = Array.from(document.querySelectorAll<HTMLElement>('.reel-steps li'));
  if (!reel || steps.length === 0) return;

  if (reducedMotion()) {
    reel.classList.add('static-stack');
    for (const step of steps) step.classList.add('shown');
    return;
  }

  const apply = (index: number): void => {
    const state = REEL_STATES[Math.max(0, Math.min(REEL_STATES.length - 1, index))];
    zoomOut.textContent = state.zoom;
    focusOut.textContent = state.focus;
    need('reel-score').textContent = state.score;
    steps.forEach((step, position) => step.classList.toggle('shown', position <= index));
  };

  const observer = new IntersectionObserver(
    (records) => {
      for (const record of records)
        if (record.isIntersecting) apply(steps.indexOf(record.target as HTMLElement));
    },
    { threshold: 0.6 },
  );
  for (const step of steps) observer.observe(step);
  apply(0);
}
