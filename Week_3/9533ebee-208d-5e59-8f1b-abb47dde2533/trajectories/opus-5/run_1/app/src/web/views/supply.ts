/**
 * The Supply view. Every 5-second refresh updates the pool cards, Your shares
 * and Share value in place, and never touches the typed values, the chosen
 * pool, a field error, focus, the caret or the last announcement.
 */

import { ASSET_CODES, type Asset } from '../../domain/assets.ts';
import { formatAmount, formatShares } from '../../domain/deskformat.ts';
import { ApiProblem, request } from '../api.ts';
import { el, labelled, setText } from '../dom.ts';
import { applyFieldErrors, button, Field, whilePending } from '../parts/fields.ts';
import type { LiveRegions } from '../parts/live.ts';
import { store } from '../store.ts';
import type { SettlementDto, SupplyDto } from '../types.ts';
import { freshKey, type View } from './view.ts';

export function supplyView(live: LiveRegions, navigate: (path: string) => void): View {
  const chooser = el('select', { class: 'chooser', 'aria-label': 'Pool' });
  for (const asset of ASSET_CODES) {
    chooser.append(el('option', { value: asset, text: asset }));
  }

  const chosen = (): Asset => chooser.value as Asset;
  const supplyAmount = new Field('Supply amount', {
    kind: 'amount',
    decimals: () => store.decimalsOf(chosen()),
  });
  const withdrawAmount = new Field('Withdraw amount', {
    kind: 'amount',
    decimals: () => store.decimalsOf(chosen()),
  });
  const supplyButton = button('Supply');
  const withdrawButton = button('Withdraw');
  supplyAmount.submitsWith(supplyButton);
  withdrawAmount.submitsWith(withdrawButton);

  const shares = labelled('Your shares');
  const shareValue = labelled('Share value');

  // One key per withdrawal, reused while the inputs are unchanged.
  let withdrawKey = freshKey();
  let withdrawSignature = '';

  async function doSupply(): Promise<void> {
    if (!supplyAmount.validate() || !supplyAmount.ready) {
      supplyAmount.focus();
      return;
    }
    const asset = chosen();
    const units = amountUnits(supplyAmount.value, store.decimalsOf(asset));
    live.clearProblems();
    live.announce('Supplying');
    await whilePending(supplyButton, async () => {
      const reply = await request<SupplyDto>('POST', `/api/pools/${asset}/supplies`, {
        token: store.token,
        body: { amount: units },
      });
      live.announce(
        `Supplied ${formatAmount(BigInt(reply.amount), store.decimalsOf(asset))} ${asset} for ${formatShares(BigInt(reply.shares_minted))} shares.`,
      );
      supplyAmount.value = '';
      await store.refresh();
    }).catch((error: unknown) => handle(error, [{ name: 'amount', field: supplyAmount }]));
  }

  async function doWithdraw(): Promise<void> {
    if (!withdrawAmount.validate() || !withdrawAmount.ready) {
      withdrawAmount.focus();
      return;
    }
    const asset = chosen();
    const units = amountUnits(withdrawAmount.value, store.decimalsOf(asset));
    // Pressing the same button again with unchanged inputs reuses the key.
    const signature = `${asset}|${units}`;
    if (signature !== withdrawSignature) {
      withdrawSignature = signature;
      withdrawKey = freshKey();
    }
    live.clearProblems();
    live.announce('Withdrawing');
    await whilePending(withdrawButton, async () => {
      const reply = await request<SettlementDto>('POST', `/api/pools/${asset}/withdrawals`, {
        token: store.token,
        body: { amount: units },
        idempotencyKey: withdrawKey,
      });
      live.announce(
        `Withdrew ${formatAmount(BigInt(reply.amount), store.decimalsOf(asset))} ${asset}.`,
        { href: `/settlements/${reply.settlement_id}`, label: 'View receipt' },
      );
      withdrawAmount.value = '';
      withdrawSignature = '';
      await store.refresh();
    }).catch((error: unknown) => handle(error, [{ name: 'amount', field: withdrawAmount }]));
  }

  function handle(error: unknown, fields: ReadonlyArray<{ name: string; field: Field }>): void {
    if (error instanceof ApiProblem && error.status === 422) {
      live.validation(applyFieldErrors(fields, error.errors));
      return;
    }
    live.report(error);
  }

  supplyButton.addEventListener('click', () => void doSupply());
  withdrawButton.addEventListener('click', () => void doWithdraw());

  const element = el('section', { class: 'worksheet-body' }, [
    el('h1', { class: 'view-head', text: 'Supply' }),
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Pool', for: 'pool-chooser' }),
      chooser,
    ]),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'form-block' }, [supplyAmount.row, supplyButton]),
      el('div', { class: 'form-block' }, [withdrawAmount.row, withdrawButton]),
    ]),
    el('div', { class: 'holdings' }, [shares.row, shareValue.row]),
  ]);
  chooser.id = 'pool-chooser';

  function update(): void {
    const asset = chosen();
    const holding = store.wallet?.lp_holdings.find((entry) => entry.asset === asset);
    setText(shares.value, formatShares(BigInt(holding?.shares ?? '0')));
    setText(
      shareValue.value,
      formatAmount(BigInt(holding?.value ?? '0'), store.decimalsOf(asset)),
    );
  }

  chooser.addEventListener('change', update);

  return { element, update, navigateAway: () => undefined, onPost: () => undefined, navigate };
}

/** The minor units an amount field holds, for the asset's decimals. */
export function amountUnits(text: string, decimals: number): string {
  const trimmed = text.trim().split('\u202F').join('');
  const [whole = '0', fraction = ''] = trimmed.split(',');
  const scaled =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  return scaled.toString();
}
