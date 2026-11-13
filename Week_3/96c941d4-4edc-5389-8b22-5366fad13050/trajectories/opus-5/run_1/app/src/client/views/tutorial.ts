import { CAMPAIGN, DEVICES } from '../../shared/constants.js';
import { button, h, region } from '../dom.js';
import { SUCCESS_COPY, feedback } from '../feedback.js';
import type { Shell } from '../shell.js';
import { activeSession, endSession, renderDefence, startDefenceSession } from './defence.js';

const STEPS = [
  'Select the Wickwarden from the crew rack, or press 1.',
  'Move the chart selection into an active lane and press Enter to open Placement.',
  'Use Preview to read the Lantern Cast forecast, then Place to confirm.',
  'Watch the practice encounter reach its local outcome. Practice submits no ranked result.',
];

export function renderTutorial(shell: Shell): void {
  const active = activeSession();
  const instructions = region('Tutorial instructions', 'panel paper', [
    h('h2', {}, ['Tutorial instructions']),
    h('p', {}, [
      active === null
        ? 'Begin practice to learn placement, forecasting and charge without creating verified progress.'
        : (shell.state.tutorialStep === '' ? STEPS[0] : shell.state.tutorialStep),
    ]),
    h(
      'ol',
      { class: 'practice-steps' },
      STEPS.map((step) => h('li', {}, [step])),
    ),
    h('p', {}, [
      shell.state.tutorialComplete
        ? SUCCESS_COPY.practice
        : 'Practice has no ticket and cannot affect campaign progress.',
    ]),
    h('div', { class: 'actions-row' }, [
      button('Begin practice', () => {
        shell.state.tutorialComplete = false;
        shell.state.tutorialStep = STEPS[0];
        startDefenceSession(shell, null, CAMPAIGN[0].definition, 'practice');
      }),
      button('Finish practice', () => {
        endSession();
        shell.state.tutorialComplete = true;
        feedback.succeed(SUCCESS_COPY.practice);
        shell.render();
      }),
      button('Restart practice', () => {
        endSession();
        shell.state.tutorialComplete = false;
        shell.state.tutorialStep = STEPS[0];
        startDefenceSession(shell, null, CAMPAIGN[0].definition, 'practice');
      }),
    ]),
  ]);

  shell.main.append(instructions);
  if (active === null) {
    shell.main.append(
      h('div', { class: 'panel paper' }, [
        h('h3', {}, ['Practice crew']),
        h(
          'ul',
          {},
          DEVICES.map((device) => h('li', {}, [`${device.name} — ${device.effect}`])),
        ),
      ]),
    );
    return;
  }
  renderDefence(shell);
}
