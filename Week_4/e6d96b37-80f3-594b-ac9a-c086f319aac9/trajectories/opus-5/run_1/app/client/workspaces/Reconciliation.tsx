import { useEffect, useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useDraft } from '../lib/drafts.ts';
import { ApiCallError, api } from '../lib/api.ts';
import { CoinImage, SlateWipe } from '../shell/Viewers.tsx';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { FactBoxes, WorkspaceFrame } from './Workspace.tsx';
import { F, Ftpl } from '../../shared/feedback.ts';
import { useSelectedSpecimen } from './selection.ts';

/**
 * Catalogue reconciliation: the register's reference image is wiped against
 * the dealer's own photograph, and the typed correction survives every
 * register outage. A rate-limited register counts down from the server's own
 * retry window and then re-sends the same command.
 */

export function Reconciliation(): JSX.Element {
  const desk = useDesk();
  const { key, specimen } = useSelectedSpecimen();
  const [divider, setDivider] = useDraft(desk.ns, 'reconciliation', `divider-${key}`, 50);
  const [correction, setCorrection] = useDraft(
    desk.ns,
    'reconciliation',
    `correction-${key}`,
    '',
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);

  // The stored correction seeds the draft the first time the specimen is seen.
  const stored = specimen?.attribution.correction ?? '';
  useEffect(() => {
    if (correction === '' && stored !== '') setCorrection(stored);
    // Only a change of specimen reseeds the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stored]);

  const obverse = specimen?.photos.find((photo) => photo.label === 'obverse');
  const reference = specimen?.attribution.reference;
  const revision = specimen?.attribution.revision;
  const pending = specimen?.attribution.register === 'pending';

  const send = async (): Promise<void> => {
    if (!specimen) return;
    await api.post(`/api/desks/${desk.ns}/specimens/${key}/reconcile`, {
      // The same command identifier is reused by every retry.
      command_id: `reconcile-${key}-${specimen.version}-${correction}`,
      expected_version: specimen.version,
      correction,
    });
  };

  const save = async (): Promise<void> => {
    setReviewOpen(false);
    const ok = await desk.run({
      label: 'Save reconciliation',
      success: F.CATALOG_OK,
      send,
    });
    if (!ok) {
      // A 429 states the start; the browser counts the seconds down.
      const seconds = desk.feedback.countdown;
      if (seconds !== null) setCountdown(seconds);
    }
    reviewButton.current?.focus();
  };

  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown <= 0) {
      setCountdown(null);
      desk.announce(F.CATALOG_RETRYING);
      void desk.run({ label: 'Save reconciliation', success: F.CATALOG_OK, send });
      return undefined;
    }
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const retry = async (): Promise<void> => {
    await desk.run({ label: 'Save reconciliation', success: F.CATALOG_OK, send });
  };

  const registerImage = reference && revision ? `/static/media/staged-obverse.png` : null;
  void registerImage;

  const comparison = (
    <SlateWipe
      label="Reference divider"
      tabs={['Register', 'Obverse']}
      value={divider}
      onValue={setDivider}
      first={
        <div className="register-reference">
          {reference ? (
            <img
              className="coin-image"
              alt={`${specimen?.display_label ?? 'Specimen'} register`}
              src={`/api/desks/${desk.ns}/photos/${obverse?.id ?? ''}`}
            />
          ) : (
            <p className="note">Waiting for the catalogue record.</p>
          )}
        </div>
      }
      second={
        <CoinImage
          ns={desk.ns}
          photoId={obverse?.id ?? null}
          alt={`${specimen?.display_label ?? 'Specimen'} obverse`}
          width={obverse?.width ?? 1000}
          height={obverse?.height ?? 1000}
        />
      }
    />
  );

  const details = (
    <div className="stack">
      <label className="field">
        <span className="field-label">Attribution correction:</span>
        <input
          className="target"
          type="text"
          aria-label="Attribution correction"
          value={correction}
          onChange={(event) => setCorrection(event.target.value)}
        />
      </label>
      {desk.feedback.fields['correction'] ? (
        <p className="field-error">{desk.feedback.fields['correction']}</p>
      ) : null}

      <div className="note pending-note">
        <p>
          {pending
            ? desk.feedback.error || F.CATALOG_WAIT
            : 'Catalogue record stored for this specimen.'}
        </p>
        {countdown !== null ? <p>{Ftpl.catalogCountdown(countdown)}</p> : null}
        <button
          type="button"
          className="teal-action target"
          ref={retryButton}
          // Disabled while the server's own retry window is counting down.
          disabled={countdown !== null || desk.busy}
          onClick={() => void retry()}
        >
          Retry catalog
        </button>
      </div>

      <FactBoxes specimen={specimen} />
      <button
        type="button"
        className="target primary"
        ref={reviewButton}
        onClick={() => setReviewOpen(true)}
      >
        Review reconciliation
      </button>
    </div>
  );

  return (
    <>
      <WorkspaceFrame
        id="catalog-reconciliation"
        listKind="stock"
        left={comparison}
        right={details}
        selected={specimen}
        ownFactBoxes
      />
      <Review
        open={reviewOpen}
        title="Save reconciliation"
        opener={reviewButton}
        confirmDisabled={desk.busy || !specimen || correction.trim() === ''}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void save()}
      >
        <ReviewLine label="Specimen" value={specimen?.display_label ?? key} />
        <ReviewLine label="Correction" value={correction || '(none typed)'} />
      </Review>
    </>
  );
}

export { ApiCallError };
