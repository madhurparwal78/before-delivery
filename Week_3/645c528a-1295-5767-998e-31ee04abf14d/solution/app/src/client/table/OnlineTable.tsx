import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TIERS, type Mode } from '../../shared/domain';
import type { BallSpots } from '../../shared/physics';
import { groupWord, legalFirstBall, type Group, type Rack, type Seat } from '../../shared/rules';
import { api, ApiFailure } from '../api';
import { subscribe } from '../live';
import { navigate } from '../router';
import type { Store } from '../store';
import { HeadingScreen } from '../ui';
import type { Replay, ResultView, TableModel } from './model';
import { FRAME_MS, receiptText } from './solo';
import { TableView } from './TableView';

interface TableBody {
  id: string;
  mode: Mode;
  tier: number;
  status: string;
  seats: { seat: Seat; playerId: string; displayName: string; group: Group | null; ballsLeft: number; connected: boolean }[];
  activeSeat: Seat;
  ballInHand: boolean;
  calledPocketRequired: boolean;
  shotClockSeconds: number | null;
  reconnectSeconds: number | null;
  pot: number;
  seatedHere: boolean;
  ruleBanner: string;
  balls: number[];
  result: Omit<ResultView, 'rematch'> & { coins: number } | null;
}

interface LiveView {
  body: TableBody;
  kind: 'stake' | 'private' | 'tournament';
  turn: string;
  spots: BallSpots;
  log: string[];
  receipt: { firstBall: number | null; cut: number } | null;
  frames: BallSpots[] | null;
  behindHeadString: boolean;
  aimBonus: number;
  cloth: string;
  groups: Record<Seat, Group | null>;
  rematchUrl: string | null;
  rematchAsked: boolean;
  inviteUrl: string | null;
}

function WaitingForFriend({ inviteUrl }: { inviteUrl: string }): ReactNode {
  const field = useRef<HTMLInputElement>(null);
  return (
    <div className="waiting">
      <p>Waiting for your friend</p>
      <div className="field">
        <label htmlFor="invite-link">Invite link</label>
        <input ref={field} id="invite-link" type="text" readOnly value={inviteUrl} />
      </div>
      <button type="button" onClick={() => {
        field.current?.select();
        void navigator.clipboard?.writeText(inviteUrl);
      }}>Copy link</button>
    </div>
  );
}

