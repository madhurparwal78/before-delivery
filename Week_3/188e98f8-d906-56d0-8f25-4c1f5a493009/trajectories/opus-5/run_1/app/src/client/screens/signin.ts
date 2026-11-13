/** The sign-in card. */

import { deskPath, isRole } from '../../shared/desk.js';
import type { SessionBody } from '../../shared/model.js';
import { ask, tookSignedOutCopy } from '../api.js';
import { COPY } from '../copy.js';
import { el, focusOn } from '../dom.js';
import type { DeskMessages } from '../messages.js';
import type { PollState, Screen } from './screen.js';

export function signInScreen(messages: DeskMessages): Screen {
  const code = el('input', { type: 'text', id: 'desk-code', class: 'field', 'aria-label': 'Desk code', autocomplete: 'off' });
  const submit = el('button', { type: 'submit', class: 'button' }, ['Sign in']);
  const form = el('form', { class: 'sign-in-form', 'aria-label': 'Sign in' }, [
    el('label', { class: 'field-label', for: 'desk-code' }, ['Desk code']),
    code,
    submit,
  ]);
  const card = el('section', { class: 'card sign-in-card' }, [form]);
  const root = el('div', { class: 'screen screen-sign-in' }, [messages.region, card]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    messages.pending(COPY.signInPending);
    void (async () => {
      const outcome = await ask<SessionBody>({
        method: 'POST',
        path: '/api/session',
        body: { code: code.value },
        publicRead: true,
      });
      if (!outcome.ok) {
        messages.result(outcome.status === 401 ? COPY.badCode : COPY.unreachable);
        return;
      }
      if (isRole(outcome.data.role)) window.location.assign(deskPath(outcome.data.role));
    })();
  });

  return {
    root,
    signOut: null,
    land: () => {
      if (tookSignedOutCopy()) messages.result(COPY.signedOut);
      focusOn(code);
    },
    poll: async (_state: PollState) => {
      /* the sign-in card shows no server state beyond the round strip */
    },
  };
}
