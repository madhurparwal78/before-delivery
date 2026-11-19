import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useDraft } from '../lib/drafts.ts';
import { useMove } from '../lib/moves.tsx';
import { api } from '../lib/api.ts';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { SpecimenChip, WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';

/**
 * Offer assembly. The dealer's basket and the counterpart's basket stay
 * unmistakably separate, and sending reserves both together behind a fresh
 * step-up.
 */

export function Offers(): JSX.Element {
  const desk = useDesk();
  const drafts = Object.entries(desk.state?.offers ?? {}).filter(
    ([, offer]) => offer.status === 'draft',
  );
  const offerKey = drafts[0]?.[0] ?? Object.keys(desk.state?.offers ?? {})[0] ?? '';
  const offer = desk.state?.offers[offerKey];

  const [dealerBasket, setDealerBasket] = useDraft<string[]>(
    desk.ns,
    'offers',
    `dealer-${offerKey}`,
    [],
  );
  const [counterpartBasket, setCounterpartBasket] = useDraft<string[]>(
    desk.ns,
    'offers',
    `counterpart-${offerKey}`,
    [],
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);

  const specimens = Object.entries(desk.state?.specimens ?? {});
  const dealerCandidates = specimens.filter(
    ([key, specimen]) => specimen.owner === 'dealer' && !dealerBasket.includes(key),
  );
  const counterpartCandidates = specimens.filter(
    ([key, specimen]) => specimen.owner === 'counterpart' && !counterpartBasket.includes(key),
  );

  const move = useMove((specimen, basket) => {
    const owner = desk.state?.specimens[specimen]?.owner;
    if (basket === 'dealer' && owner === 'dealer' && !dealerBasket.includes(specimen)) {
      setDealerBasket([...dealerBasket, specimen]);
    }
    if (
      basket === 'counterpart' &&
      owner === 'counterpart' &&
      !counterpartBasket.includes(specimen)
    ) {
      setCounterpartBasket([...counterpartBasket, specimen]);
    }
  });

  const needsStepUp = desk.session?.step_up_fresh !== true;

  const confirm = async (): Promise<void> => {
    setReviewOpen(false);
    await desk.run({
      label: 'Send reciprocal offer',
      success: F.OFFER_OK,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/offers/${offerKey}/send`, {
          command_id: `send-${offerKey}-${offer?.version}`,
          expected_version: offer?.version,
          dealer_items: dealerBasket,
          counterpart_items: counterpartBasket,
        });
      },
    });
    reviewButton.current?.focus();
  };

  const basket = (
    side: 'dealer' | 'counterpart',
    items: string[],
    drop: (next: string[]) => void,
  ): JSX.Element => (
    <section
      className={`basket basket-${side}`}
      aria-label={side === 'dealer' ? 'Dealer basket' : 'Counterpart basket'}
      {...move.destination(side)}
    >
      <h3 className="basket-heading">{side === 'dealer' ? 'Your basket' : "Their basket"}</h3>
      <ul className="chip-list">
        {items.map((key) => (
          <li key={key}>
            <SpecimenChip
              specimenKey={key}
              interaction={{ onClick: () => drop(items.filter((item) => item !== key)) }}
            />
          </li>
        ))}
      </ul>
      {items.length === 0 ? <p className="basket-empty">Empty</p> : null}
      {desk.feedback.fields[`${side}_items`] ? (
        <p className="field-error">{desk.feedback.fields[`${side}_items`]}</p>
      ) : null}
    </section>
  );

  const left = (
    <div className="stack">
      <h2 className="workspace-heading">Your duplicates</h2>
      <ul className="chip-list">
        {dealerCandidates.map(([key]) => (
          <li key={key}>
            <SpecimenChip specimenKey={key} interaction={move.source(key)} />
          </li>
        ))}
      </ul>
      {basket('dealer', dealerBasket, setDealerBasket)}
    </div>
  );

  const right = (
    <div className="stack">
      <h2 className="workspace-heading">Their specimens</h2>
      <ul className="chip-list">
        {counterpartCandidates.map(([key]) => (
          <li key={key}>
            <SpecimenChip specimenKey={key} interaction={move.source(key)} />
          </li>
        ))}
      </ul>
      {basket('counterpart', counterpartBasket, setCounterpartBasket)}
    </div>
  );

  return (
    <>
      <WorkspaceFrame
        id="offers"
        listKind="exchange"
        left={left}
        right={right}
        below={
          <button
            type="button"
            className="target primary"
            ref={reviewButton}
            onClick={() => setReviewOpen(true)}
          >
            Review offer
          </button>
        }
      />
      <Review
        open={reviewOpen}
        title="Send reciprocal offer"
        opener={reviewButton}
        confirmDisabled={desk.busy || needsStepUp}
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
        <ReviewLine label="Your basket" value={dealerBasket.join(', ') || '(empty)'} />
        <ReviewLine label="Their basket" value={counterpartBasket.join(', ') || '(empty)'} />
        <p>Both baskets are reserved together.</p>
      </Review>
    </>
  );
}
