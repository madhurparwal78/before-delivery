/* Mission history and client flags screens. */
import { apiFetch, ApiError } from './api.js';
import { h, clear, focusSafe, openModal } from './dom.js';

interface HistoryEvent {
  seq: number; at: string; kind: string; actor: string; summary: string;
}

export const HISTORY_KIND_LABELS: Record<string, string> = {
  created: 'Created', assignments: 'Assignments', status: 'Status', line: 'Line',
  file: 'File', alert: 'Alert', infill: 'Infill', owner: 'Owner', hold: 'Hold',
  geofence: 'Geofence', rerun: 'Rerun',
};

export async function renderHistory(root: HTMLElement, missionId: string, missionName: string, kindsParam: string | null): Promise<void> {
  clear(root);
  const statusEl = h('div', { id: 'history-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'History status', class: 'banner mono' });
  const list = h('ul', { class: 'history-list', 'aria-label': 'Mission events' });

  const allKinds = Object.keys(HISTORY_KIND_LABELS);
  const selected = new Set<string>(kindsParam ? kindsParam.split(',').filter(k => allKinds.includes(k)) : allKinds);

  const checkboxes = h('div', { class: 'event-kinds', role: 'group', 'aria-label': 'Event kinds' });
  let before: number | null = null;
  let shownCount = 0;
  let moreBtn: HTMLElement | null = null;

  const buildCheckboxes = (): void => {
    clear(checkboxes);
    for (const k of allKinds) {
      const cb = h('input', { type: 'checkbox', ...(selected.has(k) ? { checked: true } : {}) }) as HTMLInputElement;
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(k); else selected.delete(k);
        const p = new URLSearchParams(location.search);
        const active = allKinds.filter(kk => selected.has(kk));
        if (active.length === allKinds.length) p.delete('kinds');
        else p.set('kinds', active.join(','));
        window.history.replaceState({}, '', location.pathname + (p.toString() ? `?${p}` : ''));
        before = null;
        void loadEvents(false);
      });
      checkboxes.append(h('label', { class: 'kind-label' }, cb, HISTORY_KIND_LABELS[k]));
    }
  };

  const loadEvents = async (append: boolean): Promise<void> => {
    const kinds = [...selected];
    const q = new URLSearchParams();
    if (kinds.length !== allKinds.length) q.set('kinds', kinds.join(','));
    if (append && before !== null) q.set('before', String(before));
    try {
      const resp = await apiFetch<{ events: HistoryEvent[]; next: number | null }>('GET', `/api/missions/${missionId}/history${q.toString() ? `?${q}` : ''}`);
      if (!append) { clear(list); shownCount = 0; }
      for (const e of resp.events) {
        shownCount += 1;
        list.append(h('li', { class: 'mono history-item', tabindex: '-1' },
          `${e.at.slice(0, 10)} ${e.at.slice(11, 19)} UTC · ${e.actor} · ${e.summary}`));
      }
      statusEl.textContent = `Showing ${shownCount} events`;
      before = resp.next;
      if (before === null) {
        moreBtn?.remove();
        moreBtn = null;
      } else if (!moreBtn) {
        moreBtn = h('button', { id: 'load-older-btn', class: 'btn subtle' }, 'Load older events');
        moreBtn.addEventListener('click', () => {
          const prevCount = list.children.length;
          void loadEvents(true).then(() => {
            const firstNew = list.children[prevCount] as HTMLElement | null;
            focusSafe(firstNew);
          });
        });
        root.append(moreBtn);
      }
    } catch (err) {
      const e2 = err as ApiError;
      statusEl.textContent = e2.body?.message ?? 'Could not load the history';
    }
  };

  buildCheckboxes();
  root.append(
    h('h1', {}, `History of ${missionName}`),
    checkboxes,
    statusEl,
    list,
  );
  await loadEvents(false);
}

interface FlagRow {
  id: string; mission_id: string; mission_name: string; line_id: string; line_label: string;
  comment: string; by: string; at: string; state: string; reply: string | null; client_name: string;
}

export async function renderFlags(root: HTMLElement): Promise<void> {
  clear(root);
  const statusEl = h('div', { id: 'flags-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Flags status', class: 'banner' });
  const list = h('ul', { class: 'flags-list', 'aria-label': 'Open flags' });
  const load = async (): Promise<void> => {
    try {
      const flags = await apiFetch<FlagRow[]>('GET', '/api/flags?state=open');
      clear(list);
      for (const f of flags) {
        const replyBtn = h('button', { class: 'btn subtle', 'aria-label': `Reply to ${f.line_label}` }, `Reply to ${f.line_label}`);
        replyBtn.addEventListener('click', () => {
          openModal({ label: 'Reply to flag' }, (root2, close) => {
            const text = h('textarea', { 'aria-label': 'Reply', rows: '3' }) as HTMLTextAreaElement;
            const errEl = h('p', { class: 'field-error' });
            const send = h('button', { class: 'btn primary' }, 'Send reply');
            send.addEventListener('click', async () => {
              try {
                await apiFetch('POST', `/api/flags/${f.id}/reply`, { text: text.value });
                statusEl.textContent = `Reply sent for ${f.line_label}`;
                close();
                void load();
              } catch (err) {
                const e2 = err as ApiError;
                errEl.textContent = e2.body?.errors?.text ?? e2.body?.message ?? 'Could not send the reply';
              }
            });
            root2.append(h('h2', {}, `Reply to flag on ${f.line_label}`),
              h('p', {}, `${f.client_name} · ${f.mission_name} · ${f.line_label} — “${f.comment}”`),
              h('label', {}, 'Reply'), text, errEl,
              h('div', { class: 'dialog-actions' }, send, h('button', { class: 'btn subtle', onclick: close }, 'Cancel')));
            text.focus();
          });
        });
        list.append(h('li', { class: 'flag-item mono' },
          `${f.client_name} · ${f.mission_name} · ${f.line_label} · ${f.comment}`,
          replyBtn));
      }
    } catch {
      statusEl.textContent = 'Could not load the flags';
    }
  };
  root.append(h('h1', {}, 'Client flags'), statusEl, list);
  await load();
}
