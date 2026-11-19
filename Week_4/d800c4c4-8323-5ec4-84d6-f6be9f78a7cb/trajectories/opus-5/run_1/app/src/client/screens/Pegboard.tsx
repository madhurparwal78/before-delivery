import { useEffect, useRef, useState } from 'react';
import { HOLDS_NEED_ACTIVE, NO_QUEUE_LINE, NO_TOOLS_MATCH } from '../../shared/copy';
import { formatDollars } from '../../shared/format';
import { itemStatusWord, outlineStateWord, shapeClassFor } from '../../shared/status-words';
import type { Hold, Item } from '../../shared/types';
import { Board, type BoardPart } from '../components/Board';
import { FormProblems } from '../components/FormProblems';
import { Announcements } from '../components/Shell';
import { api, ApiFailed } from '../lib/api';
import { useApp } from '../lib/app-context';
import { paneCount, usePoll, useViewportWidth } from '../lib/hooks';

function matches(item: Item, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return true;
  return (
    item.tag.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle)
  );
}

export function Pegboard(): JSX.Element {
  const app = useApp();
  const { board, viewer, announce, navigate, reducedMotion, restoredDraft, consumeDraft } = app;
  const [filter, setFilter] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [holdPending, setHoldPending] = useState(false);
  const holds = usePoll<{ holds: Hold[] }>(viewer?.user.role === 'member' ? '/api/holds' : null, 10000);
  const detail = useRef<HTMLDivElement>(null);
  const announceTimer = useRef<number | null>(null);
  const width = useViewportWidth();
  const panes = paneCount(width);

  useEffect(() => {
    if (!restoredDraft) return;
    if (restoredDraft.fields.filter !== undefined) setFilter(restoredDraft.fields.filter);
    if (restoredDraft.selectedItemId !== null) setSelectedItemId(restoredDraft.selectedItemId);
    consumeDraft();
  }, [restoredDraft, consumeDraft]);

  const items = board?.items ?? [];
  const shown = items.filter((item) => matches(item, filter));
  const selected = items.find((item) => item.id === selectedItemId) ?? null;

  function onFilterChange(value: string): void {
    setFilter(value);
    const count = items.filter((item) => matches(item, value)).length;
    if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => {
      announce(count === 1 ? '1 tool matches.' : `${count} tools match.`);
    }, 120);
  }

  function select(itemId: number): void {
    setSelectedItemId(itemId);
    if (panes === 1) {
      window.setTimeout(() => detail.current?.scrollIntoView({ block: 'nearest' }), 0);
    }
  }

  async function placeHold(): Promise<void> {
    if (!selected || holdPending) return;
    setHoldPending(true);
    try {
      const result = await api.post<{ hold: Hold }>('/api/holds', { item_id: selected.id });
      announce(`Hold placed. You are number ${result.hold.position ?? 0} in the queue.`);
      await holds.reload();
      await app.reloadBoard();
    } catch (error) {
      if (error instanceof ApiFailed) announce(error.error);
    } finally {
      setHoldPending(false);
    }
  }

  const memberActive = viewer?.membership?.status === 'active';
  const alreadyHolding =
    selected !== null &&
    (holds.data?.holds ?? []).some(
      (hold) =>
        hold.item_id === selected.id && (hold.status === 'queued' || hold.status === 'ready'),
    );
  const holdable = selected !== null && selected.status !== 'on-wall' && !alreadyHolding;

  const toolList = (
    <section className="pane pane-list" aria-label="Tool list">
      <h2>Tool list</h2>
      <label className="search-label">
        Find a tool
        <input
          type="search"
          aria-label="Find a tool"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </label>
      <table aria-label="Tools" className="ledger">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Tool</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={3}>{NO_TOOLS_MATCH}</td>
            </tr>
          ) : (
            shown.map((item) => (
              <tr
                key={item.id}
                className={item.id === selectedItemId ? 'row-selected' : ''}
                onClick={() => select(item.id)}
              >
                <td className="numerals">{item.tag}</td>
                <td>
                  <button type="button" className="row-link" onClick={() => select(item.id)}>
                    {item.name}
                  </button>
                </td>
                <td>
                  <span className={shapeClassFor(itemStatusWord(item.status))}>
                    {itemStatusWord(item.status)}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );

  const boardPane = (
    <section className="pane pane-board" aria-label="Pegboard">
      <h2>Pegboard</h2>
      <Board
        items={items}
        rows={board?.rows ?? 0}
        selectedItemId={selectedItemId}
        pickedPartId={null}
        hoverPartId={null}
        snapPartId={null}
        settledPartIds={new Set()}
        reducedMotion={reducedMotion}
        onActivate={(entry: BoardPart) => select(entry.item.id)}
        registerOutline={() => undefined}
      />
    </section>
  );

  const detailPane = (
    <section className="pane pane-detail" aria-label="Item detail" ref={detail}>
      <h2>Item detail</h2>
      {selected ? (
        <>
          <p className="detail-name">{selected.name}</p>
          <p className="numerals">{selected.tag}</p>
          <p>
            <span className={shapeClassFor(itemStatusWord(selected.status))}>
              {itemStatusWord(selected.status)}
            </span>
          </p>
          <p className="numerals">
            Replacement cost ${formatDollars(selected.replacement_cost_cents)}
          </p>
          {selected.due_date ? <p className="numerals">Due {selected.due_date}</p> : null}
          <ul className="part-states">
            {selected.parts.map((part) => (
              <li key={part.id}>
                {part.name} — {outlineStateWord(part.state, selected.status)}
              </li>
            ))}
          </ul>
          <p className="queue-line">
            {selected.hold_queue_length > 0 ? (
              <span className="numerals">Queued holds {selected.hold_queue_length}</span>
            ) : (
              NO_QUEUE_LINE
            )}
          </p>
          {viewer === null ? (
            <a
              href="/signin"
              onClick={(event) => {
                event.preventDefault();
                navigate('/signin');
              }}
            >
              Sign in to place a hold
            </a>
          ) : viewer.user.role !== 'member' ? null : !memberActive ? (
            <p>{HOLDS_NEED_ACTIVE}</p>
          ) : holdable ? (
            <button
              type="button"
              aria-busy={holdPending}
              aria-disabled={holdPending}
              onClick={() => void placeHold()}
            >
              {holdPending ? 'Placing hold...' : 'Place hold'}
            </button>
          ) : null}
        </>
      ) : (
        <p>Choose a tool from the board or the list.</p>
      )}
    </section>
  );

  return (
    <>
      <Announcements kind="account" />
      <FormProblems problems={null} onJump={() => undefined} />
      <div className={`panes panes-${panes} panes-pegboard`}>
        {panes === 1 ? (
          <>
            {boardPane}
            {detailPane}
            {toolList}
          </>
        ) : (
          <>
            {toolList}
            {boardPane}
            {detailPane}
          </>
        )}
      </div>
    </>
  );
}
