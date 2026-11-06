/** Staff sign-in, shared staff chrome and the restatement list. */
import {
  createRestatement,
  deleteSessionRequest,
  getSessionUser,
  listRestatements,
  postSession,
} from './api';
import { STAFF_COPY } from './copy';
import { clear, element, setText } from './dom';
import { newYorkFields } from './format';
import { RestatementPayload, StaffUserPayload } from './types';

export interface StaffChrome {
  main: HTMLElement;
  updates: HTMLElement;
}

export function staffChrome(root: HTMLElement, user: StaffUserPayload): StaffChrome {
  const signOut = element('button', {
    className: 'staff-signout',
    text: 'Sign out',
    attributes: { type: 'button' },
  });
  signOut.addEventListener('click', () => {
    void deleteSessionRequest().then(() => {
      window.location.assign('/staff');
    });
  });
  const updates = element('div', {
    className: 'staff-updates',
    attributes: { role: 'status', 'aria-label': 'Staff updates', 'aria-live': 'polite' },
  });
  const main = element('main', { className: 'staff-main' });
  root.appendChild(
    element('header', {
      className: 'site-header staff-header',
      children: [
        element('p', { className: 'site-wordmark', text: 'Tracewell' }),
        element('p', { className: 'staff-user', text: user.name }),
        signOut,
      ],
    }),
  );
  root.appendChild(updates);
  root.appendChild(main);
  return { main, updates };
}

export function mountSignIn(root: HTMLElement): void {
  const status = element('div', {
    className: 'signin-status',
    attributes: { role: 'status', 'aria-live': 'polite' },
  });
  const email = element('input', {
    attributes: { type: 'email', id: 'staff-email', autocomplete: 'username' },
  });
  const password = element('input', {
    attributes: { type: 'password', id: 'staff-password', autocomplete: 'current-password' },
  });
  const submit = element('button', { text: 'Sign in', attributes: { type: 'submit' } });
  const form = element('form', {
    className: 'signin-form',
    children: [
      element('h1', { text: 'Tracewell staff' }),
      element('label', { text: 'Email', attributes: { for: 'staff-email' } }),
      email,
      element('label', { text: 'Password', attributes: { for: 'staff-password' } }),
      password,
      submit,
      status,
    ],
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const result = await postSession(email.value, password.value);
      if (result.kind === 'success') {
        window.location.assign('/staff/restatements');
        return;
      }
      setText(status, STAFF_COPY.signInFailed);
    })();
  });
  root.appendChild(element('main', { className: 'signin-main', children: [form] }));
  email.focus();

  void getSessionUser().then((result) => {
    if (result.kind === 'success') window.location.assign('/staff/restatements');
  });
}

const LIST_COLUMNS = ['Week ending', 'State', 'Preparer', 'Correction', 'Release or publication'] as const;

export function mountRestatementList(root: HTMLElement, user: StaffUserPayload): void {
  const chrome = staffChrome(root, user);
  const body = element('tbody', { attributes: { role: 'rowgroup' } });
  const table = element('table', {
    className: 'restatement-list',
    attributes: { role: 'table', 'aria-label': 'Restatements' },
    children: [
      element('thead', {
        attributes: { role: 'rowgroup' },
        children: [
          element('tr', {
            attributes: { role: 'row' },
            children: LIST_COLUMNS.map((column) =>
              element('th', { attributes: { scope: 'col', role: 'columnheader' }, text: column }),
            ),
          }),
        ],
      }),
      body,
    ],
  });
  chrome.main.appendChild(element('h1', { text: 'Weekly holdings restatements' }));

  let loaded: RestatementPayload[] = [];

  if (user.roles.includes('treasury_analyst')) {
    const weekly = element('button', {
      className: 'staff-action',
      text: 'New weekly draft',
      attributes: { type: 'button' },
    });
    const correction = element('button', {
      className: 'staff-action',
      text: 'Start correction',
      attributes: { type: 'button' },
    });
    weekly.addEventListener('click', () => {
      void create({});
    });
    correction.addEventListener('click', () => {
      const latest = loaded.find((candidate) => candidate.state === 'published');
      if (latest === undefined) {
        setText(chrome.updates, STAFF_COPY.unexpected);
        return;
      }
      void create({ supersedes: latest.id });
    });
    chrome.main.appendChild(
      element('div', { className: 'staff-actions', children: [weekly, correction] }),
    );
  }

  chrome.main.appendChild(table);

  async function create(payload: Record<string, unknown>): Promise<void> {
    const result = await createRestatement(payload);
    if (result.kind === 'success') {
      window.location.assign(`/staff/restatements/${result.value.restatement.id}`);
      return;
    }
    setText(chrome.updates, STAFF_COPY.unexpected);
  }

  function render(restatements: RestatementPayload[]): void {
    loaded = restatements;
    clear(body);
    for (const restatement of restatements) {
      const timing =
        restatement.published_at !== null
          ? `Published ${newYorkFields(restatement.published_at).date} ${newYorkFields(restatement.published_at).time} ET`
          : restatement.release_at !== null
            ? `Queued to ${newYorkFields(restatement.release_at).date} ${newYorkFields(restatement.release_at).shortTime} ET`
            : '';
      const link = element('a', {
        text: restatement.week_ending,
        attributes: { href: `/staff/restatements/${restatement.id}` },
      });
      body.appendChild(
        element('tr', {
          attributes: { role: 'row' },
          children: [
            element('td', { attributes: { role: 'cell', 'data-label': 'Week ending' }, children: [link] }),
            element('td', { attributes: { role: 'cell', 'data-label': 'State' }, text: restatement.state }),
            element('td', {
              attributes: { role: 'cell', 'data-label': 'Preparer' },
              text: restatement.prepared_by.name,
            }),
            element('td', {
              attributes: { role: 'cell', 'data-label': 'Correction' },
              text: restatement.supersedes === null ? 'No' : 'Yes',
            }),
            element('td', {
              attributes: { role: 'cell', 'data-label': 'Release or publication' },
              text: timing,
            }),
          ],
        }),
      );
    }
  }

  void listRestatements().then((result) => {
    if (result.kind === 'success') render(result.value.restatements);
    else setText(chrome.updates, STAFF_COPY.unexpected);
  });
}
