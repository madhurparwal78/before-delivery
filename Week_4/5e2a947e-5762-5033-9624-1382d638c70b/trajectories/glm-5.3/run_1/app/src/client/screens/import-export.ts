import { el, openDialog } from '../lib/dom.js';
import { api, errorOf } from '../lib/api.js';
import type { EditorStore } from '../lib/store.js';

/**
 * dialog "Import outline" with the format help accordion, the preview
 * dialog, and dialog "Export" with the live progress bar.
 */

export function openImportDialog(store: EditorStore, mapId: string, opener: HTMLElement, focusedId: string): void {
  openDialog({
    label: 'Import outline',
    opener,
    build(body) {
      body.appendChild(el('h2', {}, 'Import outline'));
      const fileInput = el('input', { type: 'file', accept: '.txt', 'aria-label': 'Outline file' }) as HTMLInputElement;
      const help = el('div', {});
      const questions: [string, string][] = [
        ['What does the first line say?', 'The first line must be exactly "sprig 1".'],
        ['How is nesting written?', 'Each level below the first is indented by two spaces.'],
        ['Which fields can a topic line carry?', 'Fields follow the title, each written " | key=value".'],
        ['Which fields exist?', 'done, weight, state, priority, due, assignee, colour, icon, at and note.'],
        ['How do I mark a task?', 'Add " | done=<0-100>"; weight, state, priority, due and assignee are optional.'],
        ['What is not allowed in a note link?', 'Links must start with http:// or https://.'],
        ['How are special characters escaped?', 'Use \\\\ for a backslash, \\| for a pipe and \\n for a newline inside notes.'],
      ];
      for (const [q, a] of questions) {
        const row = el('button', { class: 'accordion-row', 'aria-expanded': 'false' }, q);
        const answer = el('p', { hidden: '' }, a);
        row.addEventListener('click', () => {
          const open = answer.hidden;
          answer.hidden = !open;
          row.setAttribute('aria-expanded', String(open));
        });
        help.append(row, answer);
      }
      body.append(fileInput, help);
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        store.announce(`Reading ${file.name}`);
        const bytes = await file.arrayBuffer();
        const res = await api<{ import: { id: string; topic_count: number }; preview: unknown }>(`/api/maps/${mapId}/imports`, 'POST', undefined, bytes, 'application/octet-stream');
        if (!res.ok) {
          const err = errorOf(res);
          const heading = el('h3', {}, "This file can't be imported:");
          openDialog({
            label: 'Import preview',
            build(previewBody, closePreview) {
              previewBody.appendChild(heading);
              for (const line of err.lines ?? [err.message]) {
                previewBody.appendChild(el('p', {}, line));
              }
              const cancel = el('button', { class: 'secondary', 'aria-label': 'Cancel' }, 'Cancel');
              cancel.addEventListener('click', closePreview);
              previewBody.appendChild(cancel);
            },
          });
          return;
        }
        const data = res.body as { import: { id: string; topic_count: number }; preview: unknown };
        openDialog({
          label: 'Import preview',
          build(previewBody, closePreview) {
            const t = store.state.topics.get(focusedId);
            previewBody.appendChild(el('p', {}, `Adds ${data.import.topic_count} ${data.import.topic_count === 1 ? 'topic' : 'topics'} under ${t?.title ?? ''}.`));
            const add = el('button', { class: 'primary', 'aria-label': 'Add to map' }, 'Add to map');
            add.addEventListener('click', async () => {
              const res2 = await api(`/api/maps/${mapId}/imports/${data.import.id}/graft`, 'POST', {
                parent_id: focusedId, group_id: `g-${crypto.randomUUID()}`, base_revision: store.state.revision,
              });
              if (res2.ok) { closePreview(); await store.refreshLocal(); }
              else store.announce(errorOf(res2).message);
            });
            const cancel = el('button', { class: 'secondary', 'aria-label': 'Cancel' }, 'Cancel');
            cancel.addEventListener('click', closePreview);
            previewBody.append(add, cancel);
          },
        });
      });
    },
  });
}

export function openExportDialog(store: EditorStore, mapId: string, opener: HTMLElement): void {
  openDialog({
    label: 'Export',
    opener,
    build(body, close) {
      body.appendChild(el('h2', {}, 'Export'));
      const sprig = el('input', { type: 'radio', name: 'exportformat', id: 'fmt-sprig', checked: '', 'aria-label': 'Sprig outline' }) as HTMLInputElement;
      const svg = el('input', { type: 'radio', name: 'exportformat', id: 'fmt-svg', 'aria-label': 'SVG picture' }) as HTMLInputElement;
      body.append(sprig, el('label', { for: 'fmt-sprig' }, 'Sprig outline'), svg, el('label', { for: 'fmt-svg' }, 'SVG picture'));
      const start = el('button', { class: 'primary', 'aria-label': 'Start export' }, 'Start export');
      const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Export', hidden: '' });
      const fill = el('div', {});
      bar.appendChild(fill);
      const download = el('a', { class: 'textlink', hidden: '', 'aria-label': 'Download export' }, 'Download export');
      const retry = el('button', { class: 'secondary', 'aria-label': 'Retry export', hidden: '' }, 'Retry export');
      body.append(start, bar, download, retry);
      start.addEventListener('click', async () => {
        const res = await api<{ export: { id: string } }>(`/api/maps/${mapId}/exports`, 'POST', { format: sprig.checked ? 'sprig' : 'svg', topic_id: null });
        if (!res.ok) { store.announce(errorOf(res).message); return; }
        const id = (res.body as { export: { id: string } }).export.id;
        start.hidden = true;
        bar.hidden = false;
        const poll = async () => {
          const res2 = await api<{ export: { state: string; progress: number; download_url: string | null } }>(`/api/exports/${id}`);
          if (!res2.ok) return;
          const ex = (res2.body as { export: { state: string; progress: number; download_url: string | null } }).export;
          bar.setAttribute('aria-valuenow', String(ex.progress));
          fill.style.width = `${ex.progress}%`;
          if (ex.state === 'ready') {
            bar.hidden = true;
            download.setAttribute('href', ex.download_url ?? '');
            download.hidden = false;
            store.announce('Export ready.');
          } else if (ex.state === 'failed') {
            bar.hidden = true;
            retry.hidden = false;
            store.announce('Export failed: file storage is unavailable.');
          } else {
            setTimeout(() => void poll(), 250);
          }
        };
        void poll();
      });
      retry.addEventListener('click', async () => {
        // Retry needs the last export id; the poll closure above holds it.
        const res = await api<{ export: { id: string } }>(`/api/maps/${mapId}/exports`, 'POST', { format: sprig.checked ? 'sprig' : 'svg', topic_id: null });
        if (res.ok) {
          retry.hidden = true;
          const id2 = (res.body as { export: { id: string } }).export.id;
          bar.hidden = false;
          const poll2 = async () => {
            const res2 = await api<{ export: { state: string; progress: number } }>(`/api/exports/${id2}`);
            if (!res2.ok) return;
            const ex = (res2.body as { export: { state: string; progress: number } }).export;
            fill.style.width = `${ex.progress}%`;
            if (ex.state === 'ready') { bar.hidden = true; download.hidden = false; store.announce('Export ready.'); }
            else if (ex.state === 'failed') { bar.hidden = true; retry.hidden = false; store.announce('Export failed: file storage is unavailable.'); }
            else setTimeout(() => void poll2(), 250);
          };
          void poll2();
        }
      });
      void close;
    },
  });
}
