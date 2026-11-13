/**
 * The settlement receipt. It reads Settled only when the server reports the
 * statement stored, and keeps refreshing while it is pending or its webhook
 * is queued.
 */

import { STATEMENT_PENDING_LINE } from '../../domain/copy.ts';
import { formatAmount, formatSignedAmount } from '../../domain/deskformat.ts';
import { request } from '../api.ts';
import { clear, el, labelled, setText } from '../dom.ts';
import type { LiveRegions } from '../parts/live.ts';
import { store } from '../store.ts';
import type { SettlementDto } from '../types.ts';
import type { View } from './view.ts';

const KIND_LABEL: Readonly<Record<SettlementDto['kind'], string>> = {
  draw: 'Draw',
  withdrawal: 'Liquidity withdrawal',
  liquidation: 'Liquidation',
};

export function receiptView(
  settlementId: string,
  live: LiveRegions,
  navigate: (path: string) => void,
): View {
  const kind = labelled('Kind', { figure: false });
  const amount = labelled('Amount');
  const statementKey = labelled('Statement key', { figure: false });
  const legsBody = el('tbody');
  const legsTable = el('table', { class: 'ledger-table', 'aria-label': 'Settlement legs' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Account' }),
        el('th', { text: 'Asset' }),
        el('th', { text: 'Amount' }),
      ]),
    ]),
    legsBody,
  ]);

  const statementStatus = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Statement status',
    class: 'statement-status',
  });
  const webhookStatus = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Integrator webhook',
    class: 'webhook-status',
  });
  const noticeLine = el('p', { class: 'notice-line' });
  const download = el('a', {
    class: 'action',
    download: `${settlementId}.pdf`,
    href: `/api/settlements/${settlementId}/statement.pdf`,
    text: 'Download PDF statement',
  });

  const element = el('section', { class: 'worksheet-body' }, [
    el('h1', { class: 'view-head', text: 'Settlement receipt' }),
    el('div', { class: 'figures' }, [kind.row, amount.row, statementKey.row]),
    el('h2', { class: 'zone-head', text: 'Settlement legs' }),
    legsTable,
    statementStatus,
    webhookStatus,
    noticeLine,
    download,
  ]);

  let settlement: SettlementDto | null = null;

  async function load(): Promise<void> {
    try {
      settlement = await request<SettlementDto>('GET', `/api/settlements/${settlementId}`, {
        token: store.token,
      });
      render();
    } catch (error) {
      live.report(error);
    }
  }

  function render(): void {
    const dto = settlement;
    if (dto === null) return;
    setText(kind.value, KIND_LABEL[dto.kind]);
    setText(
      amount.value,
      `${formatAmount(BigInt(dto.amount), store.decimalsOf(dto.asset))} ${dto.asset}`,
    );
    setText(statementKey.value, dto.statement_key);

    const wanted = dto.legs
      .map(
        (leg) =>
          `${leg.account}\u0000${leg.asset}\u0000${formatSignedAmount(BigInt(leg.amount), store.decimalsOf(leg.asset))}`,
      )
      .join('\u0001');
    if (legsBody.dataset['legs'] !== wanted) {
      legsBody.dataset['legs'] = wanted;
      clear(legsBody);
      for (const leg of dto.legs) {
        legsBody.append(
          el('tr', {}, [
            el('td', { 'data-label': 'Account', text: leg.account }),
            el('td', { 'data-label': 'Asset', text: leg.asset }),
            el('td', {
              'data-label': 'Amount',
              class: 'figure',
              text: formatSignedAmount(BigInt(leg.amount), store.decimalsOf(leg.asset)),
            }),
          ]),
        );
      }
    }

    if (dto.statement_status === 'stored') {
      setText(statementStatus, 'Settled');
      statementStatus.classList.add('settled');
    } else {
      setText(statementStatus, `Pending statement ${STATEMENT_PENDING_LINE}`);
      statementStatus.classList.remove('settled');
    }
    setText(
      webhookStatus,
      dto.webhook_status === 'delivered'
        ? 'Webhook delivered.'
        : 'Webhook queued, not yet delivered.',
    );

    if (dto.notice_status === undefined) {
      setText(noticeLine, '');
    } else {
      setText(
        noticeLine,
        dto.notice_status === 'sent'
          ? 'Liquidation notice sent.'
          : 'Liquidation notice queued, not yet sent.',
      );
    }

    // The download is present only while the statement status is Settled.
    download.hidden = dto.statement_status !== 'stored';
  }

  void load();

  return {
    element,
    update: () => {
      // A receipt that reads Pending statement or Webhook queued keeps asking.
      if (
        settlement === null ||
        settlement.statement_status !== 'stored' ||
        settlement.webhook_status !== 'delivered'
      ) {
        void load().catch(() => undefined);
      }
    },
    navigateAway: () => undefined,
    onPost: () => undefined,
    navigate,
  };
}
