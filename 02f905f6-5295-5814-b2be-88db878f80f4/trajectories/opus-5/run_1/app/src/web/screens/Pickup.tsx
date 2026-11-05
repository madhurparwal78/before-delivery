import { useEffect, useState } from 'react';
import type { Piece } from '../../shared/types';
import { ApiFailure, api } from '../api';
import { LiveRegion, quiet, type LiveMessage } from '../components/bits';

export function PickupScreen(): JSX.Element {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [result, setResult] = useState<LiveMessage>(quiet);

  const load = (): void => {
    void api.get<Piece[]>('/api/pieces').then((all) =>
      setPieces(all.filter((piece) => piece.status === 'ready' || piece.status === 'uncollected')),
    );
  };

  useEffect(load, []);

  const collect = async (piece: Piece): Promise<void> => {
    try {
      await api.post(`/api/pieces/${piece.number}/collect`);
      setResult({ text: `Piece ${piece.number} marked collected.`, tone: 'good' });
    } catch (error) {
      setResult({
        text:
          error instanceof ApiFailure && error.status === 409
            ? `Piece ${piece.number} is not on the pickup shelf.`
            : 'The studio server is unreachable.',
        tone: 'bad',
      });
    }
    load();
  };

  return (
    <section>
      <h1>Pickup shelf</h1>
      <div className="pane">
        <table aria-label="Pickup shelf">
          <caption>Pickup shelf</caption>
          <thead>
            <tr>
              <th scope="col">Piece</th>
              <th scope="col">Owner</th>
              <th scope="col">Shelf</th>
              <th scope="col">Days waiting</th>
              <th scope="col">Collected</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((piece) => (
              <tr key={piece.number}>
                <td className="mono">{piece.number}</td>
                <td>{piece.owner.name}</td>
                <td className="mono">{piece.pickup_shelf ?? '—'}</td>
                <td className="mono">{piece.days_on_shelf ?? 0} days</td>
                <td>
                  <button type="button" onClick={() => void collect(piece)}>
                    Mark Piece {piece.number} collected
                  </button>
                </td>
              </tr>
            ))}
            {pieces.length === 0 && (
              <tr>
                <td colSpan={5}>Nothing is waiting on the pickup shelf.</td>
              </tr>
            )}
          </tbody>
        </table>
        <LiveRegion name="Pickup result" message={result} />
      </div>
    </section>
  );
}
