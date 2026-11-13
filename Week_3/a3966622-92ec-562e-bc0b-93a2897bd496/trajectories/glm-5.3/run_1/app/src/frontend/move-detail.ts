// The move detail screen: status, plan, notice cutoff and verdict, charges,
// notices, ladder reports, charge lines, invoice links and history.

import { el, clear, announce, labelledItem } from './dom.js';
import { get, post, patch, newKey, type ApiResult } from './http.js';
import { refreshServices, topStrip, openDialog, type AppCtx } from './chrome.js';
import {
  chargesText, noticeCutoffShown, noticeVerdictShown, money, marginMetres,
  LATE_AMENDMENT_NOTICE, LATE_CANCELLATION_NOTICE,
  type LadderReport, type Move, type Plan, type User,
} from './domain.js';

export async function renderMoveDetail(
  container: HTMLElement,
  user: User,
  ref: string,
): Promise<void> {
  const nowResult = await get<{ now: string }>('/api/port');
  const ctx: AppCtx = {
    user, services: { billing: 'up', storage: 'up', mail: 'up' },
    serviceAnnouncements: el('div', { role: 'status', 'aria-label': 'Service announcements', class: 'live-region' }),
    container, portNow: nowResult.ok ? nowResult.value.now : '',
  };

  clear(container);
  container.append(topStrip(ctx, () => { window.location.href = '/login'; }));
  container.append(ctx.serviceAnnouncements);
  void refreshServices(ctx);

  const moveAnnouncements = el('div', { role: 'status', 'aria-label': 'Move announcements', class: 'live-region' });

  const result = await get<Move>(`/api/moves/${ref}`);
  if (!result.ok) {
    const { notFoundPage } = await import('./chrome.js');
    container.append(notFoundPage());
    return;
  }

  let move = result.value;

  const page = el('div', { class: 'move-detail' });
  container.append(page);
  container.append(moveAnnouncements);

  async function paint(): Promise<void> {
    clear(page);
    const fresh = await get<Move>(`/api/moves/${ref}`);
    if (fresh.ok) move = fresh.value;
    const planResult = await get<Plan>(`/api/moves/${ref}/plan`);

    page.append(el('h1', { class: 'num' }, move.ref));
    page.append(el('div', { class: `status status-${move.status.replace(/\s+/g, '-')}` }, move.status === 'On board' && move.detained ? 'On board - detained' : move.status));
    if (move.status === 'Refused at ladder') {
      page.append(el('h2', {}, 'Boarding refused at ladder'));
    }

    page.append(labelledItem('Vessel', move.vessel.name));
    page.append(labelledItem('Boarding', move.boarding_at.replace('T', ' ') + ' port time'));
    if (move.committed) {
      page.append(labelledItem('Committed', `${move.committed.boarding_at.replace('T', ' ')} ${move.committed.pinch_waypoint} ${marginMetres(move.committed.margin_mm)}`));
    }
    page.append(labelledItem('Draught', `${(move.draught_mm / 1000).toFixed(3)} m / ${move.draught.feet}`));
    page.append(labelledItem('Notice cutoff', noticeCutoffShown(move)));
    page.append(labelledItem('Notice verdict', noticeVerdictShown(move)));
    page.append(labelledItem('Charges', chargesText(move)));

    // Charge lines.
    if (move.lines.length > 0) {
      const lines = el('div', { class: 'lines' });
      lines.append(el('h2', {}, 'Charge lines'));
      for (const line of move.lines) {
        lines.append(el('div', { class: 'line-row num' },
          el('span', {}, `${line.label} x${line.quantity}`),
          el('span', {}, money(line.amount_cents)),
        ));
      }
      lines.append(el('div', { class: 'line-total num' }, money(move.lines.reduce((acc, l) => acc + l.amount_cents, 0))));
      page.append(lines);
    }

    // Invoice links.
    if (move.billing.invoice_ids.length > 0) {
      const invoices = el('div', { class: 'invoices' });
      invoices.append(el('h2', {}, 'Invoices'));
      for (const id of move.billing.invoice_ids) {
        invoices.append(el('a', { class: 'link', href: `/invoices/${id}` }, id));
      }
      page.append(invoices);
    }

    // Notices.
    const notices = el('ul', { 'aria-label': 'Notices', class: 'notices' });
    for (const notice of move.notices) {
      notices.append(el('li', { class: 'num' }, `${notice.kind}: ${notice.state}`));
    }
    page.append(notices);

    // Ladder reports.
    if (move.ladder_reports.length > 0) {
      const reports = el('div', { class: 'reports' });
      reports.append(el('h2', {}, 'Ladder reports'));
      for (const id of move.ladder_reports) {
        const report = await get<LadderReport>(`/api/ladder-reports/${id}`);
        if (report.ok) {
          reports.append(el('a', { class: 'link', href: `/reports/${id}` }, id));
          if (report.value.refused) {
            reports.append(el('span', { class: 'refused' }, 'Boarding refused at ladder'));
          }
        }
      }
      page.append(reports);
    }

    // Pilot card link.
    page.append(el('a', { class: 'link', href: `/api/vessels/${move.vessel.id}/pilot-cards/latest/content` }, 'Pilot card'));

    // History.
    const history = el('div', { class: 'history' });
    history.append(el('h2', {}, 'History'));
    for (const entry of move.history) {
      history.append(el('div', { class: 'num' }, `${entry.at} ${entry.status} ${entry.by}`));
    }
    page.append(history);

    // Amend and cancel controls.
    const amendable = ['Ordered', 'Window committed', 'Pilot assigned'].includes(move.status);
    const cancellable = ['Ordered', 'Window committed', 'Pilot assigned', 'Pilot away'].includes(move.status);
    if ((user.role === 'agent' || user.role === 'dispatcher') && (amendable || cancellable)) {
      const actions = el('div', { class: 'move-actions' });
      if (amendable) {
        actions.append(el('button', { class: 'primary' }, 'Amend move').tap((b) => b.addEventListener('click', () => {
          void openAmend();
        })));
      }
      if (cancellable) {
        actions.append(el('button', { class: 'danger' }, 'Cancel move').tap((b) => b.addEventListener('click', () => {
          void openCancel();
        })));
      }
      if (user.role === 'agent' && move.status === 'Refused at ladder') {
        actions.append(el('button', { class: 'primary' }, 'Corrected re-order').tap((b) => b.addEventListener('click', () => {
          void openReorder();
        })));
      }
      page.append(actions);
    }
    void planResult;
  }

  async function openAmend(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = openDialog('Amend move', opener);
    const fields = await buildOrderFields(move);
    const save = el('button', { class: 'primary' }, 'Save amendment');
    const holder = el('div', { class: 'dialog-fields' });
    const cutoffItem = labelledItem('Notice cutoff', noticeCutoffShown(move));
    const verdictItem = labelledItem('Notice verdict', noticeVerdictShown(move));
    const { inputs, elements } = fields;
    holder.append(...elements);
    save.addEventListener('click', async () => {
      announce(moveAnnouncements, 'Saving amendment...');
      const body = inputs();
      const result = await patch<Move>(`/api/moves/${move.ref}`, body, { ifMatch: `"${move.version}"` });
      if (result.ok) {
        const amended = result.value as Move & { window_returned?: boolean; late_notice?: boolean };
        announce(moveAnnouncements, 'Amendment saved');
        if (amended.window_returned === true) {
          announce(moveAnnouncements, 'Amendment saved. Window no longer clears - move returned to Ordered.');
        }
        if (amended.late_notice === true) {
          announce(moveAnnouncements, LATE_AMENDMENT_NOTICE);
        }
        dialog.close();
        await paint();
      } else if ('noReply' in result && result.noReply) {
        announce(moveAnnouncements, 'No reply from the server. Showing the last confirmed state.');
      } else if (result.ok === false && 'failure' in result) {
        const failure = result.failure;
        if (failure.code === 'stale_version') {
          announce(moveAnnouncements, 'This move changed. Fresh data shown.');
          dialog.close();
          await paint();
        } else if (failure.code === 'not_amendable') {
          announce(moveAnnouncements, 'This move can no longer be amended.');
          dialog.close();
        } else {
          announce(moveAnnouncements, 'This move can no longer be amended.');
        }
      }
    });
    dialog.dialog.append(
      el('h2', {}, 'Amend move'),
      cutoffItem,
      verdictItem,
      holder,
      el('div', { class: 'dialog-actions' }, save, el('button', { class: 'secondary' }, 'Close amendment').tap((b) => b.addEventListener('click', () => dialog.close()))),
    );
  }

  async function openCancel(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = openDialog('Cancel move', opener);
    const cutoffItem = labelledItem('Notice cutoff', noticeCutoffShown(move));
    const verdictItem = labelledItem('Notice verdict', noticeVerdictShown(move));
    const confirm = el('button', { class: 'danger' }, 'Confirm cancellation');
    let key: string | null = null;
    confirm.addEventListener('click', async () => {
      announce(moveAnnouncements, 'Cancelling move...');
      const idem = key ?? newKey();
      key = idem;
      const result = await post<Move>(`/api/moves/${move.ref}/cancel`, {}, { key: idem });
      if (result.ok) {
        key = null;
        if (result.value.status === 'Cancelled late') {
          announce(moveAnnouncements, LATE_CANCELLATION_NOTICE);
        } else {
          announce(moveAnnouncements, 'Move cancelled');
        }
        dialog.close();
        await paint();
      } else if ('noReply' in result && result.noReply) {
        announce(moveAnnouncements, 'No reply from the server. Showing the last confirmed state.');
      } else {
        key = null;
        announce(moveAnnouncements, 'This move can no longer be cancelled.');
        dialog.close();
      }
    });
    dialog.dialog.append(
      el('h2', {}, 'Cancel move'),
      cutoffItem,
      verdictItem,
      el('div', { class: 'dialog-actions' }, confirm, el('button', { class: 'secondary' }, 'Keep move').tap((b) => b.addEventListener('click', () => dialog.close()))),
    );
  }

  async function openReorder(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = openDialog('Corrected re-order', opener);
    const correction = el('input', { type: 'text', 'aria-label': 'Correction', class: 'text' }) as HTMLInputElement;
    const date = el('input', { type: 'text', 'aria-label': 'Boarding date', class: 'text num', value: move.boarding_at.slice(0, 10) }) as HTMLInputElement;
    const time = el('input', { type: 'text', 'aria-label': 'Boarding time', class: 'text num', value: move.boarding_at.slice(11, 16) }) as HTMLInputElement;
    const place = el('button', { class: 'primary' }, 'Place re-order');
    place.addEventListener('click', async () => {
      const result = await post<Move>(`/api/moves/${move.ref}/reorder`, {
        boarding_at: `${date.value}T${time.value}`,
        correction: correction.value,
      });
      if (result.ok) {
        announce(moveAnnouncements, 'Status now Ordered');
        dialog.close();
        await paint();
      } else if ('noReply' in result && result.noReply) {
        announce(moveAnnouncements, 'No reply from the server. Showing the last confirmed state.');
      } else {
        announce(moveAnnouncements, 'This action is not available for the move\'s current status.');
      }
    });
    dialog.dialog.append(
      el('h2', {}, 'Corrected re-order'),
      correction,
      el('div', { class: 'field-row' }, date, time),
      el('div', { class: 'dialog-actions' }, place, el('button', { class: 'secondary' }, 'Close re-order').tap((b) => b.addEventListener('click', () => dialog.close()))),
    );
  }

  await paint();
  window.setInterval(() => {
    void paint();
  }, 30_000);
}

