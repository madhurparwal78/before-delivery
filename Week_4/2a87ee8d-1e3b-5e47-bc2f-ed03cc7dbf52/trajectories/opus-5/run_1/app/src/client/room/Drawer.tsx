import { useEffect, useRef, useState } from 'react';
import { countdown, displayAmount, displayDate, displayTime } from '../lib/format.js';
import { Ticker } from '../components/Common.js';
import { recapStatusText } from '../pages/RecapPage.js';
import {
  STATUS_LABELS,
  type BoardCluster,
  type BoardParticipant,
  type BoardResponse,
  type FacilitatorWorkshop,
  type WorkshopStatus,
} from '../../shared/protocol.js';

export interface DrawerProps {
  readonly board: BoardResponse;
  readonly nowMs: number;
  readonly isFacilitator: boolean;
  readonly roundMinutes: number;
  readonly setRoundMinutes: (value: number) => void;
  readonly voteMinutes: number;
  readonly setVoteMinutes: (value: number) => void;
  readonly dotsPerPerson: number;
  readonly setDotsPerPerson: (value: number) => void;
  readonly onTransition: (to: WorkshopStatus) => void;
  readonly transitionPending: boolean;
  readonly onCopyLink: () => void;
  readonly onRotateLink: () => void;
  readonly onTurnOffLink: () => void;
  readonly inviteText: string;
  readonly setInviteText: (value: string) => void;
  readonly onSendInvites: () => void;
  readonly invitePending: boolean;
  readonly inviteFieldError: string;
  readonly onOpenTrash: () => void;
  readonly onOpenVersions: () => void;
}

/** The legal moves from each state, in the order the drawer offers them. */
const TRANSITION_BUTTONS: ReadonlyArray<{ to: WorkshopStatus; label: string }> = [
  { to: 'open', label: 'Open room' },
  { to: 'silent_round', label: 'Start silent round' },
  { to: 'revealed', label: 'Reveal' },
  { to: 'voting', label: 'Start voting' },
  { to: 'closed', label: 'Close workshop' },
  { to: 'archived', label: 'Archive' },
];

const LEGAL_EDGES: Readonly<Record<WorkshopStatus, readonly WorkshopStatus[]>> = {
  draft: ['open'],
  open: ['silent_round'],
  silent_round: ['revealed'],
  revealed: ['silent_round', 'voting'],
  voting: ['closed'],
  closed: ['archived'],
  archived: [],
};

export function Drawer(props: DrawerProps): JSX.Element {
  const { board, isFacilitator, nowMs } = props;
  const workshop = board.workshop;
  const status = workshop.status;

  const deadline =
    workshop.round?.endsAt ?? (workshop.voting?.endsAt ?? null);
  const remaining = deadline === null ? null : Date.parse(deadline) - nowMs;
  const lastMinute = remaining !== null && remaining > 0 && remaining <= 60_000;

  const facilitatorWorkshop = isFacilitator ? (workshop as FacilitatorWorkshop) : null;
  const viewer = board.viewer;

  return (
    <aside className="drawer" aria-label="Session">
      {remaining !== null && (
        <p
          role="timer"
          aria-label="Session timer"
          className={lastMinute ? 'mono timer live' : 'mono timer'}
        >
          {remaining <= 0 ? "Time's up" : countdown(remaining)}
        </p>
      )}

      {viewer.role === 'participant' && status === 'voting' && viewer.dotsRemaining !== null && (
        <p className="mono">
          <Ticker value={viewer.dotsRemaining} /> of {workshop.voting?.dotBudget ?? 0} dots left
        </p>
      )}

      {isFacilitator && (
        <>
          <FacilitatorControls {...props} status={status} />
          {status === 'silent_round' && <RoomList participants={board.participants ?? []} />}
          {(status === 'voting' || status === 'closed' || status === 'archived') && (
            <VoteTotals clusters={board.clusters} frames={board.frames} />
          )}
          {facilitatorWorkshop && <LinkControls {...props} workshop={facilitatorWorkshop} />}
          {facilitatorWorkshop && <InviteControls {...props} workshop={facilitatorWorkshop} />}
          <section className="drawer-section">
            <div className="row">
              <button type="button" onClick={props.onOpenTrash}>
                Trash
              </button>
              <button type="button" onClick={props.onOpenVersions}>
                Versions
              </button>
            </div>
          </section>
          {facilitatorWorkshop?.recap && (
            <section className="drawer-section">
              <p>
                {recapStatusText(
                  facilitatorWorkshop.recap.status,
                  facilitatorWorkshop.recap.reason,
                  facilitatorWorkshop.recap.recipients,
                )}
              </p>
              {facilitatorWorkshop.recap.invoice && (
                <p className="mono">
                  Invoice {facilitatorWorkshop.recap.invoice.number} — €
                  {displayAmount(facilitatorWorkshop.recap.invoice.amount)}
                </p>
              )}
              <a href={facilitatorWorkshop.recap.recapUrl}>Open recap page</a>
            </section>
          )}
        </>
      )}
    </aside>
  );
}

