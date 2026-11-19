import { useRef, useState } from 'react';
import { useDesk } from '../lib/desk.tsx';
import { useDraft } from '../lib/drafts.ts';
import { api } from '../lib/api.ts';
import { CoinImage, MarkerCoordinates, MarkerHandle } from '../shell/Viewers.tsx';
import { Review, ReviewLine } from '../shell/Review.tsx';
import { WorkspaceFrame } from './Workspace.tsx';
import { F } from '../../shared/feedback.ts';
import type { ResolutionOutcome } from '../../shared/types.ts';

/**
 * Disputes. The damage is pinned on the arrival photograph, the hold is
 * opened through its review, a private evidence link can be shared and
 * revoked, and both parties approve a resolution to release the hold.
 */

export function Disputes(): JSX.Element {
  const desk = useDesk();
  const party = desk.session?.role === 'counterpart' ? 'counterpart' : 'dealer';
  const offerEntry = Object.entries(desk.state?.offers ?? {}).find(([, offer]) =>
    ['dispatched', 'received', 'disputed'].includes(offer.status),
  );
  const offerKey = offerEntry?.[0] ?? '';
  const offer = offerEntry?.[1];
  const disputeEntry = Object.entries(desk.state?.disputes ?? {}).find(
    ([, dispute]) => dispute.offer === offerKey,
  );
  const disputeKey = disputeEntry?.[0] ?? '';
  const dispute = disputeEntry?.[1];

  const received = party === 'dealer' ? (offer?.counterpart_items ?? []) : (offer?.dealer_items ?? []);
  const specimenKey = dispute?.specimen ?? received[0] ?? '';
  const specimen = desk.state?.specimens[specimenKey];
  const arrival = specimen?.photos.find((photo) => photo.label === 'arrival');

  const [marker, setMarker] = useDraft(desk.ns, 'disputes', `marker-${specimenKey}`, {
    x: 600,
    y: 400,
  });
  const [note, setNote] = useDraft(desk.ns, 'disputes', `note-${specimenKey}`, '');
  const [outcome, setOutcome] = useState<ResolutionOutcome>('transfer');
  const [openOpen, setOpenOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const openButton = useRef<HTMLButtonElement>(null);
  const proposeButton = useRef<HTMLButtonElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const revokeButton = useRef<HTMLButtonElement>(null);

  const width = arrival?.width ?? 1000;
  const height = arrival?.height ?? 1000;

  const openDispute = async (): Promise<void> => {
    setOpenOpen(false);
    await desk.run({
      label: 'Hold ownership transfer',
      success: F.DISPUTE_OPEN,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/offers/${offerKey}/disputes`, {
          command_id: `dispute-${offerKey}-${specimenKey}-${offer?.version}`,
          expected_version: offer?.version,
          specimen: specimenKey,
          note,
          markers: [{ x: marker.x, y: marker.y, text: note }],
        });
      },
    });
    openButton.current?.focus();
  };

  const moveMarker = async (x: number, y: number): Promise<void> => {
    setMarker({ x, y });
    const existing = dispute?.markers[0];
    if (!dispute || !existing) return;
    await desk.run({
      label: 'Move damage marker',
      success: F.DISPUTE_OPEN,
      send: async () => {
        await api.put(
          `/api/desks/${desk.ns}/disputes/${disputeKey}/markers/${existing.id}`,
          {
            command_id: `marker-${disputeKey}-${dispute.version}`,
            expected_version: dispute.version,
            x,
            y,
            text: existing.text,
          },
        );
      },
    });
  };

  const propose = async (): Promise<void> => {
    setResolveOpen(false);
    await desk.run({
      label: 'Propose resolution',
      success: F.RESOLUTION_WAIT,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/disputes/${disputeKey}/resolution`, {
          command_id: `resolution-${disputeKey}-${dispute?.version}`,
          expected_version: dispute?.version,
          outcome,
        });
      },
    });
    proposeButton.current?.focus();
  };

  const approve = async (): Promise<void> => {
    await desk.run({
      label: 'Approve resolution',
      success: F.RESOLUTION_DONE,
      send: async () => {
        await api.post(`/api/desks/${desk.ns}/disputes/${disputeKey}/approve-resolution`, {
          command_id: `approve-${disputeKey}-${dispute?.version}`,
          expected_version: dispute?.version,
        });
      },
    });
    approveButton.current?.focus();
  };

  const copyLink = async (): Promise<void> => {
    await desk.run({
      label: 'Copy private evidence link',
      success: F.LINK_COPIED,
      send: async () => {
        const reply = await api.post<{ link: { token: string; url: string } }>(
          `/api/desks/${desk.ns}/disputes/${disputeKey}/links`,
          { command_id: `link-${disputeKey}-${Date.now()}` },
        );
        setToken(reply.link.token);
        await navigator.clipboard?.writeText(reply.link.url).catch(() => undefined);
      },
    });
  };

  const revoke = async (): Promise<void> => {
    setRevokeOpen(false);
    await desk.run({
      label: 'Revoke evidence access',
      success: F.LINK_REVOKED,
      send: async () => {
        await api.del(`/api/desks/${desk.ns}/disputes/${disputeKey}/links/${token ?? ''}`);
        setToken(null);
      },
    });
    revokeButton.current?.focus();
  };

  const markers = dispute
    ? dispute.markers.map((each) => ({ ...each, current: true }))
    : [{ id: 'damage', x: marker.x, y: marker.y, text: note, current: true }];

  const evidencePane = (
    <div className="stack">
      <h2 className="workspace-heading">Arrival evidence</h2>
      <CoinImage
        ns={desk.ns}
        photoId={arrival?.id ?? null}
        alt={`${specimen?.display_label ?? 'Specimen'} arrival`}
        width={width}
        height={height}
        markers={markers}
        onPick={(x, y) => void moveMarker(x, y)}
      />
      <MarkerHandle
        label="Damage marker"
        x={markers[0]?.x ?? marker.x}
        y={markers[0]?.y ?? marker.y}
        width={width}
        height={height}
        onMove={(x, y) => void moveMarker(x, y)}
      />
    </div>
  );

  const detailsPane = (
    <div className="stack">
      <MarkerCoordinates
        x={markers[0]?.x ?? marker.x}
        y={markers[0]?.y ?? marker.y}
        width={width}
        height={height}
        onChange={(x, y) => void moveMarker(x, y)}
        error={desk.feedback.fields['x'] ?? desk.feedback.fields['y']}
      />
      <label className="field">
        <span className="field-label">Damage note:</span>
        <textarea
          className="target"
          aria-label="Damage note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {desk.feedback.fields['note'] ? (
        <p className="field-error">{desk.feedback.fields['note']}</p>
      ) : null}

      <button
        type="button"
        className="target primary"
        ref={openButton}
        disabled={dispute?.open === true}
        onClick={() => setOpenOpen(true)}
      >
        Review dispute
      </button>

      <button
        type="button"
        className="target"
        ref={proposeButton}
        disabled={!dispute?.open}
        onClick={() => setResolveOpen(true)}
      >
        Propose resolution
      </button>
      <button
        type="button"
        className="target"
        ref={approveButton}
        disabled={!dispute?.resolution || dispute.resolution.proposed_by === party}
        onClick={() => void approve()}
      >
        Approve resolution
      </button>

      <button type="button" className="target" onClick={() => void copyLink()}>
        Copy private evidence link
      </button>
      <button
        type="button"
        className="target"
        ref={revokeButton}
        disabled={token === null}
        onClick={() => setRevokeOpen(true)}
      >
        Revoke evidence link
      </button>

      {dispute?.open ? <p className="note">{F.DISPUTE_OPEN}</p> : null}
    </div>
  );

  return (
    <>
      <WorkspaceFrame id="disputes" listKind="exchange" left={evidencePane} right={detailsPane} />

      <Review
        open={openOpen}
        title="Hold ownership transfer"
        opener={openButton}
        confirmDisabled={desk.busy || !offer}
        onCancel={() => setOpenOpen(false)}
        onConfirm={() => void openDispute()}
      >
        <ReviewLine label="Specimen" value={specimen?.display_label ?? specimenKey} />
        <ReviewLine label="Damage at" value={`${marker.x}, ${marker.y}`} />
        <ReviewLine label="Note" value={note || '(none)'} />
      </Review>

      <Review
        open={resolveOpen}
        title="Resolve transfer hold"
        opener={proposeButton}
        confirmDisabled={desk.busy || !dispute}
        onCancel={() => setResolveOpen(false)}
        onConfirm={() => void propose()}
      >
        <fieldset className="outcome-choice">
          <legend>Proposed outcome</legend>
          <label className="field checkbox-field">
            <input
              className="target"
              type="radio"
              name="outcome"
              checked={outcome === 'transfer'}
              onChange={() => setOutcome('transfer')}
            />
            <span>Transfer as agreed</span>
          </label>
          <label className="field checkbox-field">
            <input
              className="target"
              type="radio"
              name="outcome"
              checked={outcome === 'return'}
              onChange={() => setOutcome('return')}
            />
            <span>Return both baskets</span>
          </label>
        </fieldset>
      </Review>

      <Review
        open={revokeOpen}
        title="Revoke evidence access"
        opener={revokeButton}
        confirmDisabled={desk.busy || token === null}
        onCancel={() => setRevokeOpen(false)}
        onConfirm={() => void revoke()}
      >
        <p>The private evidence link stops working immediately.</p>
      </Review>
    </>
  );
}
