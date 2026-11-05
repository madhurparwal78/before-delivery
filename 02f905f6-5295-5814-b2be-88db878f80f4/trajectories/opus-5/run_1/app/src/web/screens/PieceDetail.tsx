import { useEffect, useState } from 'react';
import type { Piece, User } from '../../shared/types';
import { formatMoney, PLAN_LABELS } from '../../shared/labels';
import { api } from '../api';
import { LiveRegion, PhotoMat, StatusLabel, quiet, type LiveMessage } from '../components/bits';
import { sidesText } from './MyPieces';

export function PieceDetailScreen({
  number,
  user,
}: {
  number: string;
  user: User;
}): JSX.Element {
  const [piece, setPiece] = useState<Piece | null>(null);
  const [missing, setMissing] = useState(false);
  const [tracking, setTracking] = useState<LiveMessage>(quiet);

  const load = (): void => {
    api
      .get<Piece>(`/api/pieces/${number}`)
      .then(setPiece)
      .catch(() => setMissing(true));
  };

  useEffect(load, [number]);

  if (missing) return <p>Not found.</p>;
  if (!piece) return <p>Loading…</p>;

  const guestPiece = piece.owner.kind === 'guest';

  return (
    <section>
      <h1>Piece {piece.number}</h1>
      <div className="pane">
        <p>
          <StatusLabel status={piece.status} label={piece.status_label} />
        </p>
        <dl className="fee-panel">
          <dt>Sizes</dt>
          <dd>{sidesText(piece.sides_in)}</dd>
          <dt>Volume</dt>
          <dd>{piece.cubic_inches} in³</dd>
          <dt>Fee</dt>
          <dd>${formatMoney(piece.fee_cents)}</dd>
          <dt>Plan</dt>
          <dd>{PLAN_LABELS[piece.plan]}</dd>
          <dt>Glaze cone</dt>
          <dd>{piece.cone ? `Cone ${piece.cone}` : '—'}</dd>
          <dt>Pickup shelf</dt>
          <dd>{piece.pickup_shelf ?? '—'}</dd>
          <dt>Owner</dt>
          <dd>{piece.owner.name}</dd>
        </dl>
      </div>

      <div className="pane">
        <h2>Intake photo</h2>
        <PhotoMat
          photoId={piece.intake_photo_id}
          alt={`Intake photo of Piece ${piece.number}`}
          caption={`Piece ${piece.number} — intake photo`}
        />
      </div>

      <div className="pane">
        <h2>History</h2>
        <ul aria-label="History">
          {piece.history.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <span className="mono">{entry.at_label}</span> — {entry.action} by {entry.actor}
            </li>
          ))}
        </ul>
      </div>

      {guestPiece && user.role === 'owner' && (
        <div className="pane">
          <h2>Tracking link</h2>
          <p>
            <button
              type="button"
              onClick={() => {
                void api
                  .post(`/api/pieces/${piece.number}/tracking-link/revoke`)
                  .then(() => setTracking({ text: 'Tracking link revoked.', tone: 'good' }))
                  .then(load);
              }}
            >
              Revoke tracking link
            </button>{' '}
            <button
              type="button"
              onClick={() => {
                void api
                  .post(`/api/pieces/${piece.number}/tracking-link`)
                  .then(() =>
                    setTracking({
                      text: `New tracking link created. An email to ${piece.owner.email} is on its way.`,
                      tone: 'good',
                    }),
                  )
                  .then(load);
              }}
            >
              New tracking link
            </button>
          </p>
          <LiveRegion name="Tracking result" message={tracking} />
        </div>
      )}
    </section>
  );
}
