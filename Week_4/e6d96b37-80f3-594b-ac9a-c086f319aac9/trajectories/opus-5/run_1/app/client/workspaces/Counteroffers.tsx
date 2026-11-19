import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useMove } from '../lib/moves.tsx';
import { api } from '../lib/api.ts';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { SpecimenChip, WorkspaceFrame } from './Workspace.tsx';
import { windowText } from '../shell/Desk.tsx';
import { useReducedMotion } from '../lib/layout.ts';
import { F } from '../../shared/feedback.ts';

/**
 * Counteroffers. Either party replaces an offered specimen, which clears both
 * acceptances on both screens, and each side re-accepts the current version
 * behind a fresh one-time code. The response window shown is always the
 * server's.
 */

export function Counteroffers(): JSX.Element {
  const desk = useDesk();
  const reduced = useReducedMotion();
  const live = Object.entries(desk.state?.offers ?? {}).filter(
    ([, offer]) => offer.status !== 'draft',
  );
  const offerKey = live[0]?.[0] ?? '';
  const offer = desk.state?.offers[offerKey];
  const party = desk.session?.role === 'counterpart' ? 'counterpart' : 'dealer';

  const [staged, setStaged] = useState<{ remove: string; add: string } | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const acceptButton = useRef<HTMLButtonElement>(null);

  const mine = party === 'dealer' ? (offer?.dealer_items ?? []) : (offer?.counterpart_items ?? []);
  const available = Object.entries(desk.state?.specimens ?? {})
    .filter(([key, specimen]) => specimen.owner === party && !mine.includes(key))
    .map(([key]) => key);

  const move = useMove((add, remove) => setStaged({ remove, add }));

  const replace = async (): Promise<void> => {
    if (!staged || !offer) return;
    setReplaceOpen(false);
    const ok = await desk.run({
      label: 'Replace offered specimen',
      success: F.COUNTER_VOID,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/offers/${offerKey}/replace`, {
          command_id: `replace-${offerKey}-${offer.version}`,
          expected_version: offer.version,
          remove: staged.remove,
          add: staged.add,
        });
      },
    });
    if (ok) setStaged(null);
    replaceButton.current?.focus();
  };

  const accept = async (): Promise<void> => {
    if (!offer) return;
    setAcceptOpen(false);
    await desk.run({
      label: 'Accept offer version',
      success: F.COUNTER_ACCEPT,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/offers/${offerKey}/accept`, {
          command_id: `accept-${offerKey}-${offer.version}-${party}`,
          expected_version: offer.version,
        });
      },
    });
    acceptButton.current?.focus();
  };

  const needsStepUp = desk.session?.step_up_fresh !== true;

  const side = (label: string, items: string[], replaceable: boolean): JSX.Element => (
    <section className="basket" aria-label={label}>
      <h3 className="basket-heading">{label}</h3>
      <ul className="chip-list">
        {items.map((key) => (
          <li key={key} className={reduced ? 'slot-instant' : 'slot-fade'}>
            <SpecimenChip
              specimenKey={staged && staged.remove === key ? staged.add : key}
              interaction={replaceable ? move.destination(key) : undefined}
              selected={staged?.remove === key}
            />
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <section className="response-window" aria-label="Response window">
        {offer ? windowText(offer) : ''}
      </section>
      <WorkspaceFrame
        id="counteroffers"
        listKind="exchange"
        left={side('Dealer side', offer?.dealer_items ?? [], party === 'dealer')}
        right={side('Counterpart side', offer?.counterpart_items ?? [], party === 'counterpart')}
        below={
          <div className="stack">
            <h3 className="basket-heading">Your available specimens</h3>
            <ul className="chip-list">
              {available.map((key) => (
                <li key={key}>
                  <SpecimenChip specimenKey={key} interaction={move.source(key)} />
                </li>
              ))}
            </ul>
            <div className="actions-row">
              <button
                type="button"
                className="target"
                ref={replaceButton}
                onClick={() => setReplaceOpen(true)}
              >
                Review replacement
              </button>
              <button
                type="button"
                className="target primary"
                ref={acceptButton}
                onClick={() => setAcceptOpen(true)}
              >
                Accept current offer
              </button>
            </div>
          </div>
        }
      />

      <Review
        open={replaceOpen}
        title="Replace offered specimen"
        opener={replaceButton}
        confirmDisabled={desk.busy || staged === null}
        onCancel={() => setReplaceOpen(false)}
        onConfirm={() => void replace()}
      >
        <ReviewLine label="Remove" value={staged?.remove ?? '(none staged)'} />
        <ReviewLine label="Add" value={staged?.add ?? '(none staged)'} />
        <p>Both acceptances will be cleared.</p>
      </Review>

      <Review
        open={acceptOpen}
        title="Accept offer version"
        opener={acceptButton}
        confirmDisabled={desk.busy || needsStepUp || !offer}
        onCancel={() => setAcceptOpen(false)}
        onConfirm={() => void accept()}
        extra={
          needsStepUp ? (
            <div className="note">
              <p>{F.MFA_REQUIRED}</p>
              <a
                className="teal-action target"
                href={`/auth/step-up?return_to=${encodeURIComponent(window.location.pathname)}`}
              >
                Verify acceptance
              </a>
            </div>
          ) : null
        }
      >
        <ReviewLine label="Offer" value={offerKey} />
        <ReviewLine label="Version" value={String(offer?.version ?? '')} />
        <ReviewLine label="Window" value={offer ? windowText(offer) : ''} />
      </Review>
    </>
  );
}
