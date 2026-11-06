import { ApiFailure, api, type RecordView } from '../api.js';
import { EMPTY_COPY, FIELD_COPY, PENDING_COPY, RECORD_COPY, SUCCESS_COPY, refusalCopy } from '../copy.js';
import { clear, el, groupNumber, liveRegion, say } from '../dom.js';
import { navigate, type Page } from '../router.js';
import { currentAccount } from '../session.js';
import { signInHref } from '../chrome.js';
import { instantDayClockLabel } from '../venueTime.js';
import { startLiveRefresh } from '../live.js';
import { errorSummary } from '../components/form.js';

export function recordPage(): Page {
  const element = el('main', { class: 'page page-record', id: 'main' });
  const contestRegion = liveRegion('Contest messages');
  const stateArea = el('div', { class: 'record-state' });
  let state: RecordView | null = null;

  function guessForm(): HTMLFormElement {
    const input = el('input', { class: 'text-input', id: 'guess-value', type: 'text', inputmode: 'numeric' });
    const fieldError = el('p', { class: 'field-error', id: 'guess-error' });
    const summary = errorSummary();
    const form = el('form', { class: 'stack-form', novalidate: true }, [
      summary.element,
      el('div', { class: 'field' }, [
        el('label', { for: 'guess-value', text: 'Your guess' }),
        input,
        fieldError,
      ]),
      el('button', { class: 'button button-primary', type: 'submit', text: 'Submit your guess' }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (currentAccount() === null) {
        navigate(signInHref());
        return;
      }
      const typed = input.value.trim();
      const value = Number(typed);
      if (!/^\d+$/.test(typed) || !Number.isInteger(value) || value < 1 || value > 100_000_000) {
        fieldError.textContent = FIELD_COPY.guess;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'guess-error');
        summary.show([{ id: 'guess-value', message: FIELD_COPY.guess }]);
        return;
      }
      fieldError.textContent = '';
      input.removeAttribute('aria-invalid');
      summary.hide();
      void (async () => {
        say(contestRegion, PENDING_COPY.guess);
        try {
          await api.guess(value);
          say(contestRegion, SUCCESS_COPY.guess);
          await load();
        } catch (error) {
          say(contestRegion, refusalCopy(error instanceof ApiFailure ? error.code : 'outage'));
          await load();
        }
      })();
    });
    return form;
  }

  function ownGuess(current: RecordView): HTMLElement | null {
    if (current.my_guess === null) return null;
    return el('p', { class: 'own-guess', text: `Your guess: ${groupNumber(current.my_guess.value)} TPS` });
  }

  function leaderboard(current: RecordView): HTMLElement {
    if (current.leaderboard.length === 0) return el('p', { class: 'empty-line', text: EMPTY_COPY.noGuesses });
    return el('table', { class: 'leaderboard', 'aria-label': 'Closest guesses' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Rank' }),
          el('th', { scope: 'col', text: 'Name' }),
          el('th', { scope: 'col', text: 'Guess' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        current.leaderboard.map((leader) =>
          el('tr', {}, [
            el('td', { text: String(leader.rank) }),
            el('td', { text: leader.display_name }),
            el('td', { text: groupNumber(leader.value) }),
          ]),
        ),
      ),
    ]);
  }

  function paint(): void {
    if (state === null) return;
    clear(stateArea);
    if (state.status === 'open') {
      stateArea.appendChild(
        el('p', {
          class: 'closing-line',
          text: `Guessing closes ${instantDayClockLabel(state.closes_at)} Port Ashby time.`,
        }),
      );
      const mine = ownGuess(state);
      stateArea.appendChild(mine ?? guessForm());
      return;
    }
    if (state.status === 'closed') {
      const mine = ownGuess(state);
      if (mine !== null) stateArea.appendChild(mine);
      stateArea.appendChild(el('p', { class: 'closed-line', text: RECORD_COPY.closed }));
      return;
    }
    const mine = ownGuess(state);
    if (mine !== null) stateArea.appendChild(mine);
    stateArea.appendChild(
      el('p', { class: 'final-figure', text: `Final figure: ${groupNumber(state.final_figure ?? 0)} TPS` }),
    );
    stateArea.appendChild(leaderboard(state));
  }

  async function load(): Promise<void> {
    state = await api.record();
    paint();
  }

  let stopLive: (() => void) | null = null;

  return {
    element,
    mount: () => {
      element.appendChild(el('p', { class: 'loading', text: 'Loading' }));
      void (async () => {
        try {
          await load();
        } catch {
          state = null;
        }
        element.replaceChildren(
          el('h1', { class: 'record-headline', text: RECORD_COPY.headline }),
          el('p', { class: 'record-body', text: RECORD_COPY.body }),
          el('h2', { class: 'record-title', text: RECORD_COPY.title }),
          el('p', { class: 'record-description', text: RECORD_COPY.description }),
          el('ul', { class: 'prize-list' }, RECORD_COPY.prizes.map((prize) => el('li', { text: prize }))),
          contestRegion,
          stateArea,
        );
        paint();
        stopLive = startLiveRefresh(async () => {
          if (stateArea.querySelector('form') !== null && stateArea.contains(document.activeElement)) return;
          await load();
        });
      })();
    },
    unmount: () => stopLive?.(),
  };
}
