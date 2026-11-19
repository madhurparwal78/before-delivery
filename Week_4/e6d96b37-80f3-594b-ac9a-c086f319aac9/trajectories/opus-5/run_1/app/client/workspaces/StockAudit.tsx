import { useCallback, useEffect, useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { readDraft, writeDraft } from '../lib/drafts.ts';
import { ApiCallError, api } from '../lib/api.ts';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';
import { Icon } from '../shell/Icon.tsx';

/**
 * The stock audit walk. Marks made offline queue in the browser, survive
 * reload, and replay once each in recorded order on reconnect. Each queued
 * mark's expected version is the cell's audit version the browser last saw,
 * plus one for each earlier queued mark on the same cell.
 */

interface QueuedMark {
  commandId: string;
  cell: string;
  expectedVersion: number;
}

const QUEUE = 'audit-queue';

export function StockAudit(): JSX.Element {
  const desk = useDesk();
  const [at, setAt] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedMark[]>(() =>
    readDraft<QueuedMark[]>(desk.ns, 'audit', QUEUE, []),
  );
  const reviewButton = useRef<HTMLButtonElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);

  const cells = Object.keys(desk.state?.tray ?? {}).sort();
  const columns = 2;
  const selected = cells[Math.min(at, Math.max(0, cells.length - 1))] ?? '';
  const cell = desk.state?.tray[selected];

  const persist = useCallback(
    (next: QueuedMark[]) => {
      setQueue(next);
      writeDraft(desk.ns, 'audit', QUEUE, next);
    },
    [desk.ns],
  );

  /** Queued marks chain on each cell; marks on different cells are independent. */
  const expectedFor = useCallback(
    (which: string): number => {
      const base = desk.state?.tray[which]?.audit_version ?? 0;
      const ahead = queue.filter((mark) => mark.cell === which).length;
      return base + ahead;
    },
    [desk.state, queue],
  );

  const replay = useCallback(async (): Promise<void> => {
    const pending = readDraft<QueuedMark[]>(desk.ns, 'audit', QUEUE, []);
    if (pending.length === 0) return;
    try {
      const reply = await api.post<{
        results: { command_id: string; status: number; body: unknown }[];
      }>(`/api/desks/${desk.ns}/audit/sync`, {
        commands: pending.map((mark) => ({
          command_id: mark.commandId,
          expected_version: mark.expectedVersion,
          cell: mark.cell,
          mark: 'missing',
        })),
      });
      // Each replayed mark announces its own result, in recorded order.
      let conflicted = false;
      for (const result of reply.results) {
        if (result.status === 200) desk.announce(F.AUDIT_MISSING);
        if (result.status === 409) conflicted = true;
      }
      persist([]);
      if (conflicted) {
        // A cell that changed meanwhile stays visible as a conflict.
        desk.fail(F.CONFLICT, 'reload');
      } else {
        desk.announce(F.SYNCED);
      }
      desk.refresh();
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
    }
  }, [desk, persist]);

  useEffect(() => {
    const onOnline = (): void => void replay();
    window.addEventListener('online', onOnline);
    if (navigator.onLine && queue.length > 0) void replay();
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async (): Promise<void> => {
    setReviewOpen(false);
    const expected = expectedFor(selected);
    const commandId = `audit-${selected}-${expected}`;
    if (!navigator.onLine) {
      // Offline: the mark queues, survives reload, and replays on reconnect.
      persist([...queue, { commandId, cell: selected, expectedVersion: expected }]);
      desk.announce(F.OFFLINE);
      reviewButton.current?.focus();
      return;
    }
    await desk.run({
      label: 'Record missing item',
      success: F.AUDIT_MISSING,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/audit/marks`, {
          command_id: commandId,
          expected_version: expected,
          cell: selected,
          mark: 'missing',
        });
      },
    });
    reviewButton.current?.focus();
  };

  const step = (delta: number): void =>
    setAt((was) => Math.min(cells.length - 1, Math.max(0, was + delta)));

  const tray = (
    <div className="audit-pane">
      <div
        className="tray-grid audit-tray"
        role="group"
        aria-label="Audit tray"
        ref={trayRef}
        tabIndex={0}
        onKeyDown={(event) => {
          const moves: Record<string, number | undefined> = {
            ArrowRight: 1,
            ArrowLeft: -1,
            ArrowDown: columns,
            ArrowUp: -columns,
          };
          const delta = moves[event.key];
          if (delta === undefined) return;
          event.preventDefault();
          step(delta);
        }}
        onTouchStart={(event) => {
          touchStart.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const from = touchStart.current;
          const to = event.changedTouches[0]?.clientX;
          if (from === null || to === undefined) return;
          // Swiping left selects the next cell; swiping right the previous.
          if (to - from < -40) step(1);
          if (to - from > 40) step(-1);
          touchStart.current = null;
        }}
      >
        {cells.map((which, index) => {
          const held = desk.state?.tray[which];
          const queued = queue.some((mark) => mark.cell === which);
          return (
            <button
              key={which}
              type="button"
              className="tray-cell target"
              aria-label={`Cell ${which}`}
              aria-pressed={index === at}
              onClick={() => setAt(index)}
            >
              <span className="cell-name">{which}</span>
              <span className="cell-holds">{held?.specimen ?? 'empty'}</span>
              {held?.audit_mark === 'missing' || queued ? (
                <span className="cell-missing">missing</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="audit-steps">
        <button
          type="button"
          className="target"
          disabled={at === 0}
          onClick={() => step(-1)}
        >
          Previous cell
        </button>
        <button
          type="button"
          className="target"
          disabled={at >= cells.length - 1}
          onClick={() => step(1)}
        >
          Next cell
        </button>
      </div>
    </div>
  );

  const details = (
    <div className="stack">
      <section className="fact-box">
        <h3 className="fact-heading">Selected cell:</h3>
        <ul>
          <li>{selected || 'none'}</li>
          <li>{cell?.specimen ? `Holds ${cell.specimen}` : 'Empty'}</li>
        </ul>
      </section>
      {queue.length > 0 ? (
        <div className="note">
          <p>{F.OFFLINE}</p>
          <button type="button" className="teal-action target" onClick={() => void replay()}>
            <Icon name="wifi-off" />
            Retry sync
          </button>
        </div>
      ) : null}
      {desk.feedback.fields['cell'] ? (
        <p className="field-error">{desk.feedback.fields['cell']}</p>
      ) : null}
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => setReviewOpen(true)}
      >
        Mark missing
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame id="stock-audit" listKind="stock" left={tray} right={details} />
      <Review
        open={reviewOpen}
        title="Record missing item"
        opener={reviewButton}
        confirmDisabled={desk.busy || !selected}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
      >
        <ReviewLine label="Cell" value={selected} />
        <ReviewLine label="Holds" value={cell?.specimen ?? 'empty'} />
      </Review>
    </>
  );
}
