// The online lobby: create, join, ready, countdown from the server, live race.
import { useEffect, useRef, useState, type JSX } from 'react';
import { api, type LobbyBody } from './api';
import { useApp, usePush, sendWs } from './appState';
import { Dialog, navigate } from './ui';
import { parseRaceAddress } from './raceScreen';
import { useEffect as useReactEffect } from 'react';

export default function LobbyScreen({ lobbyId }: { lobbyId: string | null }): JSX.Element {
  const { me } = useApp();
  const [lobby, setLobby] = useState<LobbyBody | null>(null);
  const [aiCount, setAiCount] = useState(1);
  const [message, setMessage] = useState('');
  const [started, setStarted] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [joined, setJoined] = useState(false);
  const tooNarrow = useState(window.innerWidth < 1024)[0];
  const keyStateRef = useRef({ throttle: 0, brake: 0, drift: 0, lane: 'middle' });

  // Create the lobby when none is given.
  useEffect(() => {
    if (lobbyId !== null) return;
    // The create action happens from the form button below.
  }, [lobbyId]);

  const create = async (): Promise<void> => {
    const created = await api.createLobby(aiCount);
    navigate(`/lobby/${created.lobbyId}`, '[data-join]');
  };

  const load = async (): Promise<void> => {
    if (lobbyId === null) return;
    try {
      const body = await api.lobby(lobbyId);
      setLobby(body);
    } catch {
      setMessage('This lobby is full.');
    }
  };

  // Join, subscribe, ready and key state, all from the server's messages.
  useEffect(() => {
    if (lobbyId === null || me === null) return;
    void api.lobby(lobbyId).then(body => {
      setLobby(body);
      const isMember = body.players.some(p => p.playerId === me.playerId);
      setJoined(isMember && body.state === 'open' ? true : isMember);
      // Subscribe to the lobby's pushes over the WebSocket.
      sendWs({ type: 'subscribe', lobbyId });
    }).catch(() => setMessage('This lobby is full.'));
    return () => { /* the socket stays; the lobby page unsubscribes by closing */ };
  }, [lobbyId, me]);

  // Live lobby updates from the push channel.
  usePush((msg) => {
    if (msg.type === 'lobby' && msg.lobby) {
      const body = msg.lobby as LobbyBody;
      if (body.lobbyId === lobbyId) {
        setLobby(body);
        if (body.state === 'racing') setStarted(true);
      }
    }
  });

  // Poll as a fallback for missed pushes.
  useEffect(() => {
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  });

  const toggleReady = async (): Promise<void> => {
    if (lobbyId === null || !lobby) return;
    const mineRow = lobby.players.find(p => p.playerId === me?.playerId);
    try {
      const body = await api.setReady(lobbyId, !(mineRow?.ready ?? false));
      setLobby(body);
    } catch { /* ignore */ }
  };

  // During the race, driving keys send the player's key state on every change.
  useReactEffect(() => {
    if (!started || tooNarrow) return;
    const send = (): void => sendWs({ type: 'keyState', lobbyId, keyState: keyStateRef.current });
    const onKey = (e: KeyboardEvent): void => {
      const lanes = ['left', 'middle', 'right'] as const;
      const k = keyStateRef.current;
      let changed = false;
      if (e.key === 'ArrowUp' || e.key === 'w') { k.throttle = 1; changed = true; }
      if (e.key === 'ArrowDown' || e.key === 's') { k.brake = 1; changed = true; }
      if (e.key === ' ') { k.drift = 1; changed = true; }
      if (e.key === 'ArrowLeft') { k.lane = lanes[Math.max(0, lanes.indexOf(k.lane as never) - 1)]; changed = true; }
      if (e.key === 'ArrowRight') { k.lane = lanes[Math.min(2, lanes.indexOf(k.lane as never) + 1)]; changed = true; }
      if (changed) { e.preventDefault(); send(); }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      const k = keyStateRef.current;
      if (e.key === 'ArrowUp' || e.key === 'w') { k.throttle = 0; send(); }
      if (e.key === 'ArrowDown' || e.key === 's') { k.brake = 0; send(); }
      if (e.key === ' ') { k.drift = 0; send(); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [started, tooNarrow, lobbyId]);

  if (lobbyId === null) {
    return (
      <main className="page" style={{ paddingTop: 20, maxWidth: 560 }}>
        <h1>Online lobby</h1>
        <label className="field">
          <span className="label">AI drivers</span>
          <select aria-label="AI drivers" value={aiCount} onChange={e => setAiCount(Number(e.target.value))}>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
        <button className="btn btn-primary" onClick={() => void create()}>Create private lobby</button>
      </main>
    );
  }

  const statusCopy = (body: LobbyBody): string => {
    if (body.state === 'open') return 'Waiting for players';
    if (body.state === 'countdown') return body.countdown !== null ? `Starting in ${body.countdown}` : 'Starting in 0';
    if (body.state === 'racing') return body.graceSecondsLeft !== null ? `Finish grace: ${body.graceSecondsLeft} s` : 'Racing';
    return 'Finished';
  };

  return (
    <main className="page" style={{ paddingTop: 20 }}>
      <h1>Online lobby</h1>
      {message && <div className="alert" role="alert">{message}</div>}
      <div className="status" role="status" aria-live="polite">
        {lobby ? statusCopy(lobby) : 'Loading…'}
      </div>
      {lobby && (
        <>
          <label className="field" style={{ maxWidth: 560 }}>
            <span className="label">Invite link</span>
            <input type="text" aria-label="Invite link" readOnly value={inviteUrl || (inviteUrlOf(lobbyId))} />
          </label>
          <button className="btn btn-quiet" onClick={() => void navigator.clipboard?.writeText(inviteUrlOf(lobbyId))}>
            Copy invite link
          </button>
          <section aria-label="Players" style={{ marginTop: 16 }}>
            <h2>Players</h2>
            <ul className="table" style={{ listStyle: 'none', padding: 0 }}>
              {lobby.players.map(p => (
                <li key={p.playerId} style={{ padding: '8px 10px', borderBottom: '1px solid var(--rule)' }}>
                  {p.name} — {p.connection === 'reconnecting' ? 'Reconnecting' : (p.ready ? 'Ready' : 'Not ready')}
                </li>
              ))}
              {lobby.ai.map(a => (
                <li key={a.name} style={{ padding: '8px 10px', borderBottom: '1px solid var(--rule)' }}>
                  {a.name}
                </li>
              ))}
            </ul>
          </section>
          {lobby.state === 'open' || lobby.state === 'countdown' ? (
            joined ? (
              <button className="btn btn-primary" data-join name="join" onClick={() => void toggleReady()}>
                {lobby.players.find(p => p.playerId === me?.playerId)?.ready ? 'Not ready' : 'Ready'}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => {
                void api.joinLobby(lobbyId).then(body => {
                  setLobby(body);
                  setJoined(true);
                }).catch(err => {
                  const code = (err as { code?: string }).code;
                  if (code === 'LOBBY_FULL') setMessage('This lobby is full.');
                  else if (code === 'LOBBY_CLOSED') setMessage('This lobby has already started.');
                });
              }}>Join lobby</button>
            )
          ) : tooNarrow ? (
            <div className="notice">Racing needs a desktop browser with a keyboard.</div>
          ) : (
            <section aria-label="Positions" style={{ marginTop: 16 }}>
              <h2>Positions</h2>
              <ol className="table" style={{ listStyle: 'none', padding: 0 }}>
                {[...lobby.players, ...lobby.ai.map(a => ({ ...a, dnf: false }))]
                  .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
                  .map((p, i) => (
                    <li key={p.name} style={{ padding: '8px 10px', borderBottom: '1px solid var(--rule)' }}>
                      {p.position ?? i + 1}. {p.name}{p.dnf ? ' DNF' : ''}
                    </li>
                  ))}
              </ol>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function inviteUrlOf(lobbyId: string): string {
  return `${window.location.origin}/lobby/${lobbyId}`;
}
