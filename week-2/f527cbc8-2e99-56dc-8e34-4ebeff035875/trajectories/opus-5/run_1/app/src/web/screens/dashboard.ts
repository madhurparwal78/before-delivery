import { api, ApiError, type Dashboard, type Job } from '../api.js';
import { clear, el, money, countingNumber, setCountingNumber } from '../dom.js';
import { announceWithToast, failureCopy, pending } from '../notices.js';
import { copy } from '../copy.js';
import type { ScreenContext } from '../shell.js';

/** `/dashboard` — the month's figures against the ledger, a bar chart and the export. */
export async function renderDashboard(ctx: ScreenContext): Promise<void> {
  clear(ctx.main);

  const monthPicker = el('select', { 'aria-label': 'Month' }) as HTMLSelectElement;
  const exportButton = el('button', { type: 'button', class: 'primary', text: 'Export CSV' }) as HTMLButtonElement;
  const downloadHost = el('span');
  const totalsHost = el('div', { class: 'totals' });
  const chartHost = el('div', { class: 'chart-host' });
  const dailyHost = el('div');

  const months: string[] = [];
  const [year, month] = ctx.practice.today.split('-').map(Number) as [number, number];
  for (let back = 0; back < 12; back += 1) {
    const shifted = new Date(Date.UTC(year, month - 1 - back, 1));
    months.push(`${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  for (const value of months) monthPicker.append(el('option', { value, text: value }));

  ctx.main.append(
    el('div', { class: 'inline dashboard-controls' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Month' }), monthPicker]),
      exportButton,
      downloadHost,
    ]),
    el('div', { class: 'dashboard-top' }, [totalsHost, chartHost]),
    dailyHost,
  );

  let figures: Dashboard | null = null;
  const counters = new Map<string, HTMLElement>();

  const renderTotals = (next: Dashboard): void => {
    if (counters.size === 0) {
      clear(totalsHost);
      const body = el('tbody');
      const rows: [string, number][] = [
        ['Billed', next.billed_cents],
        ['Collected', next.collected_cents],
        ['Refunded', next.refunded_cents],
        ['Outstanding', next.outstanding_cents],
      ];
      for (const [label, value] of rows) {
        const counter = countingNumber(value, (amount) => money(Math.round(amount)));
        counters.set(label, counter);
        body.append(
          el('tr', {}, [
            el('td', { 'data-label': 'Figure', text: label }),
            el('td', { 'data-label': 'Amount', class: 'amount' }, [counter]),
          ]),
        );
      }
      const overdue = countingNumber(next.overdue_horses, (amount) => String(Math.round(amount)));
      counters.set('Overdue horses', overdue);
      body.append(
        el('tr', {}, [
          el('td', { 'data-label': 'Figure', text: 'Overdue horses' }),
          el('td', { 'data-label': 'Amount', class: 'num' }, [overdue]),
        ]),
      );
      totalsHost.append(
        el('table', { class: 'stacked', 'aria-label': 'Month totals' }, [
          el('caption', { text: 'Month totals' }),
          el('thead', {}, [
            el('tr', {}, [el('th', { scope: 'col', text: 'Figure' }), el('th', { scope: 'col', text: 'Amount' })]),
          ]),
          body,
        ]),
      );
      return;
    }
    const previous = figures;
    const pairs: [string, number, number][] = [
      ['Billed', previous?.billed_cents ?? 0, next.billed_cents],
      ['Collected', previous?.collected_cents ?? 0, next.collected_cents],
      ['Refunded', previous?.refunded_cents ?? 0, next.refunded_cents],
      ['Outstanding', previous?.outstanding_cents ?? 0, next.outstanding_cents],
    ];
    for (const [label, from, to] of pairs) {
      const node = counters.get(label);
      if (node !== undefined) setCountingNumber(node, from, to, (amount) => money(Math.round(amount)));
    }
    const overdue = counters.get('Overdue horses');
    if (overdue !== undefined) {
      setCountingNumber(overdue, previous?.overdue_horses ?? 0, next.overdue_horses, (amount) =>
        String(Math.round(amount)),
      );
    }
  };

  const renderChart = (next: Dashboard): void => {
    clear(chartHost);
    const highest = Math.max(
      1,
      ...next.rows.map((row) => Math.max(row.billed_cents, row.collected_cents)),
    );
    const bars = next.rows.map((row) =>
      el('div', { class: 'pair' }, [
        el('div', {
          class: 'bar billed',
          style: `height:${(row.billed_cents / highest) * 100}%`,
          title: `${row.date} billed ${money(row.billed_cents)}`,
        }),
        el('div', {
          class: 'bar collected',
          style: `height:${(row.collected_cents / highest) * 100}%`,
          title: `${row.date} collected ${money(row.collected_cents)}`,
        }),
      ]),
    );
    chartHost.append(
      el('figure', { 'aria-label': 'Billed and collected' }, [
        el('div', { class: 'chart' }, bars),
        el('figcaption', {
          text:
            `Billed ${money(next.billed_cents)}, collected ${money(next.collected_cents)} ` +
            `in ${next.month}.`,
        }),
      ]),
    );
  };

  const renderDaily = (next: Dashboard): void => {
    clear(dailyHost);
    dailyHost.append(
      el(
        'table',
        { class: 'stacked', 'aria-label': 'Daily figures', tabindex: '0' },
        [
          el('caption', { text: 'Daily figures' }),
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Date' }),
              el('th', { scope: 'col', text: 'Billed' }),
              el('th', { scope: 'col', text: 'Collected' }),
              el('th', { scope: 'col', text: 'Refunded' }),
            ]),
          ]),
          el(
            'tbody',
            {},
            next.rows.map((row) =>
              el('tr', {}, [
                el('td', { 'data-label': 'Date', class: 'num', text: row.date }),
                el('td', { 'data-label': 'Billed', class: 'amount', text: money(row.billed_cents) }),
                el('td', { 'data-label': 'Collected', class: 'amount', text: money(row.collected_cents) }),
                el('td', { 'data-label': 'Refunded', class: 'amount', text: money(row.refunded_cents) }),
              ]),
            ),
          ),
        ],
      ),
    );
  };

  const refresh = async (): Promise<void> => {
    const next = await api.get<Dashboard>(`/api/dashboard?month=${encodeURIComponent(monthPicker.value)}`);
    renderTotals(next);
    renderChart(next);
    renderDaily(next);
    figures = next;
  };

  monthPicker.value = months[0] as string;
  monthPicker.addEventListener('change', () => void refresh());

  exportButton.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const handle = pending(exportButton, copy.preparingExport);
      try {
        const queued = await api.post<{ job_id: string }>('/api/dashboard/exports', {
          body: { month: monthPicker.value },
        });
        // "Download export" appears when the export job has finished.
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const job = await api.get<Job>(`/api/jobs/${queued.job_id}`);
          if (job.status === 'succeeded' && job.result?.url !== undefined) {
            handle.done();
            announceWithToast(copy.exportReady);
            clear(downloadHost);
            const link = el('a', { href: job.result.url, text: 'Download export', download: 'ledger.csv' });
            downloadHost.append(link);
            return;
          }
          if (job.status === 'dead') {
            handle.failed(copy.exportFailed);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        handle.failed(copy.exportFailed);
      } catch (error) {
        const failure = error instanceof ApiError ? error.failure : null;
        handle.failed(
          failure?.code === 'validation'
            ? (Object.values(failure.errors ?? {})[0] ?? copy.exportFailed)
            : failureCopy(error, copy.exportFailed),
        );
      }
    })();
  });

  await refresh();
  ctx.onRefresh(refresh, 30000);
}
