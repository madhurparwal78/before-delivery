import { send } from '../api.js';
import { el } from '../dom.js';
import { onEvent } from '../events.js';
import type { FilterSpec } from '../../shared/types.js';

type Kind = 'pdf' | 'png' | 'csv';

const KIND_WORDS: Record<Kind, string> = { pdf: 'PDF', png: 'PNG', csv: 'crosstab' };

interface JobReply {
  id: string;
  kind: Kind;
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  progress: number;
  download: string | null;
}

export interface ExportTarget {
  sheet?: string;
  dashboard?: string;
  filters: () => FilterSpec[];
  parameters: () => Record<string, unknown>;
}

export function buildExportControls(target: ExportTarget): HTMLElement {
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Export state', class: 'status' });
  const progress = el('div', {
    role: 'progressbar',
    'aria-label': 'Export progress',
    'aria-valuenow': '0',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    class: 'progress',
  });
  const downloads = el('div', { class: 'row' });
  const banner = el('p', { class: 'status banner', hidden: true });
  let currentKind: Kind = 'pdf';
  let currentJob: string | null = null;

  const retry = el('button', { type: 'button', class: 'pill-button', text: 'Try again', hidden: true });

  const apply = (job: JobReply): void => {
    const words: Record<JobReply['status'], string> = {
      queued: 'Queued',
      rendering: 'Rendering',
      ready: 'Ready',
      failed: 'Failed. Try again.',
    };
    status.textContent = words[job.status];
    progress.setAttribute('aria-valuenow', String(job.progress));
    downloads.replaceChildren();
    retry.hidden = job.status !== 'failed';
    if (job.status === 'ready' && job.download !== null) {
      const href = job.download;
      const link = el('a', {
        href,
        class: 'pill-link',
        download: '',
        text: `Download ${KIND_WORDS[job.kind]}`,
      });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void (async () => {
          const res = await fetch(href, { credentials: 'same-origin' });
          if (!res.ok) {
            banner.hidden = false;
            banner.textContent = 'Storage is unavailable. Try again.';
            return;
          }
          banner.hidden = true;
          const disposition = res.headers.get('content-disposition') ?? '';
          const match = /filename="([^"]+)"/.exec(disposition);
          const url = URL.createObjectURL(await res.blob());
          const anchor = el('a', { href: url, download: match === null ? `export.${job.kind}` : match[1] });
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        })();
      });
      downloads.append(link);
    }
  };

  const follow = (jobId: string): void => {
    const stream = new EventSource(`/api/exports/${jobId}/events`);
    stream.addEventListener('state', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { status: JobReply['status']; progress: number };
      apply({ id: jobId, kind: currentKind, status: data.status, progress: data.progress, download: data.status === 'ready' ? `/api/exports/${jobId}/file` : null });
    });
    stream.addEventListener('end', () => stream.close());
  };

  const start = (kind: Kind): void => {
    void (async () => {
      currentKind = kind;
      banner.hidden = true;
      const body: Record<string, unknown> = {
        kind,
        filters: target.filters(),
        parameters: target.parameters(),
      };
      if (target.sheet !== undefined) body.sheet = target.sheet;
      if (target.dashboard !== undefined) body.dashboard = target.dashboard;
      const res = await send<JobReply>('POST', '/api/exports', body);
      if (res.status !== 202 && res.status !== 200) {
        status.textContent = 'Failed. Try again.';
        retry.hidden = false;
        return;
      }
      currentJob = res.data.id;
      apply({ ...res.data, kind });
      follow(res.data.id);
    })();
  };

  retry.addEventListener('click', () => {
    if (currentJob === null) return;
    void (async () => {
      const res = await send<JobReply>('POST', `/api/exports/${currentJob}/retry`);
      if (res.status === 202) {
        apply({ ...res.data, kind: currentKind });
        follow(res.data.id);
      }
    })();
  });

  onEvent('export', (event) => {
    if (event.id !== currentJob) return;
    apply({
      id: event.id,
      kind: currentKind,
      status: event.status,
      progress: event.progress,
      download: event.status === 'ready' ? `/api/exports/${event.id}/file` : null,
    });
  });

  const pdf = el('button', { type: 'button', class: 'pill-button', text: 'Export PDF' });
  const png = el('button', { type: 'button', class: 'pill-button', text: 'Export PNG' });
  const csv = el('button', { type: 'button', class: 'pill-button', text: 'Export crosstab' });
  pdf.addEventListener('click', () => start('pdf'));
  png.addEventListener('click', () => start('png'));
  csv.addEventListener('click', () => start('csv'));

  return el('div', { class: 'export-controls' }, [
    el('div', { class: 'row' }, [pdf, png, csv, retry]),
    status,
    progress,
    downloads,
    banner,
  ]);
}
