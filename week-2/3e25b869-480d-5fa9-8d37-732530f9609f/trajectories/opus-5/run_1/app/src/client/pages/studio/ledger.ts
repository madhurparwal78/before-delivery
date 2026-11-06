import { dropTimeText, moneyText } from '../../../shared/bilingual.js';
import { COLUMNS, RECONCILIATION_STATUS, STUDIO, UI } from '../../../shared/copy.js';
import { torontoMonth } from '../../../shared/toronto.js';
import type { AuditEntry, Money, Notice, ReconciliationLine } from '../../../shared/types.js';
import { api, ApiFailure } from '../../api.js';
import { cash, locale } from '../../i18n.js';
import { announce } from '../../live.js';
import { bind, bindText, el, labelled, refresh, say } from '../../ui.js';
import { reportStudioFailure, studioRegion } from './shell.js';
import { studioTable } from './table.js';

type Report = {
  month: string;
  stale: boolean;
  checked_at: string | null;
  lines: ReconciliationLine[];
  totals: { shop: Money; killbill: Money };
};

export async function renderReconciliation(body: HTMLElement): Promise<void> {
  const heading = el('h1', { class: 'page-heading' });
  bindText(heading, () => say(UI.navReconciliation));
  const region = studioRegion();
  const monthInput = el('input', { type: 'month', class: 'input tabular', value: torontoMonth(new Date()) });
  const onlyMismatches = el('button', {
    type: 'button',
    role: 'switch',
    class: 'switch',
    'aria-checked': 'false',
  });
  const statusLine = el('p', { role: 'status', class: 'live-region' });
  let report: Report | null = null;
  let filtered = false;

  const table = studioTable(() => say(UI.reconciliationLines), [
    { label: COLUMNS.key },
    { label: COLUMNS.kind },
    { label: COLUMNS.shop },
    { label: COLUMNS.killbill },
    { label: COLUMNS.status },
  ]);

  const load = async (): Promise<void> => {
    try {
      report = await api.get<Report>(`/api/staff/reconciliation?month=${monthInput.value}`);
      refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        announce('studio', { 'en-CA': error.detail, 'fr-CA': error.detail });
        refresh();
        return;
      }
      reportStudioFailure(error, STUDIO.billingUnavailable);
    }
  };

  monthInput.addEventListener('change', () => void load());
  onlyMismatches.addEventListener('click', () => {
    filtered = !filtered;
    refresh();
    onlyMismatches.focus();
  });

  const accept = (line: ReconciliationLine): void => {
    void (async () => {
      try {
        const result = await api.post<{ line: ReconciliationLine }>('/api/staff/reconciliation/accept', {
          month: report?.month ?? monthInput.value,
          key: line.key,
        });
        announce(
          'studio',
          STUDIO.figureAccepted(
            moneyText(result.line.shop ?? { cents: 0, currency: 'CAD' }),
            line.key,
          ),
        );
        await load();
      } catch (error) {
        reportStudioFailure(error, STUDIO.billingUnavailable);
      }
    })();
  };

  const refundOrphan = (line: ReconciliationLine): void => {
    void (async () => {
      try {
        const result = await api.post<{ refund: { amount: Money } }>(
          '/api/staff/reconciliation/refund-orphan',
          { month: report?.month ?? monthInput.value, key: line.key },
        );
        announce('studio', STUDIO.orphanRefunded(line.key, moneyText(result.refund.amount)));
        await load();
      } catch (error) {
        reportStudioFailure(error, STUDIO.billingUnavailable);
      }
    })();
  };

  bind(() => {
    monthInput.setAttribute('aria-label', say(UI.month));
    onlyMismatches.setAttribute('aria-label', say(UI.onlyMismatches));
    onlyMismatches.setAttribute('aria-checked', filtered ? 'true' : 'false');
    onlyMismatches.textContent = say(UI.onlyMismatches);
    statusLine.setAttribute('aria-label', say(UI.reconciliationStatus));
    statusLine.textContent = !report
      ? ''
      : report.stale
        ? report.checked_at
          ? say(RECONCILIATION_STATUS.staleWith(dropTimeText(new Date(report.checked_at))))
          : say(RECONCILIATION_STATUS.staleWithout)
        : '';
    const lines = (report?.lines ?? []).filter((line) => !filtered || line.status === 'mismatch');
    table.setRows(
      lines.map((line) => {
        const action = el('div', { class: 'row-actions' });
        if (line.status === 'mismatch') {
          const button = el('button', {
            type: 'button',
            class: 'button quiet',
            text:
              locale() === 'fr-CA'
                ? `Accepter le montant de Kill Bill pour ${line.key}`
                : `Accept Kill Bill figure for ${line.key}`,
          });
          button.addEventListener('click', () => accept(line));
          action.append(button);
        }
        if (line.status === 'kb_only') {
          const button = el('button', {
            type: 'button',
            class: 'button quiet',
            text:
              locale() === 'fr-CA'
                ? `Rembourser le paiement orphelin ${line.key}`
                : `Refund orphan payment ${line.key}`,
          });
          button.addEventListener('click', () => refundOrphan(line));
          action.append(button);
        }
        return [
          line.key,
          line.kind,
          line.shop ? cash(line.shop) : '\u2014',
          line.killbill ? cash(line.killbill) : '\u2014',
          el('div', { class: 'status-cell' }, [el('span', { text: line.status }), action]),
        ];
      }),
    );
    table.setFooter(
      report
        ? [
            say(COLUMNS.total),
            '',
            cash(report.totals.shop),
            cash(report.totals.killbill),
            '',
          ]
        : null,
    );
  });

  body.append(
    heading,
    labelled(UI.month, monthInput),
    onlyMismatches,
    statusLine,
    table.element,
    region,
  );
  await load();
}

