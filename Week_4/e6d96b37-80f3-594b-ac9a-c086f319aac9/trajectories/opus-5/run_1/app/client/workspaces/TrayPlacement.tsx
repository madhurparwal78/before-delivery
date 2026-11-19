import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useMove } from '../lib/moves.tsx';
import { api } from '../lib/api.ts';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';
import { useDealerSpecimens } from './selection.ts';

/**
 * Tray placement. Holders and cells are drawn to their millimetre sizes at
 * one shared scale, so a slab visibly overhangs a cell a flip fits inside.
 */

const MM_TO_PX = 1.6;
const CELL_MM = 60;

export function TrayPlacement(): JSX.Element {
  const desk = useDesk();
  const specimens = useDealerSpecimens();
  const [staged, setStaged] = useState<{ specimen: string; cell: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);

  const tray = desk.state?.tray ?? {};
  const cells = Object.keys(tray).sort();
  const move = useMove((specimen, cell) => setStaged({ specimen, cell }));

  const confirm = async (): Promise<void> => {
    if (!staged || !desk.state) return;
    setReviewOpen(false);
    const ok = await desk.run({
      label: 'Place holder',
      success: F.TRAY_OK,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/tray/placements`, {
          command_id: `tray-${staged.specimen}-${staged.cell}-${desk.state?.versions.tray}`,
          expected_version: desk.state?.versions.tray,
          specimen: staged.specimen,
          cell: staged.cell,
        });
      },
    });
    // A cancelled or refused placement leaves occupancy unchanged.
    if (ok) setStaged(null);
    reviewButton.current?.focus();
  };

  const trayGrid = (
    <div className="tray-pane">
      <h2 className="workspace-heading">Crown tray 1</h2>
      <div className="tray-grid">
        {cells.map((cell) => {
          const occupant = tray[cell]?.specimen ?? null;
          const holder = occupant ? desk.state?.specimens[occupant]?.holder : undefined;
          const isStaged = staged?.cell === cell;
          const stagedHolder = isStaged
            ? desk.state?.specimens[staged.specimen]?.holder
            : undefined;
          const shown = stagedHolder ?? holder;
          return (
            <button
              key={cell}
              type="button"
              className={isStaged ? 'tray-cell target staged' : 'tray-cell target'}
              aria-label={`Cell ${cell}`}
              style={{ width: CELL_MM * MM_TO_PX, height: CELL_MM * MM_TO_PX }}
              {...move.destination(cell)}
            >
              <span className="cell-name">{cell}</span>
              {shown ? (
                <span
                  className="holder-shape"
                  style={{
                    width: shown.width_mm * MM_TO_PX,
                    height: shown.height_mm * MM_TO_PX,
                  }}
                >
                  {isStaged ? staged.specimen : occupant}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  const holders = (
    <div className="stack">
      <h2 className="workspace-heading">Holders</h2>
      <ul className="chip-list">
        {specimens.map(([key, specimen]) => (
          <li key={key}>
            <button
              type="button"
              className="chip target"
              aria-label={`Holder ${key}`}
              {...move.source(key)}
            >
              <span
                className="holder-shape"
                style={{
                  width: specimen.holder.width_mm * MM_TO_PX,
                  height: specimen.holder.height_mm * MM_TO_PX,
                }}
              >
                {key}
              </span>
              <span className="chip-name">
                {specimen.holder.kind} {specimen.holder.width_mm}×{specimen.holder.height_mm} mm
              </span>
            </button>
          </li>
        ))}
      </ul>
      {desk.feedback.fields['cell'] ? (
        <p className="field-error">{desk.feedback.fields['cell']}</p>
      ) : null}
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => setReviewOpen(true)}
      >
        Review placement
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame id="tray-placement" listKind="stock" left={trayGrid} right={holders} />
      <Review
        open={reviewOpen}
        title="Place holder"
        opener={reviewButton}
        confirmDisabled={desk.busy || staged === null}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
      >
        <ReviewLine label="Holder" value={staged?.specimen ?? '(none staged)'} />
        <ReviewLine label="Cell" value={staged?.cell ?? '(none staged)'} />
      </Review>
    </>
  );
}
