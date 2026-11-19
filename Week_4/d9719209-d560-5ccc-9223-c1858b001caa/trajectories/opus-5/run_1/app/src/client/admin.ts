import { reportRow } from '../shared/render.js';
import type { ReportView } from '../shared/types.js';
import { request } from './api.js';
import { alertAnnounce, announce, on, qs } from './dom.js';
import { openDialog } from './overlays.js';
import { page } from './state.js';

const REFRESH_MS = 5000;

interface QueuePayload {
  items: ReportView[];
  serverTime: string;
}

async function authorFor(report: ReportView): Promise<string | null> {
  if (report.target.type === 'post') {
    const result = await request<{ author: { username: string } | null }>(`/api/posts/${report.target.id}`);
    return result.data?.author?.username ?? null;
  }
  const result = await request<{ tree: Array<{ id: string; author: { username: string } | null }> }>(
    `/api/comments/${report.target.id}/thread?depth=1`,
  );
  return result.data?.tree?.[0]?.author?.username ?? null;
}

async function paint(reports: ReportView[]): Promise<void> {
  const body = qs<HTMLElement>('[data-report-body]');
  if (!body) return;
  const authors = new Map<string, string>();
  for (const report of reports) {
    const username = await authorFor(report);
    if (username) authors.set(report.reference, username);
  }
  body.innerHTML = reports
    .map((report) => reportRow(report, authors.get(report.reference) ?? null).value)
    .join('');
}

/** The queue refetches on a page timer and whenever the tab becomes visible. */
async function refresh(): Promise<void> {
  const result = await request<QueuePayload>('/api/admin/reports?status=open');
  if (!result.ok || !result.data) return;
  await paint(result.data.items);
}

function suspendDialog(username: string, opener: HTMLElement | null): void {
  const dialog = openDialog({
    title: 'Suspend account',
    opener,
    body: `
      <div class="field">
        <label for="suspend-reason">Reason</label>
        <textarea id="suspend-reason" rows="3"></textarea>
      </div>
      <div class="dialog-actions">
        <button type="button" data-confirm>Suspend</button>
        <button type="button" data-dialog-cancel>Cancel</button>
      </div>`,
  });
  qs('[data-confirm]', dialog.element)?.addEventListener('click', () => {
    const reason = qs<HTMLTextAreaElement>('#suspend-reason', dialog.element)?.value.trim() ?? '';
    void (async () => {
      const result = await request(`/api/admin/users/${username}/suspension`, {
        method: 'POST',
        body: { reason: reason === '' ? 'Illegal content' : reason },
      });
      dialog.close();
      if (result.ok) {
        announce(`Suspended ${username}`);
        await refresh();
      } else {
        alertAnnounce(result.error?.message ?? 'That account cannot be suspended');
      }
    })();
  });
}

export function initAdmin(): void {
  if (page.route !== 'admin') return;
  void paint(page.reports ?? []);

  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const suspend = target?.closest<HTMLElement>('[data-suspend]');
    if (suspend) {
      suspendDialog(suspend.dataset.suspend ?? '', suspend);
      return;
    }
    const resolve = target?.closest<HTMLElement>('[data-resolve]');
    if (resolve) {
      void request(`/api/admin/reports/${resolve.dataset.resolve}/resolve`, {
        method: 'POST',
        body: { outcome: resolve.dataset.outcome },
      }).then(() => refresh());
    }
  });

  window.setInterval(() => void refresh(), REFRESH_MS);
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
}