function FacilitatorControls(props: DrawerProps & { status: WorkshopStatus }): JSX.Element {
  const legal = new Set(LEGAL_EDGES[props.status]);
  return (
    <section className="drawer-section">
      <div className="field">
        <label htmlFor="round-length">Round length in minutes</label>
        <input
          id="round-length"
          type="number"
          min={1}
          max={60}
          value={props.roundMinutes}
          onChange={(event) => props.setRoundMinutes(Number.parseInt(event.target.value, 10) || 1)}
        />
      </div>
      <div className="field">
        <label htmlFor="vote-length">Voting length in minutes</label>
        <input
          id="vote-length"
          type="number"
          min={1}
          max={60}
          value={props.voteMinutes}
          onChange={(event) => props.setVoteMinutes(Number.parseInt(event.target.value, 10) || 1)}
        />
      </div>
      <div className="field">
        <label htmlFor="dots-per-person">Dots per person</label>
        <input
          id="dots-per-person"
          type="number"
          min={1}
          max={20}
          value={props.dotsPerPerson}
          onChange={(event) => props.setDotsPerPerson(Number.parseInt(event.target.value, 10) || 1)}
        />
      </div>
      <div className="row">
        {/* Each control shows only when its move is legal from the current state. */}
        {TRANSITION_BUTTONS.filter((button) => legal.has(button.to)).map((button) => (
          <button
            key={button.to}
            type="button"
            className={button.to === 'closed' ? '' : 'primary'}
            disabled={props.transitionPending}
            onClick={() => props.onTransition(button.to)}
          >
            {props.transitionPending ? 'Working…' : button.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function RoomList({ participants }: { participants: readonly BoardParticipant[] }): JSX.Element {
  return (
    <section className="drawer-section">
      <ul className="rule-list" aria-label="Room">
        {participants.map((participant) => (
          <li key={participant.id}>
            {participant.displayName} — {participant.notesThisRound} notes this round
          </li>
        ))}
      </ul>
    </section>
  );
}

function VoteTotals({
  clusters,
  frames,
}: {
  clusters: readonly BoardCluster[];
  frames: readonly { id: string; position: number }[];
}): JSX.Element {
  const positionOf = new Map(frames.map((frame) => [frame.id, frame.position]));
  // One ranking order: dot total, then the frame's rail position, then title ignoring case.
  const ranked = [...clusters].sort((a, b) => {
    const left = a.dotTotal ?? 0;
    const right = b.dotTotal ?? 0;
    if (left !== right) return right - left;
    const leftFrame = positionOf.get(a.frameId) ?? 0;
    const rightFrame = positionOf.get(b.frameId) ?? 0;
    if (leftFrame !== rightFrame) return leftFrame - rightFrame;
    return a.title.toLocaleLowerCase() < b.title.toLocaleLowerCase() ? -1 : 1;
  });
  return (
    <section className="drawer-section">
      <ul className="rule-list" aria-label="Vote totals">
        {ranked.map((cluster) => (
          <li key={cluster.id} className="mono">
            {cluster.title} — <Ticker value={cluster.dotTotal ?? 0} /> dots
          </li>
        ))}
      </ul>
    </section>
  );
}

function LinkControls(props: DrawerProps & { workshop: FacilitatorWorkshop }): JSX.Element {
  const { workshop } = props;
  return (
    <section className="drawer-section">
      {workshop.joinUrl !== null && (
        <>
          <p className="join-link mono">{workshop.joinUrl}</p>
          <p className="muted mono">
            Expires {displayDate(Date.parse(workshop.joinLinkExpiresAt), workshop.timeZone)},{' '}
            {displayTime(Date.parse(workshop.joinLinkExpiresAt), workshop.timeZone)}
          </p>
        </>
      )}
      <div className="row">
        <button type="button" onClick={props.onCopyLink}>
          Copy join link
        </button>
        <button type="button" onClick={props.onRotateLink}>
          New join link
        </button>
        <button type="button" onClick={props.onTurnOffLink}>
          Turn off join link
        </button>
      </div>
    </section>
  );
}

function InviteControls(props: DrawerProps & { workshop: FacilitatorWorkshop }): JSX.Element {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <section className="drawer-section">
      <div className="field">
        <label htmlFor="client-emails">Client emails</label>
        <textarea
          id="client-emails"
          ref={areaRef}
          rows={3}
          value={props.inviteText}
          onChange={(event) => props.setInviteText(event.target.value)}
        />
        {props.inviteFieldError !== '' && <p className="field-error">{props.inviteFieldError}</p>}
      </div>
      <button type="button" onClick={props.onSendInvites} disabled={props.invitePending}>
        {props.invitePending ? 'Sending…' : 'Send invites'}
      </button>
      <ul className="rule-list" aria-label="Invites">
        {props.workshop.invites.map((invite) => (
          <li key={invite.email}>
            {invite.email} — {invite.status}
          </li>
        ))}
      </ul>
    </section>
  );
}
