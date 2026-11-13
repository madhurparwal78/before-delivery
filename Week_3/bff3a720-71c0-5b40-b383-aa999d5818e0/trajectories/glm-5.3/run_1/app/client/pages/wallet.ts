import { h, clear } from '../lib/els.js';
import { api, ApiFail } from '../lib/api.js';
import { announce } from '../lib/announce.js';
import { openDialog } from '../lib/dialog.js';
import { money, signedMoney } from '../lib/fmt.js';
import type { WalletLine } from '../lib/types.js';

export async function walletPage(): Promise<HTMLElement> {
  const root = h('div');
  const balanceEl = h('p', null, '');
  const list = h('ul', { role: 'list', 'aria-label': 'Wallet', class: 'list-plain' });
  const alertTarget = h('div');

  const render = async (): Promise<void> => {
    const data = await api<{ balance_cents: number; lines: WalletLine[] }>('GET', '/api/wallet');
    balanceEl.textContent = `Balance ${money(data.balance_cents)}`;
    clear(list);
    if (data.lines.length === 0) {
      list.append(h('li', null, 'No wallet movements yet.'));
      return;
    }
    for (const l of data.lines) {
      list.append(h('li', { 'data-id': l.id }, `${l.label} ${signedMoney(l.amount_cents)}`));
    }
  };

  const addMoney = (): void => {
    let amountEuros = 25;
    const spin = h('input', { type: 'number', class: 'field', min: '5', max: '200', step: '5', value: '25', 'aria-label': 'Amount in euros' }) as HTMLInputElement;
    spin.addEventListener('input', () => { amountEuros = Number(spin.value) || 25; });
    const add = h('button', {
      type: 'button', class: 'btn primary', 'data-autofocus': true,
      onClick: async () => {
        add.textContent = 'Working';
        try {
          await api('POST', '/api/wallet/top-ups', { amount_cents: Math.round(amountEuros * 100) });
          announce(`${money(Math.round(amountEuros * 100))} added to your wallet.`);
          dialog.close();
          await render();
        } catch (e) {
          if (e instanceof ApiFail) { alertTarget.append(h('div', { role: 'alert', class: 'alert' }, e.body.message)); add.textContent = 'Add to wallet'; }
        }
      },
    }, 'Add to wallet');
    const dialog = openDialog({ label: 'Add money' }, [h('label', null, 'Amount in euros'), spin, add, alertTarget]);
    void dialog;
  };

  const heading = h('h1', { tabindex: '-1' }, 'Wallet');
  root.append(heading, balanceEl, h('button', { type: 'button', class: 'btn primary', onClick: addMoney }, 'Add money'), list);
  await render();
  return root;
}
