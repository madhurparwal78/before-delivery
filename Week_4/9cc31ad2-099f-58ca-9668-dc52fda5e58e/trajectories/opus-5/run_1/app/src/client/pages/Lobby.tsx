import { useCallback, useEffect, useRef, useState } from 'react';
import { LOBBY_LAYOUT } from '../../shared/catalogue.js';
import { formatSpeed, type Units } from '../../shared/format.js';
import { LANES, type InputState } from '../../shared/race-model.js';
import { apiGet, apiPost } from '../api.js';
import { Page } from '../components/Page.js';
import { RaceView, type RaceCar, type RaceSceneRef } from '../components/RaceView.js';
import { copy, countdownCopy, graceCopy } from '../copy.js';
import { useWideEnoughToRace } from '../hooks.js';
import { navigate } from '../router.js';
import { sendKeys, usePush, useMe } from '../store.js';
import type { LobbyBody } from '../types.js';

export function LobbyNew() {
  const [aiCount, setAiCount] = useState(1);
  return (
    <Page gutter={['Lobby']}>
      <h1>Online lobby</h1>
      <div className="cell row">
        <label className="filter-field">
          <span className="label">AI drivers</span>
          <select
            aria-label="AI drivers"
            value={aiCount}
            onChange={(event) => setAiCount(Number.parseInt(event.target.value, 10))}
          >
            {[0, 1, 2].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          onClick={() =>
            void apiPost<{ lobbyId: string; inviteUrl: string }>('/v1/lobbies', { aiCount }).then(
              (result) => {
                if (result.kind === 'ok') navigate(result.data.inviteUrl);
              },
            )
          }
        >
          Create private lobby
        </button>
      </div>
    </Page>
  );
}

function statusCopy(lobby: LobbyBody | null): string {
  if (lobby === null) return copy.lobbyWaiting;
  if (lobby.state === 'countdown' && lobby.countdown !== null) {
    return countdownCopy(lobby.countdown);
  }
  if (lobby.state === 'racing') {
    return lobby.graceSecondsLeft !== null ? graceCopy(lobby.graceSecondsLeft) : copy.lobbyRacing;
  }
  if (lobby.state === 'finished') return copy.lobbyFinished;
  return copy.lobbyWaiting;
}

export function Lobby({ lobbyId }: { lobbyId: string }) {
  const { me } = useMe();
  const wideEnough = useWideEnoughToRace();
  const units: Units = me?.units ?? 'kmh';
  const [lobby, setLobby] = useState<LobbyBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const joinButton = useRef<HTMLButtonElement>(null);
  const keys = useRef<InputState>({ throttle: 0, brake: 0, drift: 0, lane: 'middle' });
  const scene = useRef<RaceSceneRef>({ cars: [] });

  const load = useCallback(async () => {
    const result = await apiGet<LobbyBody>(`/v1/lobbies/${lobbyId}`);
    if (result.kind === 'ok') setLobby(result.data);
  }, [lobbyId]);

  useEffect(() => {
    void load();
  }, [load]);

  usePush(
    useCallback(
      (push) => {
        if (push.type === 'lobby' && push.lobbyId === lobbyId) setLobby(push);
      },
      [lobbyId],
    ),
  );

  const member = lobby?.players.some((player) => player.playerId === me?.playerId) ?? false;

  useEffect(() => {
    if (!member) joinButton.current?.focus();
  }, [member]);

  // The driving keys send the player's key state to the server on every change.
  useEffect(() => {
    if (lobby?.state !== 'racing') return;
    const change = (next: Partial<InputState>) => {
      keys.current = { ...keys.current, ...next };
      sendKeys(keys.current);
    };
    const laneStep = (direction: -1 | 1) => {
      const index = LANES.indexOf(keys.current.lane);
      const next = LANES[index + direction];
      if (next) change({ lane: next });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') change({ throttle: 1 });
      else if (key === 'arrowdown' || key === 's') change({ brake: 1 });
      else if (key === ' ') change({ drift: 1 });
      else if (key === 'arrowleft' || key === 'a') laneStep(-1);
      else if (key === 'arrowright' || key === 'd') laneStep(1);
      else return;
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') change({ throttle: 0 });
      else if (key === 'arrowdown' || key === 's') change({ brake: 0 });
      else if (key === ' ') change({ drift: 0 });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [lobby?.state]);

  const mine = lobby?.players.find((player) => player.playerId === me?.playerId);
  const racing = lobby?.state === 'racing' || lobby?.state === 'finished';

  if (racing) {
    const grid = (lobby?.players.length ?? 0) + (lobby?.ai.length ?? 0);
    scene.current.cars = [
      ...(lobby?.players ?? []).map(
        (player): RaceCar => ({
          kind: player.playerId === me?.playerId ? 'player' : 'ai',
          distance: (grid - (player.position ?? grid)) * 25,
          lane: 'middle',
        }),
      ),
      ...(lobby?.ai ?? []).map(
        (ai): RaceCar => ({
          kind: 'ai',
          distance: (grid - (ai.position ?? grid)) * 25,
          lane: 'middle',
        }),
      ),
    ];
  }

  const tower = [
    ...(lobby?.players ?? []).map((player) => ({
      position: player.position,
      name: player.name,
      dnf: player.dnf,
    })),
    ...(lobby?.ai ?? []).map((ai) => ({ position: ai.position, name: ai.name, dnf: false })),
  ]
    .filter((entry) => entry.position !== null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  return (
    <Page gutter={['Lobby', 'Grid']}>
      <h1>Online lobby</h1>
      <div className="cell" role="status" aria-label="Lobby status">
        {statusCopy(lobby)}
      </div>
      {error !== null && <p className="cell">{error}</p>}
      <div className="cell stack">
        <label className="filter-field">
          <span className="label">Invite link</span>
          <input
            type="text"
            readOnly
            aria-label="Invite link"
            value={`${window.location.origin}/lobby/${lobbyId}`}
          />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void navigator.clipboard?.writeText(`${window.location.origin}/lobby/${lobbyId}`)
          }
        >
          Copy invite link
        </button>
      </div>
      <ul aria-label="Players" className="cell">
        {(lobby?.players ?? []).map((player) => (
          <li key={player.playerId}>
            {player.name} ·{' '}
            {player.connection === 'reconnecting'
              ? copy.reconnecting
              : player.ready
                ? 'Ready'
                : 'Not ready'}
          </li>
        ))}
      </ul>
      <div className="row">
        {!member ? (
          <button
            type="button"
            className="primary"
            ref={joinButton}
            onClick={() =>
              void apiPost<LobbyBody>(`/v1/lobbies/${lobbyId}/join`, {}).then((result) => {
                if (result.kind === 'ok') setLobby(result.data);
                else if (result.kind === 'error') {
                  if (result.body.error.code === 'LOBBY_FULL') setError(copy.lobbyFull);
                  if (result.body.error.code === 'LOBBY_CLOSED') setError(copy.lobbyStarted);
                }
              })
            }
          >
            Join lobby
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() =>
              void apiPost<LobbyBody>(`/v1/lobbies/${lobbyId}/ready`, {
                ready: !(mine?.ready ?? false),
              }).then((result) => {
                if (result.kind === 'ok') setLobby(result.data);
              })
            }
          >
            {mine?.ready === true ? 'Not ready' : 'Ready'}
          </button>
        )}
      </div>

      {racing &&
        (wideEnough ? (
          <>
            <div className="race-screen">
              <RaceView layoutId={LOBBY_LAYOUT} scene={scene} cars={scene.current.cars} />
              <div className="hud" role="region" aria-label="Race HUD" tabIndex={0}>
                <span className="hud-line">
                  Lap {mine?.lap ?? 1}/1
                </span>
                <span className="hud-line">
                  Position {mine?.position ?? 1}/
                  {(lobby?.players.length ?? 1) + (lobby?.ai.length ?? 0)}
                </span>
                <span className="hud-line">{formatSpeed(0, units)}</span>
              </div>
            </div>
            <ul aria-label="Positions" className="cell">
              {tower.map((entry) => (
                <li key={entry.name}>
                  {entry.position}. {entry.name}
                  {entry.dnf ? ' DNF' : ''}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="cell">{copy.desktopNotice}</p>
        ))}
    </Page>
  );
}
