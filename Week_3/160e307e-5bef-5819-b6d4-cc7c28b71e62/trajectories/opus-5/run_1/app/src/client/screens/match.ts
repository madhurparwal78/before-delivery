import { api, ApiFailure } from '../api.js';
import type { MatchJson, ShotResultJson } from '../api.js';
import { clear, el } from '../dom.js';
import { MatchPlay } from '../matchplay.js';
import { navigate, onLeave, setPageStatus } from '../router.js';
import { Socket, seatToken } from '../socket.js';
import { refreshMe, state } from '../store.js';
import { otherSeat } from '../../shared/geometry.js';
import type { Seat } from '../../shared/types.js';

export async function renderMatch(params: Record<string, string>, view: HTMLElement): Promise<void> {
  const me = await refreshMe();
  let match: MatchJson;
  try {
    match = await api.get<MatchJson>(`/api/matches/${params.id}`);
  } catch {
    clear(view);
    view.append(
      el('section', { class: 'field field--ground' }, [
        el('h1', { class: 'display', text: 'Match not found', style: 'font-size: var(--step-3)' }),
        el('p', {}, [el('a', { href: '/', text: 'Home' })]),
      ]),
    );
    return;
  }

  const mySeat: Seat = match.seats[1].playerId === me?.id ? 1 : 0;
  const socket = new Socket(() => {
    const token = seatToken();
    return `?match=${params.id}${token === null ? '' : `&rt=${encodeURIComponent(token)}`}`;
  });

  const play: MatchPlay = new MatchPlay(
    match,
    {
      local: false,
      mySeat,
      turnBoard: false,
      privateRoom: match.mode === 'private',
      shoot: (intent, shotSeq) => {
        submitted.add(shotSeq);
        void (async () => {
          try {
            const result = await api.post<ShotResultJson>(`/api/matches/${params.id}/shots`, {
              shotSeq,
              x: intent.x,
              dx: intent.dx,
              dy: intent.dy,
              p: intent.p,
              modelVersion: state.config.modelVersion,
            });
            play.applyShotResult(result);
          } catch (failure) {
            submitted.delete(shotSeq);
            if (failure instanceof ApiFailure) play.showShotError(failure.code);
          }
        })();
      },
      preview: (intent) => {
        socket.send({ type: 'aim', x: intent.x, dx: intent.dx, dy: intent.dy, p: intent.p });
      },
      resign: () => {
        void api.post(`/api/matches/${params.id}/resign`).catch(() => undefined);
      },
      rematch: (accept) => {
        void api
          .post<{ status: string; matchId: string | null }>(`/api/matches/${params.id}/rematch`, { accept })
          .then((result) => {
            if (result.matchId !== null) navigate(`/match/${result.matchId}`);
          })
          .catch(() => undefined);
      },
      emote: (emote) => {
        void api.post(`/api/matches/${params.id}/emotes`, { emote }).catch(() => undefined);
      },
    },
    me?.equipped ?? { striker: 'striker-ply', board: 'board-ply', coins: 'coins-ivory' },
  );

  let lastSeq = match.shotSeq;
  const submitted = new Set<number>();

  socket.on((message) => {
    const type = message.type;
    if (type === 'state') {
      const next = message as unknown as MatchJson;
      const phase = play.phase();
      const settled = phase === 'aim' || phase === 'waiting' || phase === 'match-over';
      if (next.status === 'active' || next.status === 'waiting') {
        if (settled) play.setState(next);
        return;
      }
      if (!settled) return;
      play.setState(next);
      play.openMatchOver(next, next.boardPointsLine);
      return;
    }
    if (type === 'shotResult') {
      const result = message as unknown as ShotResultJson;
      if (result.shotSeq <= lastSeq) return;
      lastSeq = result.shotSeq;
      if (submitted.has(result.shotSeq)) return;
      play.hideGhost();
      play.applyShotResult(result);
      return;
    }
    if (type === 'preview') {
      const seat = Number(message.seat) as Seat;
      if (seat === mySeat) return;
      play.showGhost(Number(message.x), Number(message.dx), Number(message.dy), seat);
      return;
    }
    if (type === 'opponentStatus') {
      const connected = message.connected === true;
      const remaining = typeof message.reconnectRemainingMs === 'number' ? message.reconnectRemainingMs : null;
      play.showReconnecting(String(message.name ?? ''), connected ? null : remaining);
      return;
    }
    if (type === 'emote') {
      const seat = Number(message.seat) as Seat;
      if (seat === mySeat) return;
      play.showEmote(match.seats[seat].name, String(message.emote));
      return;
    }
    if (type === 'rematchStatus') {
      const status = String(message.status);
      if (status === 'offered' && Number(message.offeredBy) !== mySeat) {
        play.showRematchOffer(String(message.name ?? match.seats[otherSeat(mySeat)].name));
      }
      if (status === 'accepted' && typeof message.matchId === 'string') {
        navigate(`/match/${message.matchId}`);
      }
      if (status === 'expired') play.announce('Rematch offer expired.');
      return;
    }
    if (type === 'error') {
      play.showShotError(String(message.code));
    }
  });

  socket.onStatus((online) => {
    setPageStatus(online ? '' : 'Connection lost. Reconnecting...');
  });
  socket.open();

  onLeave(() => {
    socket.close();
    play.destroy();
  });

  clear(view);
  view.append(play.dom.root);
  play.focusBoard();
  if (match.status !== 'active' && match.status !== 'waiting') {
    play.openMatchOver(match, match.boardPointsLine);
  }
}
