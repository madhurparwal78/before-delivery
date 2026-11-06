// Block history: every kept revision, a word diff between two of them, and restore.
import { useCallback, useEffect, useState } from 'react';
import { api, get } from '../api.ts';
import { Dialog } from '../Dialog.tsx';
import { useSession } from '../session.ts';
import { useSync } from '../sync.ts';
import type { BlockJson, BlockSavedEvent, RevisionJson } from '../types.ts';
import { shortTime } from '../../shared/time.ts';
import type { DiffOp } from '../../shared/diff.ts';

export function HistoryDialog({ blockId, currentVersion, onRestore, onClose, returnFocus }: {
  blockId: string;
  /** the version the block has on screen, named as the restore's base */
  currentVersion: () => number;
  onRestore: (restored: number, block: BlockJson, previous: number) => void;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const { zone } = useSession();
  const [revisions, setRevisions] = useState<RevisionJson[]>([]);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffOp[]>([]);

  const load = useCallback(async (initial: boolean) => {
    const r = await get<{ revisions: RevisionJson[] }>(`/api/blocks/${blockId}/revisions`);
    if (r.status !== 200) return;
    setRevisions(r.data.revisions);
    if (initial) {
      const versions = r.data.revisions.map((x) => x.version);
      setTo(versions[0] ?? null);
      setFrom(versions[1] ?? versions[0] ?? null);
    }
  }, [blockId]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useSync((event, data) => {
    if (event === 'block.saved') {
      const e = data as BlockSavedEvent;
      const id = e.block.kind === 'quote' ? e.block.origin?.block_id : e.block.id;
      if (id === blockId) void load(false);
    } else if (event === 'sync.reset') void load(false);
  });

  useEffect(() => {
    if (from === null || to === null) return;
    let live = true;
    void get<{ ops: DiffOp[] }>(`/api/blocks/${blockId}/diff?from=${from}&to=${to}`).then((r) => {
      if (live && r.status === 200) setDiff(r.data.ops);
    });
    return () => {
      live = false;
    };
  }, [blockId, from, to]);

  const restore = async () => {
    if (from === null) return;
    const previous = currentVersion();
    const r = await api<BlockJson>('POST', `/api/blocks/${blockId}/restore`, { version: from, base_version: previous });
    if (r.status === 200) {
      onRestore(from, r.data, previous);
      await load(false);
    } else if (r.status === 409) onRestore(-1, (r.data as unknown as { current: BlockJson }).current, previous);
  };

  const label = (r: RevisionJson): string => `Version ${r.version}, ${r.label}, ${shortTime(Date.parse(r.created_at), zone)}`;
  const choice = (r: RevisionJson): string => `Version ${r.version} · ${r.label} · ${shortTime(Date.parse(r.created_at), zone)}`;

  return (
    <Dialog label="Block history" onClose={onClose} className="history" returnFocus={returnFocus}>
      <h2>Block history</h2>
      <div className="history-grid">
        <ul role="listbox" aria-label="Revisions" className="option-list revisions" tabIndex={0}
          aria-activedescendant={from !== null ? `revision-${from}` : undefined}
          onKeyDown={(e) => {
            const i = revisions.findIndex((r) => r.version === from);
            if (e.key === 'ArrowDown' && i < revisions.length - 1) {
              e.preventDefault();
              setFrom(revisions[i + 1].version);
            } else if (e.key === 'ArrowUp' && i > 0) {
              e.preventDefault();
              setFrom(revisions[i - 1].version);
            }
          }}
        >
          {revisions.map((r) => (
            <li key={r.version} id={`revision-${r.version}`} role="option" aria-selected={r.version === from} aria-label={label(r)}
              className="option" onClick={() => setFrom(r.version)}>
              <span className="mono">v{r.version}</span> <span>{r.label}</span> <time>{shortTime(Date.parse(r.created_at), zone)}</time>
            </li>
          ))}
        </ul>
        <div>
          <div className="compare-row">
            <div className="field">
              <label htmlFor="compare-from">Compare from</label>
              <select id="compare-from" value={from ?? ''} onChange={(e) => setFrom(Number(e.target.value))}>
                {revisions.map((r) => <option key={r.version} value={r.version}>{choice(r)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="compare-to">Compare to</label>
              <select id="compare-to" value={to ?? ''} onChange={(e) => setTo(Number(e.target.value))}>
                {revisions.map((r) => <option key={r.version} value={r.version}>{choice(r)}</option>)}
              </select>
            </div>
          </div>
          <section role="region" aria-label="Changes" className="changes">
            {diff.map((d, i) => (d.op === 'delete' ? <del key={i}>{d.text}</del> : d.op === 'insert' ? <ins key={i}>{d.text}</ins> : <span key={i}>{d.text}</span>))}
          </section>
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={() => void restore()}>Restore this version</button>
      </div>
    </Dialog>
  );
}
