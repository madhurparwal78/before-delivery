/**
 * The operator console. Its two status lines follow the server; the Operator
 * status line changes only on this tab's own action.
 */
import { getClock, getTape, putClock, putTape } from './api';
import { OPERATOR_COPY, clockSetLine, marketClockLine, tapeLine } from './copy';
import { element, setText } from './dom';
import { newYorkFields } from './format';
import { parseWallStamp, toIso } from '../shared/nytime';
import { staffChrome } from './staff';
import { StaffUserPayload } from './types';

const POLL_MS = 3000;

export function mountOperator(root: HTMLElement, user: StaffUserPayload): void {
  const chrome = staffChrome(root, user);
  const tapeText = element('p', { className: 'operator-tape' });
  const clockText = element('p', { className: 'operator-clock' });
  const pause = element('button', {
    className: 'staff-action',
    text: 'Pause tape',
    attributes: { type: 'button' },
  });
  const resume = element('button', {
    className: 'staff-action',
    text: 'Resume tape',
    attributes: { type: 'button' },
  });
  const rehearsal = element('input', {
    attributes: { type: 'text', id: 'rehearsal-clock', placeholder: 'YYYY-MM-DD HH:MM:SS' },
  });
  const setClock = element('button', {
    className: 'staff-action',
    text: 'Set clock',
    attributes: { type: 'button' },
  });
  const useRealTime = element('button', {
    className: 'staff-action',
    text: 'Use real time',
    attributes: { type: 'button' },
  });
  const status = element('div', {
    className: 'operator-status',
    attributes: { role: 'status', 'aria-label': 'Operator status', 'aria-live': 'polite' },
  });

  chrome.main.appendChild(element('h1', { text: 'Operator console' }));
  chrome.main.appendChild(tapeText);
  chrome.main.appendChild(clockText);
  chrome.main.appendChild(element('div', { children: [pause, resume] }));
  chrome.main.appendChild(
    element('div', {
      className: 'field',
      children: [
        element('label', { text: 'Rehearsal clock', attributes: { for: 'rehearsal-clock' } }),
        rehearsal,
        setClock,
        useRealTime,
      ],
    }),
  );
  chrome.main.appendChild(status);

  async function poll(): Promise<void> {
    const tape = await getTape();
    if (tape.kind === 'success') setText(tapeText, tapeLine(tape.value.state, tape.value.position));
    const clock = await getClock();
    if (clock.kind === 'success') {
      const fields = newYorkFields(clock.value.now);
      setText(clockText, marketClockLine(fields.date, fields.time));
    }
  }

  pause.addEventListener('click', () => {
    void putTape('paused').then((result) => {
      if (result.kind === 'success') setText(status, OPERATOR_COPY.paused);
      void poll();
    });
  });
  resume.addEventListener('click', () => {
    void putTape('playing').then((result) => {
      if (result.kind === 'success') setText(status, OPERATOR_COPY.playing);
      void poll();
    });
  });
  setClock.addEventListener('click', () => {
    const instant = parseWallStamp(rehearsal.value);
    if (instant === null) {
      setText(status, OPERATOR_COPY.invalidTime);
      return;
    }
    const entered = newYorkFields(toIso(instant));
    void putClock(toIso(instant)).then((result) => {
      if (result.kind === 'success') setText(status, clockSetLine(entered.date, entered.time));
      void poll();
    });
  });
  useRealTime.addEventListener('click', () => {
    void putClock(null).then((result) => {
      if (result.kind === 'success') setText(status, OPERATOR_COPY.realTime);
      void poll();
    });
  });

  void poll();
  window.setInterval(() => {
    void poll();
  }, POLL_MS);
}
