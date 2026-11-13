import { PLAY_COPY } from '../../shared/copy.js';
import { el, labelledButton } from '../dom.js';
import { navigate, type Screen } from '../navigate.js';
import { clearSnapshot, readSnapshot } from './table.js';

const DIFFICULTIES = ['Rookie', 'Regular', 'Shark', 'Free table'] as const;

export function practiceSetupScreen(): Screen {
  let chosen: string = DIFFICULTIES[0];
  const group = el('div', { className: 'difficulty-group', attrs: { role: 'radiogroup', 'aria-label': 'Difficulty' } });
  for (const difficulty of DIFFICULTIES) {
    const input = el('input', { attrs: { type: 'radio', name: 'difficulty', value: difficulty } });
    if (difficulty === chosen) input.checked = true;
    input.addEventListener('change', () => {
      chosen = difficulty;
    });
    group.append(el('label', { className: 'difficulty-option', children: [input, difficulty] }));
  }

  const start = labelledButton('Start rack', () => navigate(`/practice/table?difficulty=${encodeURIComponent(chosen)}`), {
    className: 'button primary',
  });

  const snapshot = readSnapshot();
  const resumeRegion = el('div', { className: 'resume-region', attrs: { role: 'region', 'aria-label': 'Unfinished rack' } });
  if (snapshot) {
    resumeRegion.append(
      el('p', { className: 'notice', text: PLAY_COPY.practiceResume }),
      labelledButton(
        'Resume rack',
        () => navigate(`/practice/table?difficulty=${encodeURIComponent(snapshot.difficulty)}&resume=1`),
        { className: 'button' },
      ),
      labelledButton(
        'New rack',
        () => {
          clearSnapshot();
          navigate(`/practice/table?difficulty=${encodeURIComponent(chosen)}`);
        },
        { className: 'button quiet' },
      ),
    );
  } else {
    resumeRegion.hidden = true;
  }

  return {
    element: el('div', {
      className: 'practice-setup',
      children: [
        el('h1', { className: 'screen-heading', text: 'Practice Offline', attrs: { tabindex: '-1' } }),
        group,
        start,
        resumeRegion,
      ],
    }),
  };
}
