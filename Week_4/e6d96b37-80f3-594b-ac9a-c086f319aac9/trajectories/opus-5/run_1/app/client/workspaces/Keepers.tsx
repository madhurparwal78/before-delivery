import { useEffect, useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useReorder } from '../lib/moves.tsx';
import { api } from '../lib/api.ts';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';

/**
 * Keeper preferences. Position 1 is marked "Keeper". The staged order is a
 * draft until the review is confirmed, and undo restores the order from
 * before the last confirmed reorder.
 */

export function Keepers(): JSX.Element {
  const desk = useDesk();
  const saved = desk.state?.keeper_order ?? [];
  const [order, setOrder] = useState<string[]>(saved);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mode, setMode] = useState<'save' | 'undo'>('save');
  const reviewButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // Another open screen's saved order arrives over the stream, without reload.
  useEffect(() => {
    setOrder(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.join('|')]);

  const reorder = useReorder(order, setOrder, {
    announce: desk.announce,
    labelOf: (key) => desk.state?.specimens[key]?.display_label ?? `Specimen ${key}`,
  });

  const confirm = async (): Promise<void> => {
    setReviewOpen(false);
    const undoing = mode === 'undo';
    await desk.run({
      label: undoing ? 'Undo last move' : 'Save keeper order',
      success: undoing ? F.UNDO_OK : F.KEEPER_OK,
      send: async () => {
        const version = desk.state?.versions.keeper_order;
        if (undoing) {
          await api.post(`/api/desks/${desk.ns}/keeper-order/undo`, {
            command_id: `keeper-undo-${version}`,
            expected_version: version,
          });
        } else {
          await api.put(`/api/desks/${desk.ns}/keeper-order`, {
            command_id: `keeper-${version}-${order.join('-')}`,
            expected_version: version,
            order,
          });
        }
      },
    });
    (undoing ? undoButton : reviewButton).current?.focus();
  };

  const keeperList = (
    <ul className="keeper-list" aria-label="Keeper preference" ref={list}>
      {order.map((key, at) => {
        const specimen = desk.state?.specimens[key];
        return (
          <li key={key}>
            <button
              type="button"
              className="chip target keeper-chip"
              aria-label={`Specimen ${key}`}
              data-item={key}
              {...reorder.item(key)}
            >
              <span className="keeper-position">{at === 0 ? 'Keeper' : at + 1}</span>
              <span className="chip-disc" aria-hidden="true">
                <span className="chip-mintmark">{specimen?.attribution.mintmark ?? '?'}</span>
              </span>
              <span className="chip-name">{specimen?.display_label ?? `Specimen ${key}`}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  const controls = (
    <div className="stack">
      <button
        type="button"
        className="target"
        ref={undoButton}
        onClick={() => {
          setMode('undo');
          setReviewOpen(true);
        }}
      >
        Undo last move
      </button>
      {desk.feedback.fields['order'] ? (
        <p className="field-error">{desk.feedback.fields['order']}</p>
      ) : null}
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => {
          setMode('save');
          setReviewOpen(true);
        }}
      >
        Review keeper order
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame id="keepers" listKind="stock" left={keeperList} right={controls} />
      <Review
        open={reviewOpen}
        title={mode === 'undo' ? 'Save keeper order' : 'Save keeper order'}
        opener={mode === 'undo' ? undoButton : reviewButton}
        confirmDisabled={desk.busy}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
      >
        {mode === 'undo' ? (
          <p>Restore the keeper order from before the last confirmed move.</p>
        ) : (
          <>
            <ReviewLine label="Keeper" value={order[0] ?? '(none)'} />
            <ReviewLine label="Order" value={order.join(', ')} />
          </>
        )}
      </Review>
    </>
  );
}
