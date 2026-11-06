import { api } from '../api';
import { clear, el } from '../dom';
import { openDialog, DialogHandle } from './dialog';
import { RevisionDto, BlockDto } from '../types';
import { shortStamp } from '../../shared/homeclock';
import { homeZone } from '../state';
import { COPY, restoredCopy } from '../../shared/copy';
import { frame } from '../frame';
import { DiffOp } from '../../shared/worddiff';
import { onLive } from '../live';
import { activeUndoStack } from './undo';

export type HistoryOptions = {
  blockId: string;
  opener: HTMLElement;
  currentVersion: () => number;
  onRestored: (block: BlockDto, restoredVersion: number) => void;
};

export function openBlockHistory(options: HistoryOptions): DialogHandle {
  let revisions: RevisionDto[] = [];
  const revisionList = el('div', {
    className: 'revision-list',
    attrs: { role: 'listbox', 'aria-label': 'Revisions' },
  });
  const fromSelect = el('select', { className: 'compare', attrs: { 'aria-label': 'Compare from' } });
  const toSelect = el('select', { className: 'compare', attrs: { 'aria-label': 'Compare to' } });
  const changes = el('div', { className: 'changes', attrs: { role: 'region', 'aria-label': 'Changes' } });
  const restore = el('button', {
    className: 'restore',
    text: 'Restore this version',
    attrs: { type: 'button' },
  });

  const handle = openDialog({
    label: 'Block history',
    className: 'block-history',
    opener: options.opener,
    content: () => [
      el('div', { className: 'history-columns', children: [revisionList] }),
      el('div', {
        className: 'history-compare',
        children: [
          el('label', { text: 'Compare from' }),
          fromSelect,
          el('label', { text: 'Compare to' }),
          toSelect,
        ],
      }),
      changes,
      restore,
    ],
    onClose: () => stopLive(),
  });

  function label(revision: RevisionDto): string {
    return `Version ${revision.version}, ${revision.label}, ${shortStamp(new Date(revision.created_at), homeZone())}`;
  }

  function renderRevisions(): void {
    clear(revisionList);
    for (const revision of revisions) {
      const option = el('div', {
        className: 'revision-option',
        text: label(revision),
        attrs: {
          role: 'option',
          tabindex: '0',
          'aria-selected': String(Number(fromSelect.value) === revision.version),
        },
      });
      option.addEventListener('click', () => {
        fromSelect.value = String(revision.version);
        renderRevisions();
        void refreshDiff();
      });
      option.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          option.click();
        }
      });
      revisionList.append(option);
    }
    const options = (select: HTMLSelectElement, keep: string): void => {
      clear(select);
      for (const revision of revisions) {
        select.append(
          el('option', { text: label(revision), attrs: { value: String(revision.version) } }),
        );
      }
      if (revisions.some((revision) => String(revision.version) === keep)) select.value = keep;
    };
    const keepFrom = fromSelect.value;
    const keepTo = toSelect.value;
    options(fromSelect, keepFrom);
    options(toSelect, keepTo);
    if (keepFrom === '') {
      fromSelect.value = String(revisions[Math.min(1, revisions.length - 1)]?.version ?? '');
    }
    if (keepTo === '') toSelect.value = String(revisions[0]?.version ?? '');
  }

  function renderDiff(ops: DiffOp[]): void {
    clear(changes);
    for (const op of ops) {
      if (op.op === 'equal') changes.append(el('span', { text: op.text }));
      else if (op.op === 'delete') changes.append(el('del', { text: op.text }));
      else changes.append(el('ins', { text: op.text }));
    }
  }

  async function refreshDiff(): Promise<void> {
    const from = fromSelect.value;
    const to = toSelect.value;
    if (from === '' || to === '') return;
    const result = await api.get<{ ops: DiffOp[] }>(
      `/api/blocks/${options.blockId}/diff?from=${from}&to=${to}`,
    );
    if (result.ok) renderDiff(result.data.ops);
  }

  async function load(): Promise<void> {
    const result = await api.get<{ revisions: RevisionDto[] }>(`/api/blocks/${options.blockId}/revisions`);
    if (!result.ok) return;
    revisions = result.data.revisions;
    renderRevisions();
    await refreshDiff();
  }

  fromSelect.addEventListener('change', () => void refreshDiff());
  toSelect.addEventListener('change', () => void refreshDiff());

  restore.addEventListener('click', () => {
    void (async () => {
      const version = Number(fromSelect.value);
      const result = await api.post<BlockDto>(`/api/blocks/${options.blockId}/restore`, {
        version,
        base_version: options.currentVersion(),
      });
      if (!result.ok) {
        if (result.status === 409) frame().showAlert(COPY.restoreStale);
        return;
      }
      frame().announce(restoredCopy(version, result.data.version));
      options.onRestored(result.data, version);
      const previousVersion = result.data.version - 1;
      activeUndoStack()?.push({
        kind: 'restore',
        undo: async () => {
          const back = await api.post<BlockDto>(`/api/blocks/${options.blockId}/restore`, {
            version: previousVersion,
            base_version: options.currentVersion(),
          });
          if (!back.ok) return { ok: false, reason: back.status === 409 ? 'conflict' : 'gone' };
          options.onRestored(back.data, previousVersion);
          await load();
          return { ok: true };
        },
        redo: async () => {
          const again = await api.post<BlockDto>(`/api/blocks/${options.blockId}/restore`, {
            version,
            base_version: options.currentVersion(),
          });
          if (!again.ok) return { ok: false, reason: again.status === 409 ? 'conflict' : 'gone' };
          options.onRestored(again.data, version);
          await load();
          return { ok: true };
        },
      });
      await load();
    })();
  });

  const stopLive = onLive((type, data) => {
    if (type !== 'block.saved') return;
    const block = data['block'] as BlockDto | undefined;
    if (block === undefined) return;
    if (block.id !== options.blockId && block.origin?.block_id !== options.blockId) return;
    void load();
  });

  void load();
  return handle;
}
