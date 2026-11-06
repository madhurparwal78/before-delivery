import { get, post, RequestFailed } from '../api.ts';
import { studio, type ScreenRender } from '../app.ts';
import { openDialog } from '../dialog.ts';
import { el, field, replace } from '../dom.ts';
import { dollars, money, monthLabel } from '../format.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';
import { onLive } from '../live.ts';
import type { FiringLog, Revenue } from '../types.ts';

export const renderReports: ScreenRender = ({ mount }) => {
  const region = new Region('Reports status');
  const monthInput = el('input', { type: 'month' });
  const monthField = field('Month', monthInput, 'reports-month');
  const dayInput = el('input', { type: 'date' });
  const dayField = field('Day', dayInput, 'reports-day');
  const revenueBody = el('div', { class: 'stack' });
  const revenuePanel = el('section', {
    class: 'panel',
    role: 'region',
    'aria-label': 'Monthly revenue',
  }, [el('h2', { class: 'heading small', text: 'MONTHLY REVENUE' }), revenueBody]);
  const closeButton = el('button', { type: 'button', class: 'btn ghost' });
  const exportButton = el('button', { type: 'button', class: 'btn ghost', text: 'EXPORT STATEMENT' });
  const logBody = el('tbody');

  const today = studio()?.today ?? '';
  monthInput.value = today.slice(0, 7);
  dayInput.value = today;
  closeButton.textContent = `CLOSE ${monthLabel(monthInput.value || '2026-01').toUpperCase()}`;
  closeButton.setAttribute('aria-label', `Close ${monthLabel(monthInput.value || '2026-01')}`);

  mount.appendChild(
    el('div', { class: 'split-half' }, [
      el('section', { class: 'panel' }, [
        el('h1', { class: 'heading', text: 'REPORTS' }),
        monthField.wrap,
        revenuePanel,
        el('div', { class: 'row wrap' }, [closeButton, exportButton]),
        region.node,
      ]),
      el('section', { class: 'panel' }, [
        el('h2', { class: 'heading small', text: 'DAILY FIRING LOG' }),
        dayField.wrap,
        el('table', { class: 'table', 'aria-label': 'Daily firing log' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Kiln' }),
              el('th', { scope: 'col', text: 'Firing' }),
              el('th', { scope: 'col', text: 'Pieces' }),
              el('th', { scope: 'col', text: 'Value' }),
            ]),
          ]),
          logBody,
        ]),
      ]),
    ]),
  );

  const drawRevenue = (view: Revenue): void => {
    replace(revenueBody, [
      el('p', { class: 'mono huge', text: money(view.net_cents) }),
      el('p', { class: 'mono', text: `FEES $${dollars(view.fees_cents)}` }),
      el('p', { class: 'mono', text: `REFUNDS $${dollars(view.refunds_cents)}` }),
      el('p', { class: 'mono', text: `${view.charge_count} CHARGES` }),
      view.closed_at ? el('span', { class: 'tag', text: 'CLOSED' }) : null,
    ]);
    const label = monthLabel(view.month);
    closeButton.textContent = `CLOSE ${label.toUpperCase()}`;
    closeButton.setAttribute('aria-label', `Close ${label}`);
    closeButton.disabled = view.closed_at !== null;
  };

  const fetchRevenue = async (): Promise<void> => {
    drawRevenue(await get<Revenue>(`/api/reports/revenue?month=${monthInput.value}`));
  };

  const fetchLog = async (): Promise<void> => {
    const view = await get<FiringLog>(`/api/firing-log?date=${dayInput.value}`);
    replace(
          logBody,
          view.firings.length === 0
            ? [el('tr', {}, [el('td', { colspan: 4, class: 'muted', text: 'No loads were unloaded on this day.' })])]
            : view.firings.map((firing) =>
            el('tr', {}, [
              el('td', { text: firing.kiln_name }),
              el('td', { text: firing.firing }),
              el('td', { class: 'mono', text: String(firing.piece_count) }),
              el('td', { class: 'mono', text: `$${dollars(firing.value_cents)}` }),
            ]),
          ),
        );
  };

  /** A month or day the owner picked: announced in Reports status. */
  const announced = (fetch: () => Promise<void>) => (): void => {
    void withPending(region, null, 'Loading…', async () => {
      try {
        await fetch();
        region.clear();
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        region.say(failureCopy(error.failure, {}));
      }
    });
  };

  /** Someone else's change: redrawn quietly, so it never overwrites the owner's own feedback. */
  const quietly = (fetch: () => Promise<void>): void => {
    fetch().catch(() => undefined);
  };

  monthInput.addEventListener('change', announced(fetchRevenue));
  dayInput.addEventListener('change', announced(fetchLog));

  closeButton.addEventListener('click', () => {
    const month = monthInput.value;
    const label = monthLabel(month);
    const confirm = el('button', { type: 'button', class: 'btn primary', text: 'CONFIRM CLOSE' });
    const cancel = el('button', { type: 'button', class: 'btn ghost', text: 'CANCEL' });
    const dialog = openDialog({
      label: 'Close month',
      opener: closeButton,
      children: [
        el('p', { text: `Close ${label}? Its statement becomes final.` }),
        el('div', { class: 'row' }, [confirm, cancel]),
      ],
    });
    cancel.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      void withPending(region, confirm, 'Closing month…', async () => {
        try {
          const view = await post<Revenue>(`/api/reports/months/${month}/close`);
          dialog.close();
          drawRevenue(view);
          region.say(`${label} closed. Its statement is final.`);
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          region.say(
            failureCopy(error.failure, {
              month_open: `${label} has not ended yet in the studio's time zone.`,
              month_closed: `${label} is already closed.`,
            }),
          );
        }
      });
    });
  });

  exportButton.addEventListener('click', () => {
    void withPending(region, exportButton, 'Preparing statement…', async () => {
      const month = monthInput.value;
      try {
        const response = await fetch(`/api/reports/statement.csv?month=${month}`);
        if (!response.ok) {
          region.say('Something went wrong. Try again.');
          return;
        }
        const url = URL.createObjectURL(await response.blob());
        const anchor = el('a', { href: url, download: `statement-${month}.csv` });
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        region.say('Statement downloaded.');
      } catch {
        region.say('No connection. Check the studio wifi and try again.');
      }
    });
  });

  quietly(fetchRevenue);
  quietly(fetchLog);
  return onLive((message) => {
    if (message.kind === 'charge' || message.kind === 'month' || message.kind === 'load') {
      quietly(fetchRevenue);
      quietly(fetchLog);
    }
  });
};
