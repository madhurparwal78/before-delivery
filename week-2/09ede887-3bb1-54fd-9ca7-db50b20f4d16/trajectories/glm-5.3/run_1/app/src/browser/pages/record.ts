/**
 * The Call the number contest: the cut-off in Port Ashby time, one guess per
 * attendee before the cut-off, the caller's own guess, and after the reveal
 * the final figure and the three closest guesses.
 */

import * as api from '../api.js';
import { el, announce } from '../dom.js';
import { state } from '../state.js';
import { navigateToSignIn } from './auth-form.js';
import { route } from '../router.js';
import { grouped, venueStamp } from '../venue-display.js';

route(/^\/record$/, async () => {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);
  main.append(el('p', { class: 'loading' }, 'Loading'));

  const messages = el('p', { id: 'contest-messages', role: 'status', 'aria-live': 'polite', 'aria-label': 'Contest messages', class: 'live-region' });
  state.contestMessages = messages;

  const draw = async (): Promise<void> => {
    const record = await api.getRecord().catch(() => null);
    main.textContent = '';
    if (record === null) {
      main.append(el('p', { class: 'loading' }, 'Loading'));
      return;
    }
    const area = el('div', { class: 'record-state' });
    if (record.status === 'revealed') {
      if (record.my_guess !== null) {
        area.append(el('p', { class: 'own-guess' }, `Your guess: ${grouped(record.my_guess.value)} TPS`));
      }
      area.append(el('p', { class: 'final-figure' }, `Final figure: ${grouped(record.final_figure ?? 0)} TPS`));
      if (record.leaderboard.length === 0) {
        area.append(el('p', { class: 'empty-line' }, 'No guesses were submitted.'));
      } else {
        area.append(el('table', { class: 'details-table guess-table', 'aria-label': 'Closest guesses' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Rank'), el('th', {}, 'Name'), el('th', {}, 'Guess'))),
          el('tbody', {},
            ...record.leaderboard.map((leader) =>
              el('tr', {},
                el('td', {}, String(leader.rank)),
                el('td', {}, leader.display_name),
                el('td', {}, grouped(leader.value)),
              ),
            ),
          ),
        ));
      }
    } else if (record.status === 'closed') {
      if (record.my_guess !== null) {
        area.append(el('p', { class: 'own-guess' }, `Your guess: ${grouped(record.my_guess.value)} TPS`));
      }
      area.append(el('p', { class: 'closed-line' }, 'Guessing has closed. The result is coming soon.'));
    } else {
      area.append(el('p', { class: 'closing-line' },
        `Guessing closes ${venueStamp(record.closes_at)} Port Ashby time.`));
      if (state.account !== null && state.account.role === 'attendee') {
        if (record.my_guess !== null) {
          area.append(el('p', { class: 'own-guess' }, `Your guess: ${grouped(record.my_guess.value)} TPS`));
        } else {
          area.append(buildGuessForm(messages, draw));
        }
      } else if (state.account === null) {
        // A visitor sees the form too; submitting sends them to sign in.
        area.append(buildGuessForm(messages, draw));
      }
    }
    main.append(
      el('h1', { class: 'page-title' }, 'Call the number'),
      el('p', { class: 'record-headline' }, "Live at Keel Outpost, we're going after our own record."),
      el('p', { class: 'record-body' },
        'On July 4th we pushed the network to 6M+ transactions per second through a live experiment. On day one of Keel Outpost we run it again, live, on the main stage.'),
      el('p', { class: 'record-description' },
        'Submit one guess. Closest to the final figure takes first place.'),
      el('ul', { class: 'prizes', role: 'list' },
        el('li', {}, '1st Place 10,000 credits'),
        el('li', {}, '2nd Place 5,000 credits'),
        el('li', {}, '3rd Place 1,000 credits'),
      ),
      area,
      messages,
    );
  };
  await draw();
  state.refresh = draw;

});

function buildGuessForm(messages: HTMLElement, redraw: () => Promise<void>): HTMLElement {
  const summary = el('div', { class: 'error-summary', role: 'alert', hidden: true });
  const field = el('input', {
    type: 'number',
    'aria-label': 'Your guess',
    class: 'text-input guess-input',
    min: '1',
    max: '100000000',
    id: 'guess-field',
  });
  const message = el('p', { class: 'field-error', id: 'guess-error', hidden: true });
  field.setAttribute('aria-describedby', 'guess-error');
  const submit = el('button', { type: 'submit', class: 'action action-blue' }, 'Submit your guess');
  const form = el('form', { class: 'guess-form', novalidate: true }, summary, field, message, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.account === null) {
      navigateToSignIn();
      return;
    }
    summary.setAttribute('hidden', '');
    message.setAttribute('hidden', '');
    field.setAttribute('aria-invalid', 'false');
    const value = Number(field.value);
    if (!Number.isInteger(value) || value < 1 || value > 100000000) {
      const copy = 'Enter a whole number from 1 to 100,000,000.';
      message.textContent = copy;
      message.removeAttribute('hidden');
      field.setAttribute('aria-invalid', 'true');
      summary.textContent = '';
      summary.append(
        el('h2', { class: 'error-summary-heading' }, 'There is a problem'),
        el('a', { href: '#guess-field', class: 'error-link' }, copy),
      );
      summary.removeAttribute('hidden');
      return;
    }
    submit.setAttribute('aria-disabled', 'true');
    submit.classList.add('is-pending');
    announce(messages, 'Sending guess…');
    try {
      await api.submitGuess(value);
      announce(messages, 'Guess received. Good luck.');
      await redraw();
    } catch (err) {
      const failure = err instanceof api.ApiError ? err.failure : { code: 'unavailable', message: '' };
      const copy =
        failure.code === 'already_guessed'
          ? 'You have already submitted your guess.'
          : failure.code === 'contest_closed'
            ? 'Guessing has closed.'
            : 'Keel Outpost is not reachable right now. Try again in a moment.';
      announce(messages, copy);
      submit.setAttribute('aria-disabled', 'false');
      submit.classList.remove('is-pending');
    }
  });
  return form;
}
