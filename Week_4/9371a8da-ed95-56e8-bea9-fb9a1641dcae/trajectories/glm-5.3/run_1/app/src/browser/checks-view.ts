import { el } from './dom.js';
import * as api from './api.js';
import type { CitationReport } from '../shared/types.js';
import { navigate, requestFocus, rerender } from './app-state.js';
import { projectUrl } from './router.js';
import { dialogFrame } from './dialogs.js';
import { isFailure, type ProjectHandle } from './actions.js';

/** The Citation warnings dialog, with three ruled lists. */
export function citationsDialog(h: ProjectHandle, close: () => void): HTMLElement {
  return dialogFrame({ title: 'Citation warnings', wide: true, close }, (body) => {
    const report = h.citationReport;
    const lists: { heading: string; items: { key: string; path: string; line: number }[] }[] = [
      { heading: 'Undefined citations', items: report?.undefined ?? [] },
      { heading: 'Unused entries', items: report?.unused ?? [] },
      { heading: 'Duplicate keys', items: report?.duplicate ?? [] },
    ];
    let focused = false;
    for (const list of lists) {
      const ul = el('ul', { class: 'ruled-list', 'aria-label': list.heading });
      const head = el('h3', {}, list.heading);
      body.appendChild(head);
      for (const item of list.items) {
        ul.appendChild(el('li', {}, el('a', {
          href: projectUrl(h.pid, { file: item.path, line: item.line }),
          onclick: (ev: Event) => {
            ev.preventDefault();
            close();
            navigate(projectUrl(h.pid, { file: item.path, line: item.line }));
          },
        }, `${item.key} ${item.path}:${item.line}`)));
      }
      if (list.items.length === 0) ul.appendChild(el('li', { class: 'meta' }, 'None'));
      body.appendChild(ul);
    }
    queueMicrotask(() => {
      if (!focused) {
        const first = body.querySelector('a');
        if (first) (first as HTMLElement).focus();
        else body.querySelector('.dialog')?.setAttribute('tabindex', '-1');
      }
    });
  });
}

/** The Submission check dialog with four readiness counts and export. */
export function submissionDialog(h: ProjectHandle, close: () => void): HTMLElement {
  return dialogFrame({ title: 'Submission check', close }, (body) => {
    const report = h.citationReport;
    const openSuggestions = h.suggestions.filter((s) => s.status === 'open').length;
    const openThreads = h.threads.filter((t) => t.status === 'open').length;
    const undefinedCitations = report?.undefined.length ?? 0;
    const duplicateKeys = report?.duplicate.length ?? 0;
    const lines = [
      `Open suggestions: ${openSuggestions}`,
      `Open threads: ${openThreads}`,
      `Undefined citations: ${undefinedCitations}`,
      `Duplicate keys: ${duplicateKeys}`,
    ];
    for (const line of lines) body.appendChild(el('p', {}, line));
    const allZero = openSuggestions === 0 && openThreads === 0 && undefinedCitations === 0 && duplicateKeys === 0;
    const exportBtn = el('button', {
      class: 'primary',
      disabled: !allZero,
      onclick: () => void doExport(),
    }, 'Export source');
    if (h.exportBusy) {
      exportBtn.setAttribute('aria-busy', 'true');
      exportBtn.setAttribute('aria-disabled', 'true');
    }
    body.appendChild(exportBtn);
    if (h.exportResult) {
      body.appendChild(el('p', { role: 'status' }, `Export of r${h.exportResult.export.projectRevision} ready to download`));
      const link = el('a', {
        href: h.exportResult.export.downloadUrl,
        id: 'download-link',
        onclick: (ev: Event) => { ev.preventDefault(); void download(h.exportResult?.export.downloadUrl ?? ''); },
      }, `Download ${h.exportResult.export.filename}`);
      body.appendChild(link);
    }
    async function doExport(): Promise<void> {
      if (h.exportBusy) return;
      h.exportBusy = true;
      h.message('Running submission check…');
      rerender();
      try {
        const res = await api.postExport(h.pid);
        h.exportResult = res;
        h.message(`Export of r${res.export.projectRevision} ready to download`);
        h.exportBusy = false;
        rerender();
        requestFocus('download-link');
      } catch (e) {
        h.exportBusy = false;
        if (isFailure(e)) {
          if (e.shape.status === 409 && e.shape.readiness) {
            const r = e.shape.readiness;
            h.message(`Not ready to export: ${r.openSuggestions} open suggestions, ${r.openThreads} open threads, ${r.undefinedCitations} undefined citations, ${r.duplicateKeys} duplicate keys`);
          } else if (e.shape.status === 503) {
            h.storageMessage('Figure storage unavailable. Text editing still works; try again shortly.');
          } else {
            h.message('Something went wrong. Try again.');
          }
        } else {
          h.message('Something went wrong. Try again.');
        }
        rerender();
      }
    }
  });
}

async function download(url: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) return;
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename="([^"]+)"/.exec(cd);
  a.download = m?.[1] ?? 'export.zip';
  a.click();
  URL.revokeObjectURL(a.href);
}
