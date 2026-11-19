import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useDraft } from '../lib/drafts.ts';
import { api } from '../lib/api.ts';
import { CoinImage, MarkerCoordinates, MarkerHandle, SlateWipe } from '../shell/Viewers.tsx';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';
import { useSelectedSpecimen } from './selection.ts';

/**
 * Condition comparison: an old and a recent photograph under the Slate rule
 * wipe, with a marker pinned to the scratch in original-image coordinates and
 * a note saved against the original photograph.
 */

export function Condition(): JSX.Element {
  const desk = useDesk();
  const { key, specimen } = useSelectedSpecimen();
  const [divider, setDivider] = useDraft(desk.ns, 'condition', `divider-${key}`, 50);
  const [marker, setMarker] = useDraft(desk.ns, 'condition', `marker-${key}`, {
    x: 600,
    y: 400,
  });
  const [note, setNote] = useDraft(desk.ns, 'condition', `note-${key}`, '');
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const [reloadAt, setReloadAt] = useState(0);

  const obverse = specimen?.photos.find((photo) => photo.label === 'obverse');
  const arrival = specimen?.photos.find((photo) => photo.label === 'arrival');
  const target = arrival ?? obverse;
  const width = target?.width ?? 1000;
  const height = target?.height ?? 1000;

  const confirm = async (): Promise<void> => {
    if (!specimen || !target) return;
    setReviewOpen(false);
    await desk.run({
      label: 'Save condition note',
      success: F.CONDITION_OK,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/specimens/${key}/annotations`, {
          command_id: `condition-${key}-${specimen.version}`,
          expected_version: specimen.version,
          annotation: `condition-${key}`,
          photo: target.id,
          // Saved in original-image coordinates.
          x: marker.x,
          y: marker.y,
          text: note,
        });
      },
    });
    reviewButton.current?.focus();
  };

  const markers = [{ id: 'condition', x: marker.x, y: marker.y, text: note, current: true }];

  const comparison = (
    <SlateWipe
      label="Condition wipe"
      tabs={['Obverse', 'Arrival']}
      value={divider}
      onValue={setDivider}
      first={
        <CoinImage
          key={`obverse-${reloadAt}`}
          ns={desk.ns}
          photoId={obverse?.id ?? null}
          alt={`${specimen?.display_label ?? 'Specimen'} obverse`}
          width={obverse?.width ?? 1000}
          height={obverse?.height ?? 1000}
          onRetry={() => setReloadAt((at) => at + 1)}
        />
      }
      second={
        <CoinImage
          key={`arrival-${reloadAt}`}
          ns={desk.ns}
          photoId={target?.id ?? null}
          alt={`${specimen?.display_label ?? 'Specimen'} arrival`}
          width={width}
          height={height}
          markers={markers}
          onRetry={() => setReloadAt((at) => at + 1)}
          onPick={(x, y) => setMarker({ x, y })}
        />
      }
    />
  );

  const details = (
    <div className="stack">
      <MarkerCoordinates
        x={marker.x}
        y={marker.y}
        width={width}
        height={height}
        onChange={(x, y) => setMarker({ x, y })}
        error={desk.feedback.fields['x'] ?? desk.feedback.fields['y']}
      />
      <MarkerHandle
        label="Condition marker"
        x={marker.x}
        y={marker.y}
        width={width}
        height={height}
        onMove={(x, y) => setMarker({ x, y })}
      />
      <label className="field">
        <span className="field-label">Condition note:</span>
        <textarea
          className="target"
          aria-label="Condition note"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {desk.feedback.fields['text'] ? (
        <p className="field-error">{desk.feedback.fields['text']}</p>
      ) : null}
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => setReviewOpen(true)}
      >
        Review condition note
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame
        id="condition"
        listKind="stock"
        left={comparison}
        right={details}
        selected={specimen}
      />
      <Review
        open={reviewOpen}
        title="Save condition note"
        opener={reviewButton}
        confirmDisabled={desk.busy || !specimen}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
      >
        <ReviewLine label="Specimen" value={specimen?.display_label ?? key} />
        <ReviewLine label="Marker" value={`${marker.x}, ${marker.y}`} />
        <ReviewLine label="Note" value={note || '(none)'} />
      </Review>
    </>
  );
}
