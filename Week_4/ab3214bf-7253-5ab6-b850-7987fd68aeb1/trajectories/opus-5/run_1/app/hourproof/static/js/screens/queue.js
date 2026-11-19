// The verifier's review queue.

import { get, post } from '../api.js';
import { Dialog } from '../dialog.js';
import { announce, clear, el } from '../dom.js';
import { linkTo } from '../router.js';
import { countdown, sharedWindowsReask } from '../timers.js';

const ORDER = ['In review', 'Cancelling', 'Cancelled', 'Signed'];

export async function mount({ container, account }) {
  const body = el('tbody');
  const table = el('table', { 'aria-label': 'Review queue' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Window' }),
        el('th', { scope: 'col', text: 'State' }),
        el('th', { scope: 'col', text: 'Recorded' }),
        el('th', { scope: 'col', text: 'Review time' }),
      ]),
    ]),
    body,
  ]);
  const empty = el('p', { className: 'word', text: 'NO WINDOWS TO REVIEW.', hidden: true });
  const replace = el('button', { type: 'button', text: 'Replace signing key' });
  replace.addEventListener('click', () => {
    const dialog = new Dialog({ name: 'Replace signing key' });
    dialog.bodyNode.append(
      el('p', { text: 'A new key signs from now on. Earlier statements keep their key.' })
    );
    const confirm = el('button', { type: 'button', text: 'Replace key' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    confirm.addEventListener('click', async () => {
      const answer = await post(`/api/firms/${account.firm_id}/keys/rotate`, {});
      if (answer.cancelled) return;
      if (answer.status !== 200) return;
      dialog.close();
      announce('Desk status', 'Signing key replaced. Earlier statements still check.');
    });
    cancel.addEventListener('click', () => dialog.close());
    dialog.buttonsNode.append(confirm, cancel);
  });
  container.append(
    el('div', { className: 'panel panel--cyan stack' }, [
      el('h1', { text: 'YOUR REVIEW QUEUE.' }),
      replace,
      el('div', { className: 'table-wrap' }, [table]),
      empty,
    ])
  );

  async function load() {
    const answer = await get('/api/windows');
    if (answer.status !== 200) return;
    await paint(answer.data.windows);
  }

  async function paint(windows) {
    const rows = windows
      .filter((row) => ORDER.includes(row.state))
      .sort((left, right) => {
        const byState = ORDER.indexOf(left.state) - ORDER.indexOf(right.state);
        if (byState !== 0) return byState;
        if (left.month !== right.month) return left.month < right.month ? -1 : 1;
        return left.id < right.id ? -1 : 1;
      });
    const counts = await Promise.all(
      rows.map(async (row) => {
        const sample = await get(`/api/windows/${row.id}/sample`);
        if (sample.status !== 200) return 0;
        return sample.data.hours.filter((hour) => hour.result !== null).length;
      })
    );
    clear(body);
    rows.forEach((row, index) => {
      const timerCell = el('td', {});
      if (row.state === 'In review') {
        const timer = countdown({
          label: 'Review time left',
          seconds: row.review_seconds_left,
          reask: () =>
            sharedWindowsReask((answer) => {
              if (answer.status === 200) paint(answer.data.windows);
            }),
        });
        timerCell.append(timer.node);
      }
      body.append(
        el('tr', {}, [
          el('td', {}, [linkTo(`/review/${row.id}`, `${row.site.name} ${row.month}`)]),
          el('td', { text: row.state }),
          el('td', { text: `${counts[index]} of 25 recorded` }),
          timerCell,
        ])
      );
    });
    empty.hidden = rows.length > 0;
  }

  await load();
  return { refresh: load };
}
