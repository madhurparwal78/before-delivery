import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useDraft } from '../lib/drafts.ts';
import { api } from '../lib/api.ts';
import { CoinImage, ZoomSlider } from '../shell/Viewers.tsx';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { FactBoxes, WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';
import { useSelectedSpecimen } from './selection.ts';

/**
 * Attribution: the mintmark viewer, an attribution note and the quarantine
 * review. A confirmed quarantine makes the specimen ineligible for album
 * holes and offers.
 */

export function Attribution(): JSX.Element {
  const desk = useDesk();
  const { key, specimen } = useSelectedSpecimen();
  const [zoom, setZoom] = useDraft(desk.ns, 'attribution', 'zoom', 1);
  const [note, setNote] = useDraft(desk.ns, 'attribution', `note-${key}`, '');
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const [, bump] = useState(0);

  const obverse = specimen?.photos.find((photo) => photo.label === 'obverse');

  const confirm = async (): Promise<void> => {
    if (!specimen) return;
    setReviewOpen(false);
    await desk.run({
      label: 'Quarantine attribution',
      success: F.ATTR_OK,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/specimens/${key}/quarantine`, {
          command_id: `quarantine-${key}-${specimen.version}`,
          expected_version: specimen.version,
          note,
        });
      },
    });
    reviewButton.current?.focus();
  };

  const viewer = (
    <div className="viewer-pane">
      <h2 className="workspace-heading">Mintmark</h2>
      <CoinImage
        ns={desk.ns}
        photoId={obverse?.id ?? null}
        alt={`${specimen?.display_label ?? 'Specimen'} obverse`}
        zoom={zoom}
        onZoom={setZoom}
        width={obverse?.width ?? 1000}
        height={obverse?.height ?? 1000}
        onRetry={() => bump((at) => at + 1)}
      />
      <ZoomSlider label="Mintmark zoom" zoom={zoom} onZoom={setZoom} />
    </div>
  );

  const notePane = (
    <div className="stack">
      <FactBoxes specimen={specimen} />
      <label className="field">
        <span className="field-label">Attribution note:</span>
        <textarea
          className="target"
          aria-label="Attribution note"
          value={note}
          rows={4}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {desk.feedback.fields['note'] ? (
        <p className="field-error">{desk.feedback.fields['note']}</p>
      ) : null}
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => setReviewOpen(true)}
      >
        Review quarantine
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame
        id="attribution"
        listKind="stock"
        left={viewer}
        right={notePane}
        selected={specimen}
        ownFactBoxes
      />
      <Review
        open={reviewOpen}
        title="Quarantine attribution"
        opener={reviewButton}
        confirmDisabled={desk.busy || !specimen}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
      >
        <ReviewLine label="Specimen" value={specimen?.display_label ?? key} />
        <ReviewLine label="Note" value={note || '(none)'} />
        <p>This specimen will be excluded from sets and offers.</p>
      </Review>
    </>
  );
}
