import { useEffect, useState } from 'react';
import type { NightDetail, NightSummary } from '../../shared/protocol';
import { api } from '../lib/api';
import { copy, formatNightDate } from '../lib/copy';
import { Link } from '../lib/router';
import { HostHeader } from '../components';

export function PastNights(): JSX.Element {
  const [nights, setNights] = useState<NightSummary[] | null>(null);

  useEffect(() => {
    void api.get<{ nights: NightSummary[] }>('/api/nights').then((result) => {
      setNights(result.ok ? result.data.nights : []);
    });
  }, []);

  return (
    <main className="page">
      <HostHeader title="Past nights">
        <Link to="/host">Your decks</Link>
      </HostHeader>
      <h1>Past nights</h1>
      {nights === null ? (
        <p className="status">{copy.loadingNights}</p>
      ) : nights.length === 0 ? (
        <p className="status">{copy.noNights}</p>
      ) : (
        <ul className="night-list" aria-label="Past nights">
          {nights.map((night) => (
            <li className="night-row" key={night.roomId}>
              <div>
                <Link to={`/host/nights/${night.roomId}`}>
                  {`${night.deckTitle} — ${formatNightDate(night.endedAt)}`}
                </Link>
              </div>
              <p className="night-top">
                {night.podium.length > 0
                  ? night.podium.map((entry) => entry.nickname).join(' · ')
                  : 'No players'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function NightResults({ roomId }: { roomId: string }): JSX.Element {
  const [night, setNight] = useState<NightDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api.get<{ night: NightDetail }>(`/api/nights/${roomId}`).then((result) => {
      if (result.ok) setNight(result.data.night);
      else setMissing(true);
    });
  }, [roomId]);

  return (
    <main className="page">
      <HostHeader title="Night results">
        <Link to="/host/nights">Past nights</Link>
      </HostHeader>
      {missing ? (
        <p className="status">{copy.noNights}</p>
      ) : (
        <>
          <h1>{night ? `${night.deckTitle} — ${formatNightDate(night.endedAt)}` : ''}</h1>
          <table aria-label="Final standings">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Nickname</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {(night?.standings ?? []).map((entry) => (
                <tr key={`${entry.rank}-${entry.nickname}`}>
                  <td className="rank">{entry.rank}</td>
                  <td>{entry.nickname}</td>
                  <td className="score">{entry.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
