import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { copy } from '../../shared/copy.js';
import { needsRuns } from '../../shared/rules.js';
import type { DeliveryItem, Extra, MatchDetail, MatchSide, MatchState, ServerMessage, WicketBody } from '../../shared/wire.js';
import { Bands, Commentary, MatchLines, Scoreboard, ThisOver } from '../components/Board.js';
import { ChangeDialog, NextBowlerDialog, RetireDialog, StartInningsDialog, WicketDialog } from '../components/Dialogs.js';
import { Pad } from '../components/Pad.js';
import { FeedbackStrip, Loading, PageHeading } from '../components/ui.js';
import { announce, deliveryAnnouncement, raise } from '../lib/announce.js';
import { failureOf, get, request } from '../lib/api.js';
import { loadConfig } from '../lib/config.js';
import { actionOf, belongsToControl } from '../lib/keys.js';
import type { KeyAction } from '../lib/keys.js';
import { Link } from '../lib/router.js';
import { openSocket } from '../lib/socket.js';
import type { Socket } from '../lib/socket.js';
import { NotFound } from './NotFound.js';

type DialogState = { kind: 'wicket' } | { kind: 'bowler' } | { kind: 'retire' } | { kind: 'innings' } | { kind: 'change'; seq: number } | null;
interface Pen { penId: string | null; holder: string | null; known: boolean }
type Extras = Exclude<Extra, 'none'>;

const sideOf = (detail: MatchDetail, id: string): MatchSide => (detail.home.id === id ? detail.home : detail.away);

const refusalFor = (state: MatchState): string => {
  const status = state.match.status;
  if (status === 'ready') return copy.startInningsFirst;
  if (status === 'result' || status === 'tied') return copy.matchOver;
  return copy.inningsOver;
};

const inProgress = (state: MatchState): boolean => {
  const status = state.match.status;
  return status === 'innings_1' || status === 'innings_2' || status === 'super_over';
};

/** The newest scoring event of a state, which an undo would remove. */
const lastEvent = (state: MatchState): DeliveryItem | { retired: string } | null => {
  const item = state.commentary.find((candidate) => candidate.kind !== 'over-end');
  if (!item) return null;
  return item.kind === 'delivery' ? item : { retired: item.line.replace(/ retired hurt$/, '') };
};