interface OrderFields {
  inputs: () => Record<string, unknown>;
  elements: HTMLElement[];
}

async function buildOrderFields(move: Move): Promise<OrderFields> {
  const speed = el('input', { type: 'number', 'aria-label': 'Speed in knots', class: 'text num', value: String(move.speed_kn) }) as HTMLInputElement;
  const draught = el('input', { type: 'number', step: '0.001', 'aria-label': 'Draught in metres', class: 'text num', value: (move.draught_mm / 1000).toFixed(3) }) as HTMLInputElement;
  const date = el('input', { type: 'text', 'aria-label': 'Boarding date', class: 'text num', value: move.boarding_at.slice(0, 10) }) as HTMLInputElement;
  const time = el('input', { type: 'text', 'aria-label': 'Boarding time', class: 'text num', value: move.boarding_at.slice(11, 16) }) as HTMLInputElement;
  const duty = el('input', { type: 'number', 'aria-label': 'Duty minutes', class: 'text num', value: String(move.duty_minutes) }) as HTMLInputElement;
  const gt = el('input', { type: 'number', 'aria-label': 'Gross tonnage', class: 'text num', value: String(move.vessel.gross_tonnage) }) as HTMLInputElement;
  const inputs = (): Record<string, unknown> => ({
    speed_kn: Number(speed.value),
    draught_m: Number(draught.value),
    boarding_at: `${date.value}T${time.value}`,
    duty_minutes: Number(duty.value),
    gross_tonnage: Number(gt.value),
  });
  const elements = [speed, draught, el('div', { class: 'field-row' }, date, time), duty, gt];
  return { inputs, elements };
}

export type { ApiResult };
