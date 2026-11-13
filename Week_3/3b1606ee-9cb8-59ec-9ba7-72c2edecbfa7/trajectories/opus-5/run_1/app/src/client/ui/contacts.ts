import type { LookupRecord } from '../../shared/types.js';
import { copy, say } from '../copy.js';
import { api, ApiFailure } from '../data/api.js';
import { conversationList, peerName, state } from '../data/store.js';
import { contactAvatar } from './avatar.js';
import { button, el, field, plainAvatar, sheet, withBusy } from './dom.js';
import { announce } from './live.js';
import { openConversationFor } from './contactcard.js';

function focusComposerSoon(): void {
  window.setTimeout(() => {
    document
      .querySelector<HTMLTextAreaElement>('textarea[aria-label="Write a letter"]')
      ?.focus();
  }, 0);
}

export function contactsScreen(): HTMLElement {
  const pane = el('div', { class: 'list-screen' });
  const { outer, inner } = sheet({ class: 'form-sheet' });

  const input = el('input', {
    attrs: { type: 'text', 'aria-label': 'Find by username', autocomplete: 'off', spellcheck: 'false' },
  });
  const status = el('p', {
    class: 'lookup-status',
    attrs: { role: 'status', 'aria-label': 'Lookup status' },
  });
  const result = el('section', {
    class: 'lookup-result',
    attrs: { role: 'region', 'aria-label': 'Lookup result', tabindex: '-1' },
  });
  const find = button('Find', () => void run(), { class: 'ink-button' });

  async function run(): Promise<void> {
    await withBusy(find, async () => {
      const username = input.value.trim().toLowerCase();
      if (username === '') return;
      try {
        const found = await api.lookup(username);
        showFound(found);
        status.textContent = say.found(found.username);
        announce(say.found(found.username));
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        result.replaceChildren(el('p', { class: 'not-found', text: copy.lookupNotFound }));
        status.textContent = copy.lookupNotFound;
        announce(copy.lookupNotFound);
      }
      result.focus();
    });
  }

  function showFound(found: LookupRecord): void {
    const write = button('Write a letter', () => {
      void withBusy(write, async () => {
        await openConversationFor(found.id);
        focusComposerSoon();
      });
    }, { class: 'ink-button' });
    result.replaceChildren(
      el('div', { class: 'lookup-card' }, [
        plainAvatar(),
        el('p', { class: 'card-username', text: found.username }),
        write,
      ]),
    );
  }

  const form = el('form', { class: 'lookup-form', on: { submit: (event) => {
    event.preventDefault();
    void run();
  } } }, [field('Find by username', input), find]);

  inner.append(el('div', { class: 'form-panel' }, [form, status, result]));
  pane.append(outer);

  const contacts = conversationList('accepted');
  if (contacts.length === 0) {
    const { outer: emptyOuter, inner: emptyInner } = sheet({ class: 'empty-sheet' });
    emptyInner.append(
      el('p', { class: 'empty-copy', testid: 'empty-state', text: copy.empty.contacts }),
    );
    pane.append(emptyOuter);
    return pane;
  }

  pane.append(
    el(
      'ul',
      { class: 'rows', attrs: { role: 'list', 'aria-label': 'Contacts' } },
      contacts.map((record) =>
        el('li', { class: 'row' }, [
          el(
            'a',
            {
              class: 'row-link',
              data: { conversationId: record.id },
              attrs: { href: `/letters/${record.id}` },
            },
            [
              el('span', { class: 'row-plate' }, [
                contactAvatar(state.peerProfiles.get(record.peer.id) ?? null),
              ]),
              el('span', { class: 'row-body' }, [
                el('span', { class: 'row-name', text: peerName(record) }),
                el('span', { class: 'row-line', text: record.peer.username }),
              ]),
            ],
          ),
        ]),
      ),
    ),
  );
  return pane;
}