export function OnlineTable({ store, id }: { store: Store; id: string }): ReactNode {
  const [refusal, setRefusal] = useState('');
  const [view, setView] = useState<LiveView | null>(null);
  const [extraLog, setExtraLog] = useState<{ after: number; line: string }[]>([]);
  const [localBanner, setLocalBanner] = useState<string | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [rematchError, setRematchError] = useState('');
  const logLength = useRef(0);
  const shown = useRef<string>('');

  useEffect(() => {
    void api<TableBody>('GET', `/api/tables/${id}`).catch((error: ApiFailure) => {
      if (error.status === 404) setRefusal('Table not found');
      else if (error.status === 403) setRefusal(error.message);
    });
    return subscribe<LiveView>(`table:${id}`, (next) => {
      logLength.current = next.log.length;
      if (next.rematchUrl !== null) navigate(next.rematchUrl);
      setView(next);
      setLocalBanner((current) => (current !== null && next.body.ruleBanner !== shown.current ? null : current));
      shown.current = next.body.ruleBanner;
      if (next.frames !== null) setReplay({ id: Date.now(), frames: next.frames, frameMs: FRAME_MS });
    });
  }, [id]);

  const replayFinished = useCallback(() => setReplay(null), []);

  if (refusal !== '') return <HeadingScreen store={store} heading={refusal} />;
  if (view === null) return null;
  const { body } = view;
  if (body.status === 'expired') return <HeadingScreen store={store} heading="Expired" />;
  if (!body.seatedHere) return <HeadingScreen store={store} heading="You're in a match on another device" />;

  const viewer = body.seats.find((seat) => seat.playerId === store.me?.id);
  const viewerSeat = viewer?.seat ?? 1;
  const live = body.status === 'in_play';
  const entry = TIERS[body.tier - 1].entry;
  const rack: Rack = {
    mode: body.mode, phase: 'groups', groups: view.groups, balls: body.balls, activeSeat: body.activeSeat,
    ballInHand: body.ballInHand, behindHeadString: view.behindHeadString,
  };
  const rematchFunded = view.kind !== 'stake' || (body.result?.coins ?? 0) >= entry;
  const other = body.seats.find((seat) => seat !== viewer);
  const rematchLabel = view.kind === 'tournament' ? null
    : !rematchFunded ? 'Not enough Coins for a rematch.'
    : view.rematchAsked ? `Waiting for ${other?.displayName}.`
    : rematchError === '' ? null : rematchError;

  const result: ResultView | null = body.result === null ? null : {
    ...body.result,
    rematch: {
      label: rematchLabel,
      disabled: view.kind === 'tournament' || !rematchFunded || view.rematchAsked,
      onPress: () => {
        void api<{ tableUrl?: string }>('POST', `/api/tables/${id}/rematch`)
          .then((reply) => {
            if (reply.tableUrl !== undefined) navigate(reply.tableUrl);
          })
          .catch((error: ApiFailure) => setRematchError(error.message));
      },
    },
  };

  const dropped = body.seats.find((seat) => !seat.connected);
  const log: string[] = [];
  view.log.forEach((line, index) => {
    extraLog.filter(({ after }) => after === index).forEach((extra) => log.push(extra.line));
    log.push(line);
  });
  extraLog.filter(({ after }) => after >= view.log.length).forEach((extra) => log.push(extra.line));

  const model: TableModel = {
    seats: body.seats.map((seat) => ({
      name: seat.displayName,
      group: groupWord(seat.group),
      left: seat.ballsLeft,
      active: seat.seat === body.activeSeat && live,
    })),
    potText: view.kind === 'tournament' ? 'Pot Tournament' : view.kind === 'private' ? null : `Pot ${body.pot.toLocaleString('en-US')}`,
    turn: view.turn,
    banner: localBanner ?? body.ruleBanner,
    log,
    clock: body.shotClockSeconds,
    reconnect: dropped !== undefined && body.reconnectSeconds !== null ? `${dropped.displayName} dropped: ${body.reconnectSeconds}s to reconnect` : null,
    receipt: view.receipt === null ? '' : receiptText(view.receipt.firstBall, view.receipt.cut),
    spots: view.spots,
    replay,
    myShot: live && body.activeSeat === viewerSeat,
    turnKey: `${view.log.length}-${body.activeSeat}-${body.ballInHand}`,
    aimResetKey: id,
    ballInHand: body.ballInHand,
    behindHeadString: view.behindHeadString,
    calledPocketRequired: body.calledPocketRequired,
    guidelines: body.mode !== 'no-guidelines',
    aimBonus: view.aimBonus,
    cloth: view.cloth,
    tutorialStep: null,
    result,
    children: view.inviteUrl === null ? null : <WaitingForFriend inviteUrl={view.inviteUrl} />,
    legalFirst: (ball) => legalFirstBall(rack, viewerSeat, ball),
    shoot: async (strike) => {
      try {
        await api('POST', `/api/tables/${id}/shots`, strike);
      } catch (error) {
        model.announce((error as ApiFailure).message, false);
      }
    },
    place: async (across, along) => {
      try {
        await api('POST', `/api/tables/${id}/place`, { across, along });
        return null;
      } catch (error) {
        const failure = error as ApiFailure;
        return failure.errors.along ?? failure.message;
      }
    },
    announce: (line, inBanner) => {
      if (inBanner) setLocalBanner(line);
      setExtraLog((current) => [...current, { after: logLength.current, line }]);
    },
    replayFinished,
  };
  return <TableView store={store} model={model} />;
}
