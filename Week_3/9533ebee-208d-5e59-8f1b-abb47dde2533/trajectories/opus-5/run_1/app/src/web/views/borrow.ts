/**
 * The Borrow view: opening a position and the member's own positions. After a
 * successful open, the new position link is the next Tab stop after Open
 * position, and focus stays on Open position.
 */

import { ASSET_CODES, type Asset } from '../../domain/assets.ts';
import { POSITION_STATE_LABEL } from '../../domain/copy.ts';
import { formatAmount, formatHealthFactor } from '../../domain/deskformat.ts';
import { ApiProblem, request } from '../api.ts';
import { clear, el, setText } from '../dom.ts';
import { applyFieldErrors, button, Field, whilePending } from '../parts/fields.ts';
import type { LiveRegions } from '../parts/live.ts';
import { store } from '../store.ts';
import type { PositionDto, PositionsDto } from '../types.ts';
import { amountUnits } from './supply.ts';
import type { View } from './view.ts';

export function borrowView(live: LiveRegions, navigate: (path: string) => void): View {
  const collateralAsset = el('select', { class: 'chooser', 'aria-label': 'Collateral asset' });
  const debtAsset = el('select', { class: 'chooser', 'aria-label': 'Borrow asset' });
  for (const asset of ASSET_CODES) {
    collateralAsset.append(el('option', { value: asset, text: asset }));
    debtAsset.append(el('option', { value: asset, text: asset }));
  }
  collateralAsset.value = 'MBTC';
  debtAsset.value = 'QUSD';
  collateralAsset.id = 'collateral-asset';
  debtAsset.id = 'borrow-asset';

  const collateralAmount = new Field('Collateral amount', {
    kind: 'amount',
    decimals: () => store.decimalsOf(collateralAsset.value as Asset),
  });
  const openButton = button('Open position');
  collateralAmount.submitsWith(openButton);

  const list = el('ul', { class: 'position-list', 'aria-label': 'My positions' });
  list.setAttribute('role', 'list');

  let positions: readonly PositionDto[] = [];

  openButton.addEventListener('click', () => void open());

  async function open(): Promise<void> {
    if (!collateralAmount.validate() || !collateralAmount.ready) {
      collateralAmount.focus();
      return;
    }
    const asset = collateralAsset.value as Asset;
    live.clearProblems();
    live.announce('Opening position');
    try {
      await whilePending(openButton, async () => {
        const reply = await request<PositionDto>('POST', '/api/positions', {
          token: store.token,
          body: {
            collateral_asset: asset,
            debt_asset: debtAsset.value,
            collateral_amount: amountUnits(collateralAmount.value, store.decimalsOf(asset)),
          },
        });
        live.announce(
          `Position opened with ${formatAmount(BigInt(reply.collateral_amount), store.decimalsOf(asset))} ${asset} collateral.`,
        );
        collateralAmount.value = '';
        await Promise.all([store.refresh(), load()]);
        // Focus stays on Open position; the new link follows it in the order.
        openButton.focus();
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        live.validation(
          applyFieldErrors(
            [{ name: 'collateral_amount', field: collateralAmount }],
            error.errors,
          ),
        );
      } else {
        live.report(error);
      }
    }
  }

  async function load(): Promise<void> {
    if (store.member === null) return;
    const reply = await request<PositionsDto>('GET', '/api/positions', { token: store.token });
    positions = reply.positions.filter(
      (position) => position.borrower_id === store.member?.actor_id,
    );
    render();
  }

  function render(): void {
    const wanted = positions.map((position) => position.position_id).join(',');
    if (list.dataset['ids'] !== wanted) {
      list.dataset['ids'] = wanted;
      clear(list);
      for (const position of positions) {
        const link = el('a', {
          href: `/positions/${position.position_id}`,
          'data-route': 'true',
          text: `Position ${position.position_id}`,
        });
        const state = el('span', { class: 'state-label' });
        const health = el('span', { class: 'figure' });
        list.append(el('li', { 'data-position': position.position_id }, [link, state, health]));
      }
    }
    for (const position of positions) {
      const row = list.querySelector(`[data-position="${position.position_id}"]`);
      if (row === null) continue;
      const state = row.querySelector('.state-label');
      const health = row.querySelector('.figure');
      // The state label and health factor sit outside the link's name.
      if (state !== null) {
        setText(state, POSITION_STATE_LABEL[position.state]);
        state.className = `state-label state-${position.state}`;
      }
      if (health !== null) setText(health, formatHealthFactor(position.health_factor));
    }
  }

  const element = el('section', { class: 'worksheet-body' }, [
    el('h1', { class: 'view-head', text: 'Borrow' }),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Collateral asset', for: 'collateral-asset' }),
        collateralAsset,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Borrow asset', for: 'borrow-asset' }),
        debtAsset,
      ]),
    ]),
    collateralAmount.row,
    openButton,
    el('h2', { class: 'zone-head', text: 'My positions' }),
    list,
  ]);

  void load();

  return {
    element,
    update: () => void load().catch(() => undefined),
    navigateAway: () => undefined,
    onPost: () => undefined,
    navigate,
  };
}
