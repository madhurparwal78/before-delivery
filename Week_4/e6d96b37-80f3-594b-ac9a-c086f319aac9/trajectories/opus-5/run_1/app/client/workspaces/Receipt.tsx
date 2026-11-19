import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useDraft } from '../lib/drafts.ts';
import { api } from '../lib/api.ts';
import { CoinImage, ZoomSlider } from '../shell/Viewers.tsx';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';

/**
 * Receipt. The arrival photograph is compared with the frozen dispatch
 * photograph at matching scale and orientation, then receipt is recorded
 * behind a fresh step-up.
 */

export function Receipt(): JSX.Element {
  const desk = useDesk();
  const party = desk.session?.role === 'counterpart' ? 'counterpart' : 'dealer';
  const entry = Object.entries(desk.state?.offers ?? {}).find(([, offer]) =>
    ['dispatched', 'received', 'disputed'].includes(offer.status),
  );
  const offerKey = entry?.[0] ?? '';
  const offer = entry?.[1];

  // The receiver takes the other party's items.
  const received = party === 'dealer' ? (offer?.counterpart_items ?? []) : (offer?.dealer_items ?? []);
  const [at, setAt] = useState(0);
  const specimenKey = received[Math.min(at, Math.max(0, received.length - 1))] ?? '';
  const specimen = desk.state?.specimens[specimenKey];

  const [zoom, setZoom] = useDraft(desk.ns, 'receipt', 'zoom', 1);
  const [matches, setMatches] = useDraft(desk.ns, 'receipt', `matches-${offerKey}`, false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);

  const arrival = specimen?.photos.find((photo) => photo.label === 'arrival');
  const dispatch =
    specimen?.photos.find((photo) => photo.label === 'dispatch') ??
    specimen?.photos.find((photo) => photo.label === 'obverse');

  const needsStepUp = desk.session?.step_up_fresh !== true;

  const upload = (file: File): void => {
    const form = new FormData();
    form.set('command_id', `arrival-${offerKey}-${specimenKey}-${Date.now()}`);
    form.set('specimen', specimenKey);
    form.set('photo', file, 'arrival.png');
    void desk.run({
      label: 'Add arrival photograph',
      success: F.RECEIPT_WAIT,
      send: async () => {
        await api.upload(`/api/desks/${desk.ns}/offers/${offerKey}/arrivals`, form);
      },
    });
  };

  const confirm = async (): Promise<void> => {
    setReviewOpen(false);
    await desk.run({
      label: 'Record receipt',
      success: matches ? F.RECEIPT_WAIT : F.RECEIPT_MISMATCH,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/offers/${offerKey}/receipts`, {
          command_id: `receipt-${offerKey}-${party}-${offer?.version}`,
          expected_version: offer?.version,
          matches,
        });
      },
    });
    reviewButton.current?.focus();
  };

  const dispatchPane = (
    <figure className="compare-face">
      <figcaption>Dispatch</figcaption>
      <CoinImage
        ns={desk.ns}
        photoId={dispatch?.id ?? null}
        alt={`${specimen?.display_label ?? 'Specimen'} dispatch`}
        width={dispatch?.width ?? 1000}
        height={dispatch?.height ?? 1000}
      />
    </figure>
  );

  const arrivalPane = (
    <div className="stack">
      <figure className="compare-face">
        <figcaption>Arrival</figcaption>
        <CoinImage
          ns={desk.ns}
          photoId={arrival?.id ?? null}
          alt={`${specimen?.display_label ?? 'Specimen'} arrival`}
          zoom={zoom}
          onZoom={setZoom}
          width={arrival?.width ?? 1000}
          height={arrival?.height ?? 1000}
        />
      </figure>
      <ZoomSlider label="Arrival zoom" zoom={zoom} onZoom={setZoom} />
      <button
        type="button"
        className="target"
        onClick={() => {
          const chooser = document.createElement('input');
          chooser.type = 'file';
          chooser.accept = 'image/jpeg,image/png,image/webp';
          chooser.onchange = () => {
            const file = chooser.files?.[0];
            if (file) upload(file);
          };
          chooser.click();
        }}
      >
        Arrival photo
      </button>
      {received.length > 1 ? (
        <div className="actions-row">
          <button
            type="button"
            className="target"
            disabled={at === 0}
            onClick={() => setAt(at - 1)}
          >
            Previous cell
          </button>
          <button
            type="button"
            className="target"
            disabled={at >= received.length - 1}
            onClick={() => setAt(at + 1)}
          >
            Next cell
          </button>
        </div>
      ) : null}
      <label className="field checkbox-field">
        <input
          className="target"
          type="checkbox"
          aria-label="Manifest matches"
          checked={matches}
          onChange={(event) => setMatches(event.target.checked)}
        />
        <span className="field-label">Manifest matches:</span>
      </label>
      {desk.feedback.fields['matches'] ? (
        <p className="field-error">{desk.feedback.fields['matches']}</p>
      ) : null}
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => setReviewOpen(true)}
      >
        Review receipt
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame id="receipt" listKind="exchange" left={dispatchPane} right={arrivalPane} />
      <Review
        open={reviewOpen}
        title="Record receipt"
        opener={reviewButton}
        confirmDisabled={desk.busy || needsStepUp || !offer}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void confirm()}
        extra={
          needsStepUp ? (
            <div className="note">
              <p>{F.MFA_REQUIRED}</p>
              <a
                className="teal-action target"
                href={`/auth/step-up?return_to=${encodeURIComponent(window.location.pathname)}`}
              >
                Verify identity
              </a>
            </div>
          ) : null
        }
      >
        <ReviewLine label="Offer" value={offerKey} />
        <ReviewLine label="Received" value={received.join(', ') || '(none)'} />
        <ReviewLine label="Manifest matches" value={matches ? 'Yes' : 'No'} />
      </Review>
    </>
  );
}
