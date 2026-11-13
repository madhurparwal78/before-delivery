import { useEffect, useState } from 'react';
import type { Piece, SidesIn } from '../../shared/types';
import { formatMoney } from '../../shared/labels';
import { api } from '../api';
import { StatusLabel } from '../components/bits';
import { navigate } from '../app';

export function sidesText(sides: SidesIn): string {
  const parts = sides.diameter
    ? [`${sides.diameter} in`, `${sides.height} in`]
    : [`${sides.length} in`, `${sides.width} in`, `${sides.height} in`];
  return parts.join(' × ');
}

export function MyPiecesScreen(): JSX.Element {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [balance, setBalance] = useState<string>('');

  useEffect(() => {
    void api.get<Piece[]>('/api/pieces').then(setPieces);
    void api
      .get<{ owed_cents: number }>('/api/me/balance')
      .then((result) => setBalance(`$${formatMoney(result.owed_cents)}`))
      .catch(() => setBalance('Balance unavailable while billing is down.'));
  }, []);

  return (
    <section>
      <h1>My pieces</h1>
      <div className="pane">
        <table aria-label="My pieces">
          <caption>My pieces</caption>
          <thead>
            <tr>
              <th scope="col">Piece</th>
              <th scope="col">Status</th>
              <th scope="col">Sizes</th>
              <th scope="col">Fee</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((piece) => (
              <tr key={piece.number}>
                <td>
                  <a
                    className="mono"
                    href={`/pieces/${piece.number}`}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(`/pieces/${piece.number}`);
                    }}
                  >
                    {piece.number}
                  </a>
                </td>
                <td>
                  <StatusLabel status={piece.status} label={piece.status_label} />
                </td>
                <td className="mono">{sidesText(piece.sides_in)}</td>
                <td className="mono">${formatMoney(piece.fee_cents)}</td>
              </tr>
            ))}
            {pieces.length === 0 && (
              <tr>
                <td colSpan={4}>No pieces logged yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pane" role="region" aria-label="My balance">
        <h2>My balance</h2>
        <p className={balance.startsWith('$') ? 'big-number' : 'live bad'}>{balance}</p>
      </div>
    </section>
  );
}
