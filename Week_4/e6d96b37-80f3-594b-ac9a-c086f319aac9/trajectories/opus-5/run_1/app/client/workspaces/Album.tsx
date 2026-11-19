import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useMove } from '../lib/moves.tsx';
import { api } from '../lib/api.ts';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { SpecimenChip, WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';
import { useDealerSpecimens } from './selection.ts';

/**
 * The album. Open holes read as named missing issues with their mintmark,
 * never as blank space, and a hole reopens as soon as the specimen filling it
 * becomes ineligible.
 */

export function Album(): JSX.Element {
  const desk = useDesk();
  const specimens = useDealerSpecimens();
  const [staged, setStaged] = useState<{ specimen: string; hole: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);

  const holes = Object.entries(desk.state?.album.holes ?? {});
  const move = useMove((specimen, hole) => setStaged({ specimen, hole }));

  const confirm = async (): Promise<void> => {
    if (!staged) return;
    setReviewOpen(false);
    const ok = await desk.run({
      label: 'Fill album hole',
      success: F.SET_OK,
      send: async () => {
        await api.post(
          `/api/desks/${desk.ns}/album/holes/${encodeURIComponent(staged.hole)}/fill`,
          {
            command_id: `album-${staged.hole}-${staged.specimen}-${desk.state?.versions.album}`,
            expected_version: desk.state?.versions.album,
            specimen: staged.specimen,
          },
        );
      },
    });
    // Cancelling, or a refusal, leaves the gap open.
    if (ok) setStaged(null);
    reviewButton.current?.focus();
  };

  const album = (
    <div className="album-pane">
      <h2 className="workspace-heading">{desk.state?.album.set ?? 'Album'}</h2>
      <ul className="album-holes">
        {holes.map(([label, hole]) => {
          const filled = hole.specimen;
          const isStaged = staged?.hole === label;
          return (
            <li key={label}>
              <button
                type="button"
                className={
                  filled || isStaged ? 'album-hole target filled' : 'album-hole target open'
                }
                aria-label={`Hole ${label}`}
                {...move.destination(label)}
              >
                <span className="hole-name">{label}</span>
                <span className="hole-mintmark">Mintmark {hole.mintmark}</span>
                <span className="hole-state">
                  {isStaged ? staged.specimen : (filled ?? 'Missing issue')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {holes.length === 0 ? (
        <section className="fact-box">
          <h3 className="fact-heading">No album yet:</h3>
          <ul>
            <li>Holes come only from a stored register album record.</li>
            <li>Reconcile the album to fetch them from the register.</li>
          </ul>
        </section>
      ) : null}
    </div>
  );

  const candidates = (
    <div className="stack">
      <h2 className="workspace-heading">Candidates</h2>
      <ul className="chip-list">
        {specimens.map(([key]) => (
          <li key={key}>
            <SpecimenChip
              specimenKey={key}
              interaction={move.source(key)}
              selected={staged?.specimen === key}
            />
          </li>
        ))}
      </ul>
      {desk.feedback.fields['specimen'] ? (
        <p className="field-error">{desk.feedback.fields['specimen']}</p>
      ) : null}
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => setReviewOpen(true)}
      >
        Review album placement
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame id="album" listKind="stock" left={album} right={candidates} />
      <Review
        open={reviewOpen}
        title="Fill album hole"
        opener={reviewButton}
        confirmDisabled={desk.busy || staged === null}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
      >
        <ReviewLine label="Hole" value={staged?.hole ?? '(none staged)'} />
        <ReviewLine label="Specimen" value={staged?.specimen ?? '(none staged)'} />
      </Review>
    </>
  );
}
