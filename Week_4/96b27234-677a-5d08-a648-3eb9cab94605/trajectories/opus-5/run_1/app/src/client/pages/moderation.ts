import { api } from '../api.js';
import { clear, el, focusHeading } from '../dom.js';
import { HEADING, heading } from '../shell.js';
import { button, statusRegion } from '../widgets.js';
import type { ReportView } from '../types.js';
import type { PageContext } from '../main.js';

export async function renderModeration(ctx: PageContext): Promise<void> {
  if (ctx.me === null || ctx.me.siteRole !== 'moderator') {
    heading(ctx.main, HEADING.notFound);
    return;
  }
  heading(ctx.main, 'Report queue');
  const result = statusRegion('Moderation result');
  const body = el('tbody', {});
  const table = el('table', { 'aria-label': 'Reports', class: 'grid' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Person' }),
        el('th', { text: 'Room' }),
        el('th', { text: 'Category' }),
        el('th', { text: 'Details' }),
        el('th', { text: 'State' }),
        el('th', { text: 'Decisions' })
      ])
    ]),
    body
  ]);
  ctx.main.append(el('section', { class: 'panel' }, [el('div', { class: 'table-wrap' }, [table]), result]));

  const move = async (report: ReportView, state: string, action: string | null): Promise<void> => {
    result.textContent = 'Saving...';
    const response = await api.post(`/api/moderation/reports/${report.id}/move`, {
      state,
      ...(action === null ? {} : { action })
    });
    result.textContent = response.ok ? `Report moved to ${state}.` : (response.error ?? '');
    await draw();
  };

  async function draw(): Promise<void> {
    const response = await api.get<{ reports: ReportView[] }>('/api/moderation/reports');
    const focused = document.activeElement;
    clear(body);
    for (const report of response.data?.reports ?? []) {
      const decisions = el('td', {});
      if (report.state === 'open') {
        const start = button('Start review', 'primary');
        start.addEventListener('click', () => void move(report, 'reviewing', null));
        decisions.append(start);
      }
      if (report.state === 'reviewing') {
        const warn = button('Warn');
        warn.addEventListener('click', () => void move(report, 'upheld', 'warn'));
        const suspend = button('Suspend', 'danger');
        suspend.addEventListener('click', () => void move(report, 'upheld', 'suspend'));
        const dismiss = button('Dismiss');
        dismiss.addEventListener('click', () => void move(report, 'dismissed', null));
        decisions.append(warn, suspend, dismiss);
      }
      body.append(
        el('tr', { 'data-report-id': report.id, 'data-report-state': report.state }, [
          el('td', { text: report.personName }),
          el('td', { text: report.roomName }),
          el('td', { text: report.category }),
          el('td', { text: report.details }),
          el('td', { text: report.state }),
          decisions
        ])
      );
    }
    if (focused !== null && focused !== document.body && !focused.isConnected) focusHeading();
  }

  await draw();
}
