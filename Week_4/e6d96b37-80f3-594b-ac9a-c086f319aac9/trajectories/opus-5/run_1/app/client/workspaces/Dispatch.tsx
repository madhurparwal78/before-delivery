import { useEffect, useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useReorder } from '../lib/moves.tsx';
import { api } from '../lib/api.ts';
import { CoinImage } from '../shell/Viewers.tsx';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';

/**
 * Dispatch. The packing manifest is reordered to match the physical sleeves,
 * each item carrying its photographs, and freezing stores immutable evidence.
 * Once frozen, the packing order never changes again.
 */

export function Dispatch(): JSX.Element {
  const desk = useDesk();
  const party = desk.session?.role === 'counterpart' ? 'counterpart' : 'dealer';
  const entry = Object.entries(desk.state?.manifests ?? {}).find(([key]) =>
    key.endsWith(`/${party}`),
  );
  const manifestKey = entry?.[0] ?? '';
  const manifest = entry?.[1];
  const offerKey = manifestKey.split('/')[0] ?? '';

  const [order, setOrder] = useState<string[]>(manifest?.order ?? []);
  const [focused, setFocused] = useState<string>('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOrder(manifest?.order ?? []);
    setFocused((was) => was || (manifest?.order[0] ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(manifest?.order ?? []).join('|')]);

  const reorder = useReorder(order, setOrder, {
    announce: desk.announce,
    labelOf: (key) => desk.state?.specimens[key]?.display_label ?? `Specimen ${key}`,
  });

  const frozen = manifest?.frozen === true;

  const confirm = async (): Promise<void> => {
    setReviewOpen(false);
    await desk.run({
      label: 'Freeze dispatch evidence',
      success: F.DISPATCH_OK,
      send: async () => {
        await api.post(
          `/api/desks/${desk.ns}/offers/${offerKey}/manifests/${party}/freeze`,
          {
            command_id: `freeze-${offerKey}-${party}-${manifest?.version}`,
            expected_version: manifest?.version,
            order,
          },
        );
      },
    });
    reviewButton.current?.focus();
  };

  const sequence = (
    <div className="stack">
      <h2 className="workspace-heading">Packing manifest</h2>
      <ol className="manifest" aria-label="Packing manifest">
        {order.map((key, at) => {
          const specimen = desk.state?.specimens[key];
          const obverse = specimen?.photos.find((photo) => photo.label === 'obverse');
          return (
            <li key={key}>
              <button
                type="button"
                className="manifest-item target"
                aria-label={`Manifest item ${key}`}
                data-item={key}
                disabled={frozen}
                onFocus={() => setFocused(key)}
                {...reorder.item(key)}
              >
                <span className="sleeve-number">Sleeve {at + 1}</span>
                <span className="manifest-thumb">
                  <CoinImage
                    ns={desk.ns}
                    photoId={obverse?.id ?? null}
                    alt={`${specimen?.display_label ?? key} obverse`}
                    width={obverse?.width ?? 1000}
                    height={obverse?.height ?? 1000}
                  />
                </span>
                <span className="chip-name">{specimen?.display_label ?? key}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {frozen ? <p className="note">{F.DISPATCH_FROZEN}</p> : null}
      {desk.feedback.fields['order'] ? (
        <p className="field-error">{desk.feedback.fields['order']}</p>
      ) : null}
    </div>
  );

  const focusedSpecimen = desk.state?.specimens[focused];
  const evidence = (
    <div className="stack">
      <h2 className="workspace-heading">Evidence</h2>
      {focusedSpecimen ? (
        <div className="evidence-faces">
          {focusedSpecimen.photos
            .filter((photo) => photo.label === 'obverse' || photo.label === 'reverse')
            .map((photo) => (
              <figure key={photo.id} className="evidence-face">
                <CoinImage
                  ns={desk.ns}
                  photoId={photo.id}
                  alt={`${focusedSpecimen.display_label} ${photo.label}`}
                  width={photo.width}
                  height={photo.height}
                />
                <figcaption>{photo.label}</figcaption>
              </figure>
            ))}
        </div>
      ) : (
        <p>No manifest item focused.</p>
      )}
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => setReviewOpen(true)}
      >
        Review dispatch
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame id="dispatch" listKind="exchange" left={sequence} right={evidence} />
      <Review
        open={reviewOpen}
        title="Freeze dispatch evidence"
        opener={reviewButton}
        confirmDisabled={desk.busy || frozen || order.length === 0}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
      >
        <ReviewLine label="Offer" value={offerKey} />
        <ReviewLine label="Packing order" value={order.join(', ')} />
        <p>Freezing stores an immutable copy of each coin's obverse.</p>
      </Review>
    </>
  );
}
