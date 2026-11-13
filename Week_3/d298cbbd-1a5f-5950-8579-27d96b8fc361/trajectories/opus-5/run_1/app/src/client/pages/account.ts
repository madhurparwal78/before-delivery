import { api, type AccountResponse } from '../api.js';
import { percent, two, utcDate } from '../copy.js';
import { el } from '../dom.js';
import type { Page } from '../router.js';
import { heading } from '../shell.js';

export class AccountPage implements Page {
  async render(container: HTMLElement): Promise<void> {
    container.textContent = '';
    const folder = el('div', { class: 'folder open' });
    container.append(folder);
    const response = await api.get<AccountResponse>('/api/account');
    if (response.status !== 200 || !response.body) {
      folder.append(
        heading(1, 'Account'),
        el('p', {}, ['Sign in to see your account.']),
        el('a', { href: '/signin', class: 'link' }, ['Sign in']),
      );
      return;
    }
    const account = response.body;
    folder.append(
      heading(1, 'Account'),
      el('p', {}, [`${account.name} (${account.email})`]),
      el('p', { id: 'tests-counted', class: 'counted-total' }, [
        `Tests counted ${account.testsCounted}`,
      ]),
    );
    const table = el('table', { class: 'data-table' });
    table.append(el('caption', {}, ['Personal bests']));
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col' }, ['Mode']),
          el('th', { scope: 'col' }, ['Length']),
          el('th', { scope: 'col' }, ['Punctuation']),
          el('th', { scope: 'col' }, ['Numbers']),
          el('th', { scope: 'col' }, ['Speed']),
          el('th', { scope: 'col' }, ['Accuracy']),
          el('th', { scope: 'col' }, ['Date']),
        ]),
      ]),
    );
    const body = el('tbody');
    for (const best of account.personalBests) {
      body.append(
        el('tr', {}, [
          el('td', {}, [best.mode]),
          el('td', {}, [best.length === null ? '-' : String(best.length)]),
          el('td', {}, [best.punctuation ? 'on' : 'off']),
          el('td', {}, [best.numbers ? 'on' : 'off']),
          el('td', {}, [two(best.speed)]),
          el('td', {}, [percent(best.accuracy)]),
          el('td', {}, [utcDate(best.finishedAt)]),
        ]),
      );
    }
    table.append(body);
    folder.append(table);
  }
}
