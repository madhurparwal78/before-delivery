import { useEffect, useState, type ReactNode } from 'react';
import { formatNumber } from '../../shared/domain';
import { api, ApiFailure, type Tournament } from '../api';
import { subscribe } from '../live';
import { refreshMe, type Store } from '../store';
import { Figures, Link, Screen } from '../ui';

export function Tournaments({ store }: { store: Store }): ReactNode {
  const [brackets, setBrackets] = useState<Tournament[]>([]);
  const [notice, setNotice] = useState('');
  const load = (): void => void api<{ tournaments: Tournament[] }>('GET', '/api/tournaments').then(({ tournaments }) => setBrackets(tournaments)).catch(() => undefined);
  useEffect(() => {
    load();
    return subscribe('tournaments', load);
  }, []);
  const register = async (bracket: Tournament): Promise<void> => {
    try {
      await api('POST', `/api/tournaments/${bracket.id}/register`);
      setNotice(`Registered. ${formatNumber(bracket.entry)} Coins moved to the bracket.`);
      await refreshMe();
      load();
    } catch (error) {
      setNotice((error as ApiFailure).message);
    }
  };
  return (
    <Screen store={store} title="Tournaments">
      <p role="status" className="notice">{notice}</p>
      <div className="tournament-grid">
        {brackets.map((bracket) => (
          <article className="tournament-card" key={bracket.id}>
            <h2>{bracket.tierName}</h2>
            <p><span className="caption">Entry </span><span className="tier-figure"><Figures text={formatNumber(bracket.entry)} /></span></p>
            <p className="note">First prize {formatNumber(bracket.prizes.first)} Coins</p>
            <p>{bracket.entrantCount} of 8 entered</p>
            <button type="button" className="primary" onClick={() => void register(bracket)}>Register for {bracket.tierName}</button>
            <Link href={`/tournaments/${bracket.id}`} className="button">{bracket.tierName} bracket</Link>
          </article>
        ))}
      </div>
    </Screen>
  );
}

function logLines(bracket: Tournament, viewerId: string | undefined): string[] {
  const lines: string[] = [];
  const entered = bracket.entrants.find((entrant) => entrant.playerId === viewerId);
  const drawn = bracket.entrants.some((entrant) => entrant.slot !== null);
  if (drawn) lines.push('Bracket drawn. Ready check started.');
  if (entered?.ready) lines.push('You are ready.');
  if (['round_of_8', 'semi_finals', 'final', 'paid'].includes(bracket.status)) lines.push('All players ready.');
  if (bracket.status === 'refunded' && entered !== undefined) {
    lines.push(drawn ? `Ready check missed. Your ${formatNumber(bracket.entry)} Coins are back.` : `Not enough players. Your ${formatNumber(bracket.entry)} Coins are back.`);
  }
  return lines;
}

export function Bracket({ store, id }: { store: Store; id: string }): ReactNode {
  const [bracket, setBracket] = useState<Tournament | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void api<Tournament>('GET', `/api/tournaments/${id}`).then(setBracket).catch(() => setMissing(true));
    return subscribe(`tournament:${id}`, (message) => {
      setBracket(message.body as Tournament);
    });
  }, [id]);

  if (missing) return <Screen store={store} title="Nothing on this table"><></></Screen>;
  if (bracket === null) return <Screen store={store} title="Tournament"><p className="note">–</p></Screen>;

  const entrant = bracket.entrants.find((item) => item.playerId === store.me?.id);
  const bySlot = new Map(bracket.entrants.map((item) => [item.slot, item.displayName]));
  const confirmReady = async (): Promise<void> => {
    setBracket(await api<Tournament>('POST', `/api/tournaments/${id}/ready`));
  };
  const lines = logLines(bracket, store.me?.id);
  const { first, second, semiFinal } = bracket.prizes;

  return (
    <Screen store={store} title={`${bracket.tierName} bracket`}>
      <p role="status" aria-label="Entrants" className="turn-text">{bracket.entrantCount} of 8 entered</p>
      {bracket.windowSecondsLeft !== null && <p className="note">Window closes in {bracket.windowSecondsLeft}s</p>}
      <p role="status" aria-label="Ready check" className="notice">{bracket.readySecondsLeft === null ? '' : `Ready check: ${bracket.readySecondsLeft}s left`}</p>
      <section className="bracket" role="region" aria-label="Bracket">
        <ol className="bracket-slots" aria-label="Bracket slots" role="list">
          {Array.from({ length: 8 }, (_, index) => index + 1).map((slot) => (
            <li key={slot} tabIndex={0}>Slot {slot}: {bySlot.get(slot) ?? 'Open'}</li>
          ))}
        </ol>
      </section>
      {bracket.status === 'ready_check' && entrant !== undefined && (
        <button type="button" className="primary" disabled={entrant.ready} onClick={() => void confirmReady()}>Ready</button>
      )}
      {store.me?.activeTableUrl && <Link href={store.me.activeTableUrl} className="button">Back to table</Link>}
      <div role="log" aria-label="Tournament announcements" aria-live="polite" className="announce">
        {lines.map((line) => <p key={line}>{line}</p>)}
      </div>
      <table className="figures" aria-label="Prize split">
        <thead><tr><th scope="col">Place</th><th scope="col">Coins</th></tr></thead>
        <tbody>
          <tr><td>First</td><td className="num"><Figures text={formatNumber(first)} /></td></tr>
          <tr><td>Second</td><td className="num"><Figures text={formatNumber(second)} /></td></tr>
          <tr><td>Each semi-final loser</td><td className="num"><Figures text={formatNumber(semiFinal)} /></td></tr>
        </tbody>
      </table>
    </Screen>
  );
}