export async function renderAudit(body: HTMLElement): Promise<void> {
  const heading = el('h1', { class: 'page-heading' });
  bindText(heading, () => say(UI.financeAudit));
  const region = studioRegion();
  let entries: AuditEntry[] = [];
  const table = studioTable(() => say(UI.financeAudit), [
    { label: COLUMNS.at },
    { label: COLUMNS.actor },
    { label: COLUMNS.role },
    { label: COLUMNS.action },
    { label: COLUMNS.target },
    { label: COLUMNS.reason },
    { label: COLUMNS.amount },
    { label: COLUMNS.killbillRef },
    { label: COLUMNS.outcome },
  ]);
  bind(() => {
    table.setRows(
      entries.map((entry) => [
        say(dropTimeText(new Date(entry.at))),
        entry.actor,
        entry.role,
        entry.action,
        entry.target,
        entry.reason,
        cash(entry.amount),
        entry.killbill_ref ?? '\u2014',
        entry.outcome,
      ]),
    );
  });
  body.append(heading, table.element, region);
  try {
    entries = (await api.get<{ entries: AuditEntry[] }>('/api/staff/audit')).entries;
    refresh();
  } catch (error) {
    reportStudioFailure(error, STUDIO.forbidden);
  }
}

export async function renderNotices(body: HTMLElement): Promise<void> {
  const heading = el('h1', { class: 'page-heading' });
  bindText(heading, () => say(UI.noticesTable));
  const region = studioRegion();
  let notices: Notice[] = [];
  const table = studioTable(() => say(UI.noticesTable), [
    { label: COLUMNS.number },
    { label: COLUMNS.key },
    { label: COLUMNS.recipient },
    { label: COLUMNS.subject },
    { label: COLUMNS.status },
    { label: COLUMNS.attempts },
    { label: COLUMNS.actions },
  ]);

  const load = async (): Promise<void> => {
    try {
      notices = (await api.get<{ notices: Notice[] }>('/api/staff/notices')).notices;
      refresh();
    } catch (error) {
      reportStudioFailure(error, STUDIO.forbidden);
    }
  };

  const resend = (notice: Notice): void => {
    void (async () => {
      try {
        await api.post(`/api/staff/notices/${notice.number}/resend`);
        announce('studio', STUDIO.noticeResent(notice.number));
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'notice_not_failed') {
          announce('studio', STUDIO.noticeNotFailed(notice.number));
        } else {
          reportStudioFailure(error, STUDIO.forbidden);
        }
      }
      await load();
    })();
  };

  bind(() => {
    table.setRows(
      notices.map((notice) => {
        const actions = el('div', { class: 'row-actions' });
        if (notice.status === 'failed') {
          const button = el('button', {
            type: 'button',
            class: 'button quiet',
            text: locale() === 'fr-CA' ? `Renvoyer ${notice.number}` : `Resend ${notice.number}`,
          });
          button.addEventListener('click', () => resend(notice));
          actions.append(button);
        }
        return [
          notice.number,
          notice.key,
          notice.to,
          notice.subject,
          notice.status,
          notice.attempts
            .map((attempt) => `${say(dropTimeText(new Date(attempt.at)))} ${attempt.outcome}`)
            .join(' / '),
          actions,
        ];
      }),
    );
  });

  body.append(heading, table.element, region);
  await load();
}
