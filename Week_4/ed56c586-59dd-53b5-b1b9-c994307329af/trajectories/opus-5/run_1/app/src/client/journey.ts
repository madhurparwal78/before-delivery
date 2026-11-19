/** The career journey: reached milestones, the progress line and the details. */

import { MILESTONE_LINE } from '../shared/rules.js';
import { need, onScrollOrResize, queryAll, setHidden } from './dom.js';

export const setUpJourney = (): void => {
  const milestones = queryAll<HTMLElement>('[data-milestone]');
  const progress = need<HTMLElement>('[data-journey-progress]');
  const line = need<HTMLElement>('.journey-progress-line', progress);

  for (const milestone of milestones) {
    const button = need<HTMLButtonElement>('.milestone-button', milestone);
    const detail = need<HTMLElement>('.milestone-detail', milestone);
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', open ? 'false' : 'true');
      setHidden(detail, open);
    });
  }

  onScrollOrResize(() => {
    const limit = window.innerHeight * MILESTONE_LINE;
    let reached = 0;
    for (const milestone of milestones) {
      const isReached = milestone.getBoundingClientRect().top <= limit;
      milestone.dataset.reached = isReached ? 'true' : 'false';
      if (isReached) reached += 1;
    }
    progress.dataset.value = String(reached);
    line.style.width = `${(reached / milestones.length) * 100}%`;
  });
};
