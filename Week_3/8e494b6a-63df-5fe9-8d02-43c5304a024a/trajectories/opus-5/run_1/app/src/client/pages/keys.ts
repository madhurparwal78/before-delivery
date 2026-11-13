import { clear, el } from '../dom.js';
import { displayTime } from '../format.js';
import { announce, ApiFailure, get, write, zone } from '../state.js';
import { emptyBand, loadFailed, openDialog, showFormError } from '../widgets.js';

type KeyRow = {
  id: string;
  name: string;
  stream_pattern: string;
  actions: string[];
  expires_at: string | null;
  revoked: boolean;
  last4: string;
};

export async function renderKeys(main: HTMLElement): Promise<void> {
  let data: { keys: KeyRow[] };
  try {
    data = await get<{ keys: KeyRow[] }>('/api/keys');
  } catch {
    main.append(loadFailed(() => void renderKeys(main)));
    return;
  }
  const newKey = el('button', {
    type: 'button',
    'aria-label': 'New key',
    text: 'New key',
    class: 'primary',
  });
  newKey.addEventListener('click', () => openNewKey(newKey, main));
  main.append(el('h1', { class: 'view-title', text: 'Keys' }), newKey);
  if (data.keys.length === 0) {
    main.append(emptyBand('No API keys yet.', newKey));
    return;
  }
  main.append(
    el('table', { 'aria-label': 'Keys', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Name' }),
          el('th', { scope: 'col', text: 'Pattern' }),
          el('th', { scope: 'col', text: 'Actions' }),
          el('th', { scope: 'col', text: 'Expires' }),
          el('th', { scope: 'col', text: 'Key' }),
          el('th', { scope: 'col', text: 'Revoke' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.keys.map((key) => {
          const revoke = el('button', {
            type: 'button',
            'aria-label': `Revoke ${key.name}`,
            text: 'Revoke',
            disabled: key.revoked,
          });
          revoke.addEventListener('click', () => {
            revoke.setAttribute('aria-busy', 'true');
            void (async () => {
              await write('DELETE', `/api/keys/${key.id}`);
              announce(`Key ${key.name} revoked.`);
              clear(main);
              await renderKeys(main);
            })();
          });
          return el('tr', {}, [
            el('td', { text: key.name }),
            el('td', { class: 'mono', text: key.stream_pattern }),
            el('td', { class: 'mono', text: key.actions.join(', ') }),
            el('td', {
              class: 'mono',
              text: key.expires_at === null ? 'never' : displayTime(zone(), Date.parse(key.expires_at)),
            }),
            el('td', { class: 'mono', text: `...${key.last4}` }),
            el('td', {}, [revoke]),
          ]);
        }),
      ),
    ]),
  );
}

function openNewKey(opener: HTMLButtonElement, main: HTMLElement): void {
  openDialog({
    label: 'New key',
    opener,
    content: (dialog) => {
      const name = el('input', { type: 'text', 'aria-label': 'Key name', 'data-field': 'name' });
      const pattern = el('input', {
        type: 'text',
        'aria-label': 'Stream pattern',
        'data-field': 'stream_pattern',
        value: '*',
      });
      const actionGroup = el('div', { role: 'group', 'aria-label': 'Actions', class: 'checkbox-list' });
      const boxes = ['read', 'upload', 'manage'].map((action) => {
        const box = el('input', { type: 'checkbox', 'aria-label': action, value: action });
        actionGroup.append(el('label', { class: 'checkbox' }, [box, action]));
        return { box, action };
      });
      const expires = el('input', {
        type: 'text',
        'aria-label': 'Expires in (days)',
        'data-field': 'expires_in_days',
      });
      const create = el('button', {
        type: 'button',
        'aria-label': 'Create key',
        text: 'Create key',
        class: 'primary',
      });
      const host = el('div', {});
      const shown = el('div', {});
      create.addEventListener('click', () => {
        create.setAttribute('aria-busy', 'true');
        void (async () => {
          try {
            const created = await write<{ key: string }>('POST', '/api/keys', {
              name: name.value,
              stream_pattern: pattern.value,
              actions: boxes.filter((entry) => entry.box.checked).map((entry) => entry.action),
              expires_in_days: expires.value === '' ? null : Number(expires.value),
            });
            clear(shown);
            const value = el('input', {
              type: 'text',
              'aria-label': 'New key value',
              readonly: true,
              class: 'mono',
              value: created.key,
            });
            const done = el('button', { type: 'button', 'aria-label': 'Done', text: 'Done' });
            done.addEventListener('click', () => {
              dialog.close();
              void (async () => {
                clear(main);
                await renderKeys(main);
              })();
            });
            shown.append(value, el('p', { text: 'This key is shown once. Copy it now.' }), done);
            value.focus();
          } catch (cause) {
            if (cause instanceof ApiFailure) showFormError(host, cause);
          } finally {
            create.removeAttribute('aria-busy');
          }
        })();
      });
      return [
        el('h2', { text: 'New key' }),
        host,
        name,
        pattern,
        actionGroup,
        expires,
        create,
        shown,
      ];
    },
  });
}
