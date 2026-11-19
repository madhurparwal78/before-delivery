// An account page: its figures, its own feed and its monthly statement.

import { el, setBusy, clearBusy, isBusy } from '../dom.js';
import * as api from '../api.js';
import * as router from '../router.js';
import * as session from '../session.js';
import { announce } from '../status.js';
import { money, monthLabel, addMonths } from '../format.js';
import * as data from './data.js';
import { createFeed } from './feed.js';
import { filtersFromQuery, addressFor } from './home.js';

function filenameFrom(headers, fallback) {
  const disposition = headers ? headers.get('content-disposition') || '' : '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch (error) {
      /* fall through to the ascii name */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain ? plain[1] : fallback;
}

export const account = {
  title: 'Account — Tallwind',
  async render(context) {
    const accountId = context.params.accountId;
    if (!data.state.snapshot) await data.refreshMoney();
    if (!data.state.me) await data.refreshMe();

    const found = data.accountById(accountId);
    if (!found) {
      // An account the company does not own is unknown: fall back to the cockpit.
      router.navigate('/app', { replace: true });
      return el('div', {});
    }
    session.setLastAccount(accountId);

    const { filters, dropped } = filtersFromQuery(context.query, data.state.accounts, { allowAccount: false });
    if (dropped || context.query.has('account')) {
      router.setAddress(addressFor(`/app/accounts/${accountId}`, filters), { replace: true });
    }

    const balance = el('p', { class: 'snap-figure mono' });
    const available = el('p', { class: 'snap-available mono' });

    function paint() {
      const figures = data.perAccount(accountId);
      const current = data.accountById(accountId) || found;
      balance.textContent = money(figures ? figures.balance_cents : current.balance_cents);
      available.textContent = `Available ${money(figures ? figures.available_cents : current.available_cents)}`;
    }

    const businessMonth = (data.state.me ? data.state.me.business_date : '').slice(0, 7);
    const months = [];
    for (let back = 0; back < 12; back += 1) months.push(addMonths(businessMonth, -back));
    const monthSelect = el(
      'select',
      { id: 'statement-month', 'aria-label': 'Statement month' },
      months.map((month) => el('option', { value: month, text: monthLabel(month) }))
    );
    monthSelect.value = months[0];

    const download = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Download statement' });
    download.addEventListener('click', async () => {
      if (isBusy(download)) return;
      setBusy(download, 'Preparing statement…');
      announce('Preparing statement…');
      const answer = await api.request(
        'GET',
        `/api/accounts/${accountId}/statement.csv?month=${encodeURIComponent(monthSelect.value)}`,
        { raw: true }
      );
      clearBusy(download);
      if (answer.status !== 200 || !answer.blob) {
        announce(api.isOutage(answer) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
        return;
      }
      const name = filenameFrom(answer.headers, `${found.name}-statement-${monthSelect.value}.csv`);
      const url = URL.createObjectURL(answer.blob);
      const link = el('a', { href: url, download: name });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      announce('Statement downloaded');
    });

    const feed = createFeed({
      accountId,
      accounts: data.state.accounts,
      showAccountFilter: false,
      filters,
      onFilterChange: (next) => {
        router.setAddress(addressFor(`/app/accounts/${accountId}`, next), { replace: false });
      },
    });

    const node = el('div', {}, [
      el('h1', { text: found.name }),
      el('div', { class: 'snap-card', style: 'max-width:420px' }, [
        el('p', { class: 'snap-label', text: 'Balance' }),
        balance,
        available,
      ]),
      el('div', { class: 'filter-bar', style: 'margin-top:1.5rem' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'statement-month', text: 'Statement month' }),
          monthSelect,
        ]),
        download,
      ]),
      el('h2', { text: 'Transactions' }),
      feed.node,
    ]);

    paint();
    feed.reload({ announceResult: true });

    const unsubscribe = data.subscribe((event) => {
      if (event.type === 'money' || event.type === 'recovered') paint();
      if (event.type === 'transaction' || event.type === 'recovered') feed.refresh();
    });
    const timer = setInterval(() => feed.refresh(), 10000);
    router.onCleanup(() => {
      unsubscribe();
      clearInterval(timer);
    });

    return node;
  },
};
