/**
 * The position page. It shows debt, health factor, state and grace end
 * exactly as the server last returned them, refreshed every 5 seconds,
 * whatever the device clock says.
 */

import { POSITION_STATE_LABEL } from '../../domain/copy.ts';
import {
  formatAmount,
  formatHealthFactor,
  formatPriceFromApi,
} from '../../domain/deskformat.ts';
import { formatWallTime } from '../../domain/desktime.ts';
import { ApiProblem, request } from '../api.ts';
import { clear, el, labelled, setText } from '../dom.ts';
import { applyFieldErrors, button, Field, whilePending } from '../parts/fields.ts';
import type { LiveRegions } from '../parts/live.ts';
import { priceUnitsOf } from '../prices.ts';
import { ShockRuler } from '../parts/shockruler.ts';
import { store } from '../store.ts';
import type { PositionDto, PositionsDto, RepaymentDto, SettlementDto } from '../types.ts';
import { amountUnits } from './supply.ts';
import { freshKey, type View } from './view.ts';

export function positionView(
  positionId: string,
  live: LiveRegions,
  navigate: (path: string) => void,
): View {
  let position: PositionDto | null = null;
  let owned = false;

  const heading = el('h1', { class: 'view-head', text: `Position ${positionId}` });
  const stateRegion = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Position state',
    class: 'state-region',
  });
  const plumb = el('div', { role: 'img', class: 'plumb' });
  const marker = el('span', { class: 'plumb-marker' });
  plumb.append(
    el('span', { class: 'plumb-rule one' }),
    el('span', { class: 'plumb-rule warning' }),
    marker,
  );

  const debt = labelled('Debt');
  const collateral = labelled('Collateral');
  const health = labelled('Health factor');
  const liquidation = labelled('Liquidation price');
  const graceEnds = labelled('Grace ends');

  const notices = el('ul', { class: 'notices', 'aria-label': 'Notices' });
  notices.setAttribute('role', 'list');

  const ruler = new ShockRuler({ showPost: false, ownPositionId: positionId });

  // ---- the owner's action forms -------------------------------------------
  const decimalsOfDebt = (): number =>
    position === null ? 0 : store.decimalsOf(position.debt_asset);
  const decimalsOfCollateral = (): number =>
    position === null ? 0 : store.decimalsOf(position.collateral_asset);

  const drawAmount = new Field('Draw amount', { kind: 'amount', decimals: decimalsOfDebt });
  const drawButton = button('Draw');
  const retryButton = button('Retry');
  drawAmount.submitsWith(drawButton);

  const repayAmount = new Field('Repay amount', { kind: 'amount', decimals: decimalsOfDebt });
  const repayButton = button('Repay');
  const repayAllButton = button('Repay all');
  repayAmount.submitsWith(repayButton);

  const collateralChange = new Field('Collateral change', {
    kind: 'amount',
    decimals: decimalsOfCollateral,
  });
  const addButton = button('Add collateral');
  const withdrawButton = button('Withdraw collateral');
  collateralChange.submitsWith(addButton);

  // Retry appears directly after Draw in the Tab order, only after a lost reply.
  const drawRow = el('div', { class: 'form-block' }, [drawAmount.row, drawButton, retryButton]);
  retryButton.hidden = true;

  const actions = el('div', { class: 'form-grid' }, [
    drawRow,
    el('div', { class: 'form-block' }, [repayAmount.row, repayButton, repayAllButton]),
    el('div', { class: 'form-block' }, [collateralChange.row, addButton, withdrawButton]),
  ]);

  let drawKey = freshKey();
  let lastDrawBody: { amount: string } | null = null;

  async function doDraw(isRetry: boolean): Promise<void> {
    if (!isRetry) {
      if (!drawAmount.validate() || !drawAmount.ready) {
        drawAmount.focus();
        return;
      }
      // Each new press of Draw creates a new key for that draw.
      drawKey = freshKey();
      lastDrawBody = { amount: amountUnits(drawAmount.value, decimalsOfDebt()) };
      retryButton.hidden = true;
    }
    const body = lastDrawBody;
    if (body === null) return;

    live.clearProblems();
    live.announce('Drawing');
    drawButton.disabled = true;
    retryButton.disabled = true;
    try {
      const reply = await request<SettlementDto>('POST', `/api/positions/${positionId}/draws`, {
        token: store.token,
        body,
        idempotencyKey: drawKey,
      });
      live.announce(
        `Drew ${formatAmount(BigInt(reply.amount), store.decimalsOf(reply.asset))} ${reply.asset}. Health factor now ${formatHealthFactor(reply.health_factor_after ?? null)}.`,
        { href: `/settlements/${reply.settlement_id}`, label: 'View receipt' },
      );
      drawAmount.value = '';
      retryButton.hidden = true;
      lastDrawBody = null;
      await Promise.all([store.refresh(), load()]);
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        live.validation(
          applyFieldErrors([{ name: 'amount', field: drawAmount }], error.errors),
        );
      } else if (error instanceof ApiProblem) {
        live.report(error);
      } else {
        // A reply lost to a network failure: Retry resends the same key.
        live.report(error);
        retryButton.hidden = false;
        drawButton.focus();
      }
    } finally {
      drawButton.disabled = false;
      retryButton.disabled = false;
    }
  }

  async function doRepay(all: boolean): Promise<void> {
    if (!all && (!repayAmount.validate() || !repayAmount.ready)) {
      repayAmount.focus();
      return;
    }
    const body = all
      ? { amount: 'all' }
      : { amount: amountUnits(repayAmount.value, decimalsOfDebt()) };
    live.clearProblems();
    live.announce('Repaying');
    const pressed = all ? repayAllButton : repayButton;
    try {
      await whilePending(pressed, async () => {
        const reply = await request<RepaymentDto>(
          'POST',
          `/api/positions/${positionId}/repayments`,
          { token: store.token, body },
        );
        const asset = position?.debt_asset ?? 'QUSD';
        const amount = `${formatAmount(BigInt(reply.amount), store.decimalsOf(asset))} ${asset}`;
        live.announce(
          reply.debt_after === '0'
            ? `Repaid ${amount}. No debt remains.`
            : `Repaid ${amount}. Health factor now ${formatHealthFactor(reply.health_factor_after)}.`,
        );
        repayAmount.value = '';
        await Promise.all([store.refresh(), load()]);
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        live.validation(
          applyFieldErrors([{ name: 'amount', field: repayAmount }], error.errors),
        );
      } else {
        live.report(error);
      }
    }
  }

  async function doCollateral(add: boolean): Promise<void> {
    if (!collateralChange.validate() || !collateralChange.ready) {
      collateralChange.focus();
      return;
    }
    const body = { amount: amountUnits(collateralChange.value, decimalsOfCollateral()) };
    live.clearProblems();
    live.announce(add ? 'Adding collateral' : 'Withdrawing collateral');
    const pressed = add ? addButton : withdrawButton;
    try {
      await whilePending(pressed, async () => {
        const reply = await request<PositionDto>(
          'POST',
          `/api/positions/${positionId}/${add ? 'collateral' : 'collateral-withdrawals'}`,
          { token: store.token, body },
        );
        const health = formatHealthFactor(reply.health_factor);
        if (add) {
          live.announce(
            reply.debt === '0'
              ? 'Collateral added. No debt is drawn.'
              : `Collateral added. Health factor now ${health}.`,
          );
        } else if (reply.state === 'closed') {
          live.announce('Collateral withdrawn. Position closed.');
        } else {
          live.announce(
            reply.debt === '0'
              ? 'Collateral withdrawn. No debt is drawn.'
              : `Collateral withdrawn. Health factor now ${health}.`,
          );
        }
        collateralChange.value = '';
        await Promise.all([store.refresh(), load()]);
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        live.validation(
          applyFieldErrors([{ name: 'amount', field: collateralChange }], error.errors),
        );
      } else {
        live.report(error);
      }
    }
  }

  drawButton.addEventListener('click', () => void doDraw(false));
  retryButton.addEventListener('click', () => void doDraw(true));
  repayButton.addEventListener('click', () => void doRepay(false));
  repayAllButton.addEventListener('click', () => void doRepay(true));
  addButton.addEventListener('click', () => void doCollateral(true));
  withdrawButton.addEventListener('click', () => void doCollateral(false));

  const element = el('section', { class: 'worksheet-body' }, [
    heading,
    stateRegion,
    plumb,
    el('div', { class: 'figures' }, [
      debt.row,
      collateral.row,
      health.row,
      liquidation.row,
      graceEnds.row,
    ]),
    el('h2', { class: 'zone-head', text: 'Notices' }),
    notices,
    actions,
    ruler.element,
  ]);

  async function load(): Promise<void> {
    try {
      position = await request<PositionDto>('GET', `/api/positions/${positionId}`, {
        token: store.token,
      });
    } catch (error) {
      live.report(error);
      return;
    }
    owned = store.member?.actor_id === position.borrower_id;
    render();
    if (!ruler.isDragging) await loadRuler();
  }

  async function loadRuler(): Promise<void> {
    if (position === null) return;
    const asset = position.collateral_asset;
    const pool = store.poolFor(asset);
    if (pool === null) return;
    const reply = await request<PositionsDto>(
      'GET',
      `/api/positions?collateral_asset=${asset}`,
      { token: store.token },
    );
    ruler.setData(asset, priceUnitsOf(pool.price), reply.positions);
  }

  function render(): void {
    if (position === null) return;
    setText(stateRegion, POSITION_STATE_LABEL[position.state]);
    stateRegion.className = `state-region state-${position.state}`;

    setText(
      debt.value,
      `${formatAmount(BigInt(position.debt), store.decimalsOf(position.debt_asset))} ${position.debt_asset}`,
    );
    setText(
      collateral.value,
      `${formatAmount(BigInt(position.collateral_amount), store.decimalsOf(position.collateral_asset))} ${position.collateral_asset}`,
    );
    setText(health.value, formatHealthFactor(position.health_factor));
    setText(
      liquidation.value,
      position.liquidation_price === null
        ? 'No debt'
        : formatPriceFromApi(position.liquidation_price),
    );

    // Grace ends is shown only while the position is in grace.
    graceEnds.row.hidden = position.grace_ends_at === null;
    if (position.grace_ends_at !== null) {
      setText(
        graceEnds.value,
        formatWallTime(Date.parse(position.grace_ends_at), store.deskTimeZone),
      );
    }

    renderPlumb(position);
    renderNotices(position);
    actions.hidden = !owned;
  }

  /** A line from health factor 0 to 2, with the marker at the position's own. */
  function renderPlumb(dto: PositionDto): void {
    if (dto.health_factor === null) {
      plumb.setAttribute('aria-label', 'Health factor: no debt');
      marker.hidden = true;
      return;
    }
    plumb.setAttribute('aria-label', `Health factor ${formatHealthFactor(dto.health_factor)}`);
    marker.hidden = false;
    const value = Number(dto.health_factor);
    const clamped = Math.min(2, Math.max(0, value));
    marker.style.left = `${(clamped / 2) * 100}%`;
    // Pinned at the right end above 2.
    marker.classList.toggle('pinned', value > 2);
  }

  function renderNotices(dto: PositionDto): void {
    const wanted = dto.notices.map((notice) => {
      const kind = notice.kind === 'margin' ? 'Margin' : 'Liquidation';
      const line =
        notice.status === 'sent'
          ? `${kind} notice sent.`
          : `${kind} notice queued, not yet sent.`;
      return `${line} ${formatWallTime(Date.parse(notice.created_at), store.deskTimeZone)}`;
    });
    const current = Array.from(notices.children).map((child) => child.textContent ?? '');
    if (current.join('\u0000') === wanted.join('\u0000')) return;
    clear(notices);
    for (const line of wanted) notices.append(el('li', { text: line }));
  }

  void load();

  return {
    element,
    update: () => void load().catch(() => undefined),
    navigateAway: () => undefined,
    onPost: () => ruler.recentre(),
    navigate,
  };
}