export const ScorePage = ({ id }: { id: string }): JSX.Element => {
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [state, setState] = useState<MatchState | null>(null);
  const [failed, setFailed] = useState(false);
  const [pen, setPen] = useState<Pen>({ penId: null, holder: null, known: false });
  const [armed, setArmed] = useState<Extras | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [liveStatus, setLiveStatus] = useState('');

  const latest = useRef<MatchState | null>(null);
  const penRef = useRef(pen);
  penRef.current = pen;
  const queue = useRef<(() => Promise<void>)[]>([]);
  const draining = useRef(false);
  const socket = useRef<Socket | null>(null);
  const armedRef = useRef<Extras | null>(null);

  const show = (next: MatchState): void => {
    latest.current = next;
    setState(next);
  };
  const arm = (extra: Extras | null): void => {
    armedRef.current = extra;
    setArmed(extra);
  };
  const holds = (): string | null => penRef.current.penId;

  const refresh = async (): Promise<void> => {
    const [fresh, info] = await Promise.all([get<MatchState>(`/api/matches/${id}/state`), get<MatchDetail>(`/api/matches/${id}`)]);
    show(fresh);
    setDetail(info);
  };

  /** One scoring call with the pen. Resolves to the new state, or the refusal sentence (which is also raised). */
  const send = async (method: string, path: string, body?: Record<string, unknown>): Promise<MatchState | string> => {
    try {
      const next = await request<MatchState>(method, `/api/matches/${id}${path}`, body, { 'X-Pen': holds() ?? '' });
      show(next);
      setDialog(next.next_bowler_needed ? { kind: 'bowler' } : null);
      return next;
    } catch (error) {
      const failure = failureOf(error);
      raise(failure.message);
      if (failure.code === 'STALE_DELIVERY') await refresh().catch(() => undefined);
      if (failure.code === 'PEN_HELD') setPen({ penId: null, holder: failure.holder ?? null, known: true });
      if (failure.code === 'NEEDS_BOWLER') setDialog({ kind: 'bowler' });
      return failure.message;
    }
  };

  const drain = async (): Promise<void> => {
    draining.current = true;
    setBusy(true);
    for (let job = queue.current.shift(); job; job = queue.current.shift()) await job();
    draining.current = false;
    setBusy(false);
  };
  const enqueue = (job: () => Promise<void>): void => {
    queue.current.push(job);
    if (!draining.current) void drain();
  };

  const deliver = async (extra: Extra, runs: number, wicket: WicketBody | null): Promise<string | null> => {
    const current = latest.current;
    if (!current) return null;
    const result = await send('POST', '/deliveries', { expected_seq: current.last_seq + 1, extra, runs, wicket });
    if (typeof result === 'string') {
      queue.current = [];
      return result;
    }
    announce(deliveryAnnouncement(result));
    return null;
  };

  const undo = async (): Promise<void> => {
    const before = latest.current;
    const undone = before ? lastEvent(before) : null;
    setUndoing(true);
    const result = await send('DELETE', '/deliveries/last');
    setUndoing(false);
    if (typeof result === 'string') return;
    announce(undone === null ? '' : 'retired' in undone ? copy.undidRetirement(undone.retired) : copy.undidDelivery(undone.seq));
  };

  /** Whether a scoring key may act now; when it may not, says why and opens the Next bowler dialog if that is the reason. */
  const ready = (): boolean => {
    const current = latest.current;
    if (!current) return false;
    if (!inProgress(current)) {
      raise(refusalFor(current));
      return false;
    }
    if (current.next_bowler_needed) {
      raise(copy.chooseBowlerFirst);
      setDialog({ kind: 'bowler' });
      return false;
    }
    return true;
  };

  const press = (action: KeyAction): void => {
    if (action.type === 'escape') return arm(null);
    if (holds() === null) return;
    if (action.type === 'undo') {
      enqueue(undo);
    } else if (action.type === 'retire') {
      const current = latest.current;
      if (current && !inProgress(current)) raise(refusalFor(current)); else setDialog({ kind: 'retire' });
    } else if (action.type === 'wicket') {
      if (ready()) setDialog({ kind: 'wicket' });
    } else if (action.type === 'extra') {
      if (ready()) arm(armedRef.current === action.extra ? null : action.extra);
    } else if (ready()) {
      const extra = armedRef.current ?? 'none';
      if (needsRuns(extra) && action.value < 1) return raise(copy.byesNeedRuns);
      arm(null);
      enqueue(async () => { await deliver(extra, action.value, null); });
    }
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  useLayoutEffect(() => {
    let current = true;
    Promise.all([loadConfig(), get<MatchDetail>(`/api/matches/${id}`), get<MatchState>(`/api/matches/${id}/state`)]).then(([, info, first]) => {
      if (!current) return;
      setDetail(info);
      show(first);
      socket.current = openSocket((sendMessage) => sendMessage({ type: 'score', match: id }), (message: ServerMessage) => {
        if (message.type === 'pen') {
          setPen({ penId: message.pen, holder: message.holder, known: true });
          if (message.pen !== null) refresh().catch(() => undefined);
        } else if (message.type === 'live') {
          setLiveStatus(copy.liveOutageScoring);
        } else if (message.type === 'state' && holds() === null) {
          show(message.state);
          const { kind, seq } = message.event;
          if (kind === 'delivery' || kind === 'retirement') announce(deliveryAnnouncement(message.state));
          else if (kind === 'change') announce(copy.viewerChange(seq));
          else if (kind === 'undo') announce(copy.viewerUndo(seq));
        }
      });
    }, () => { if (current) setFailed(true); });
    const onKey = (event: KeyboardEvent): void => {
      const action = actionOf(event);
      if (!action || belongsToControl(event.target)) return;
      event.preventDefault();
      pressRef.current(action);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      current = false;
      document.removeEventListener('keydown', onKey);
      socket.current?.close();
    };
  }, [id]);

  const status = state?.match.status;
  useLayoutEffect(() => {
    if (status) get<MatchDetail>(`/api/matches/${id}`).then(setDetail, () => undefined);
  }, [status]);

  const penId = pen.penId;
  const loaded = state !== null;
  useLayoutEffect(() => {
    if (penId !== null && latest.current?.next_bowler_needed) setDialog((open) => open ?? { kind: 'bowler' });
  }, [penId, loaded]);

  if (failed) return <NotFound />;
  if (!state || !detail) return <Loading />;

  const holdsPen = pen.penId !== null;
  const scoring = holdsPen && inProgress(state);
  const fielding = sideOf(detail, state.bowling_team.id).xi;
  const penNotice = holdsPen ? '' : pen.holder ? copy.penHeld(pen.holder) : pen.known ? copy.penFree : '';
  const startLabel = status === 'ready' ? 'Start first innings' : status === 'innings_break' ? 'Start second innings' : status === 'super_over_break' ? 'Start super over' : null;
  const changing = dialog?.kind === 'change' ? state.commentary.find((item): item is DeliveryItem => item.kind === 'delivery' && item.seq === dialog.seq) : undefined;
  const closeDialog = (): void => setDialog(null);
  const upcoming = detail.next_innings;

  const refuse = async (result: Promise<MatchState | string>, after?: (next: MatchState) => void): Promise<string | null> => {
    const outcome = await result;
    if (typeof outcome === 'string') return outcome;
    after?.(outcome);
    return null;
  };

  return (
    <div class="scoring">
      <div class="scoring-top">
        <PageHeading>{state.match.title}</PageHeading>
        <Scoreboard state={state} />
        <MatchLines state={state} />
        <ThisOver state={state} />
        <div id="live-status" class="live-status" role="status">{liveStatus}</div>
        <Bands state={state} />
        {startLabel && upcoming ? (
          <p class="start-row"><button type="button" class="button" disabled={!holdsPen} onClick={() => setDialog({ kind: 'innings' })}>{startLabel}</button></p>
        ) : null}
      </div>
      <div class="scoring-side">
        <div id="pen-notice" class="pen-notice" role="status">{penNotice}</div>
        {pen.known && !holdsPen && pen.holder === null ? (
          <button type="button" class="button" onClick={() => socket.current?.send({ type: 'take-pen', match: id })}>Take the pen</button>
        ) : null}
        <Pad
          scoring={scoring} undo={holdsPen && !undoing} busy={busy} armed={armed}
          onDigit={(value) => press({ type: 'digit', value })} onExtra={(extra) => press({ type: 'extra', extra })}
          onWicket={() => press({ type: 'wicket' })} onUndo={() => press({ type: 'undo' })}
        />
        <button type="button" class="button retire-button" disabled={!scoring} onClick={() => press({ type: 'retire' })}>
          Retire batter<span class="hint" aria-hidden="true">R</span>
        </button>
        <FeedbackStrip />
      </div>
      <div class="scoring-feed">
        <Commentary items={state.commentary} change={{ enabled: holdsPen, open: (seq) => setDialog({ kind: 'change', seq }) }} />
        <p class="scorecard-link"><Link href={`/matches/${id}/scorecard`}>Scorecard</Link></p>
      </div>
      {dialog?.kind === 'wicket' ? (
        <WicketDialog
          state={state} fielding={fielding} armed={armed} onClose={closeDialog}
          onSubmit={(choice) => refuse(send('POST', '/deliveries', { expected_seq: (latest.current?.last_seq ?? 0) + 1, ...choice }), (next) => { arm(null); announce(deliveryAnnouncement(next)); })}
        />
      ) : null}
      {dialog?.kind === 'bowler' ? (
        <NextBowlerDialog state={state} fielding={fielding} onClose={closeDialog} onSubmit={(bowler) => refuse(send('POST', '/overs', { bowler }))} />
      ) : null}
      {dialog?.kind === 'retire' ? (
        <RetireDialog state={state} onClose={closeDialog} onSubmit={(choice) => refuse(send('POST', '/retirements', choice), (next) => announce(deliveryAnnouncement(next)))} />
      ) : null}
      {dialog?.kind === 'innings' && upcoming ? (
        <StartInningsDialog
          state={state} batting={sideOf(detail, upcoming.batting_team).xi} fielding={sideOf(detail, upcoming.bowling_team).xi} onClose={closeDialog}
          onSubmit={(choice) => refuse(send('POST', '/innings', choice))}
        />
      ) : null}
      {changing ? (
        <ChangeDialog
          item={changing} onClose={closeDialog}
          onSubmit={(choice) => refuse(send('PUT', `/deliveries/${changing.seq}`, choice), () => announce(copy.deliveryChanged(changing.seq)))}
        />
      ) : null}
    </div>
  );
};

