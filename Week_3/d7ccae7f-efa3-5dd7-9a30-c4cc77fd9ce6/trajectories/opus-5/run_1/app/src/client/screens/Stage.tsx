import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  HostCommand,
  HostPlayer,
  HostRoom,
  PlayerQuestion,
  Reveal,
  RoomEvent,
  Standing,
} from '../../shared/protocol';
import { commandIsLegal } from '../../shared/transitions';
import { api } from '../lib/api';
import { OPTION_LETTERS, copy, tallyMark } from '../lib/copy';
import { useConnectionCopy } from '../lib/connection';
import { useRoomLink } from '../lib/roomLink';
import { Link } from '../lib/router';
import { stageClientId } from '../lib/seat';
import { useSecondsLeft } from '../lib/useCountdown';
import { StatusRegion } from '../components';
import type { PillarLabel, StageScene } from '../stage/scene';
import { correctOrderLabels, estimateAnswerLine, splitItems } from '../stage/split';

const LATE_SECONDS = 5;

const STEPS: { command: HostCommand; label: string; key: string }[] = [
  { command: 'open_question', label: 'Open question', key: 'O' },
  { command: 'lock', label: 'Lock', key: 'L' },
  { command: 'reveal', label: 'Reveal', key: 'R' },
  { command: 'show_leaderboard', label: 'Leaderboard', key: 'B' },
  { command: 'show_podium', label: 'Podium', key: 'P' },
  { command: 'end', label: 'End night', key: 'E' },
];

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Stage({ roomId }: { roomId: string }): JSX.Element {
  const [room, setRoom] = useState<HostRoom | null>(null);
  const [missing, setMissing] = useState(false);
  const [stageStatus, setStageStatus] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [labels, setLabels] = useState<PillarLabel[]>([]);
  const [poured, setPoured] = useState(false);
  const [stillMode, setStillMode] = useState(() => prefersReducedMotion());
  /** A still reveal shows its end state at once, so the marking is there from the start. */
  const marked = poured || stillMode;
  const [sceneReady, setSceneReady] = useState(0);
  const roomRef = useRef<HostRoom | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StageScene | null>(null);
  const endButtonRef = useRef<HTMLButtonElement>(null);
  const clientId = useMemo(() => stageClientId(roomId), [roomId]);

  const applyRoom = (next: HostRoom): void => {
    roomRef.current = next;
    setRoom(next);
  };

  const resync = useCallback(async (): Promise<number | null> => {
    const result = await api.get<{ room: HostRoom }>(`/api/rooms/${roomId}/host`);
    if (!result.ok) {
      setMissing(true);
      return null;
    }
    applyRoom(result.data.room);
    setPoured(result.data.room.state === 'reveal' || result.data.room.state === 'leaderboard');
    return result.data.room.lastEventId;
  }, [roomId]);

  const onEvent = useCallback((event: RoomEvent, replayed: boolean): void => {
    const current = roomRef.current;
    if (!current) return;
    const next: HostRoom = { ...current, lastEventId: event.id };
    if (event.type === 'presence') {
      const data = event.data as {
        seated: number;
        connected: number;
        players: { seatId: string; nickname: string; connected: boolean }[];
      };
      const scores = new Map(current.players.map((player) => [player.seatId, player]));
      next.seated = data.seated;
      next.connected = data.connected;
      next.players = data.players.map((player, index): HostPlayer => {
        const known = scores.get(player.seatId);
        return {
          seatId: player.seatId,
          nickname: player.nickname,
          score: known?.score ?? 0,
          rank: known?.rank ?? index + 1,
          connected: player.connected,
        };
      });
    } else if (event.type === 'player_joined') {
      next.seated = (event.data as { seated: number }).seated;
    } else if (event.type === 'answer_count') {
      const data = event.data as { answered: number; seated: number };
      next.answered = data.answered;
      next.seated = data.seated;
    } else if (event.type === 'question_open') {
      const question = event.data as PlayerQuestion;
      next.state = 'question_open';
      next.question = question;
      next.questionIndex = question.index;
      next.answered = 0;
      next.reveal = null;
      setPoured(false);
      setLabels([]);
      sceneRef.current?.clearReveal();
    } else if (event.type === 'locked') {
      next.state = 'locked';
    } else if (event.type === 'reveal') {
      next.state = 'reveal';
      next.reveal = event.data as Reveal;
      setPoured(replayed);
    } else if (event.type === 'leaderboard') {
      const data = event.data as { standings: Standing[] };
      next.state = 'leaderboard';
      next.standings = data.standings;
      next.players = withScores(current.players, data.standings);
    } else if (event.type === 'podium') {
      const data = event.data as { standings: Standing[] };
      next.state = 'podium';
      next.standings = data.standings;
      next.players = withScores(current.players, data.standings);
    } else if (event.type === 'ended') {
      next.state = 'ended';
      if ((event.data as { reason: string }).reason === 'idle') setStageStatus(copy.idleEnded);
    } else {
      return;
    }
    applyRoom(next);
  }, []);

  const transport = useRoomLink({
    roomId,
    query: `role=stage&clientId=${encodeURIComponent(clientId)}`,
    enabled: !missing,
    resync,
    onEvent,
    onSuperseded: () => undefined,
    onEnded: () => undefined,
    onLost: () => setMissing(true),
  });
  const connectionCopy = useConnectionCopy(transport);

  useEffect(() => {
    if (stillMode) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let built: StageScene | null = null;
    let dropped = false;
    const onResize = (): void => built?.resize();
    void import('../stage/scene').then(({ createStageScene }) => {
      if (dropped) return;
      built = createStageScene(canvas, setLabels, () => setPoured(true));
      if (!built) {
        setStillMode(true);
        return;
      }
      sceneRef.current = built;
      setSceneReady((count) => count + 1);
      window.addEventListener('resize', onResize);
    });
    return () => {
      dropped = true;
      window.removeEventListener('resize', onResize);
      built?.dispose();
      sceneRef.current = null;
    };
  }, [stillMode]);

  const state = room?.state ?? 'lobby';
  const reveal = room?.reveal ?? null;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if ((state === 'reveal' || state === 'leaderboard') && reveal) {
      scene.showReveal(
        {
          counts: revealCounts(reveal),
          correct: correctIndexes(reveal),
          band: reveal.type === 'estimate' ? reveal.inBandBins : [],
        },
        state === 'reveal' && !marked,
      );
    } else {
      scene.clearReveal();
    }
  }, [state, reveal, sceneReady]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (state === 'podium') scene.moveToPodium(true);
    else scene.moveToStage();
  }, [state, sceneReady]);

  const send = useCallback(
    async (command: HostCommand): Promise<void> => {
      const result = await api.post<{ room: HostRoom }>(`/api/rooms/${roomId}/commands`, {
        command,
      });
      if (!result.ok) {
        setStageStatus(
          result.failure.code === 'illegal_transition' || result.failure.code === 'no_more_questions'
            ? copy.stepUnavailable
            : copy.somethingWentWrong,
        );
        return;
      }
      const next = result.data.room;
      if (command === 'reveal') setPoured(false);
      applyRoom(next);
      setStageStatus(commandStatus(command, next.questionIndex ?? 0));
    },
    [roomId],
  );

  const position = useMemo(
    () => ({
      state,
      questionIndex: room?.questionIndex ?? null,
      questionCount: room?.questionCount ?? 0,
    }),
    [state, room?.questionIndex, room?.questionCount],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (dialogOpen) return;
      const step = STEPS.find((candidate) => candidate.key === event.key.toUpperCase());
      if (!step) return;
      if (!commandIsLegal(position, step.command)) return;
      event.preventDefault();
      if (step.command === 'end') setDialogOpen(true);
      else void send(step.command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, position, send]);

  const question = room?.question ?? null;
  const secondsLeft = useSecondsLeft(state === 'question_open' && question ? question.deadlineAt : null);

  if (missing) {
    return (
      <main className="page">
        <h1>That room is not available.</h1>
        <Link to="/host">Your decks</Link>
      </main>
    );
  }

  const split = reveal ? splitItems(reveal, question, { withShare: stillMode, marked }) : [];
  const answerLine = reveal ? estimateAnswerLine(reveal, question) : null;
  const orderLabels = reveal ? correctOrderLabels(reveal, question) : null;

  return (
    <div className="stage">
      {!stillMode && <canvas className="stage-canvas" ref={canvasRef} />}
      {!stillMode && (state === 'reveal' || state === 'leaderboard') && (
        <div className="pillar-labels" aria-hidden="true">
          {labels.map((label, index) => (
            <span
              className="pillar-label"
              key={index}
              style={{ left: `${label.x}px`, top: `${label.y}px`, color: label.correct && marked ? 'var(--brass)' : undefined }}
            >
              {label.count}
            </span>
          ))}
        </div>
      )}
      <div className="stage-overlay">
        {(state === 'question_open' || state === 'locked' || state === 'reveal') && question && (
          <section className="stage-band" role="region" aria-label="Question">
            <p className="stage-meta">{`Question ${question.index} of ${room?.questionCount ?? 0}`}</p>
            <h1 className="stage-prompt">{question.prompt}</h1>
            <StagePicture url={question.imageUrl} />
            <p className="stage-meta">
              <span>{`${room?.answered ?? 0} of ${room?.seated ?? 0} answered`}</span>
              {answerLine && <span>{answerLine}</span>}
            </p>
          </section>
        )}

        <div className="stage-body">
          {state === 'question_open' && (
            <div
              className={secondsLeft <= LATE_SECONDS ? 'stage-timer late' : 'stage-timer'}
              role="timer"
              aria-label="Time left"
            >
              {secondsLeft}
            </div>
          )}

          {state === 'lobby' && room && <Lobby room={room} />}

          {(state === 'question_open' || state === 'locked') && question && (
            <AnswerArea question={question} />
          )}

          {(state === 'reveal' || state === 'leaderboard') && reveal && (
            <>
              <ul className={stillMode ? 'split-list' : 'split-list'} aria-label="Answer split">
                {split.map((item, index) => (
                  <li className={item.correct && marked ? 'split-item correct' : 'split-item'} key={index}>
                    <span>{item.text}</span>
                    {stillMode && (
                      <span
                        className="bar"
                        style={{ width: `${barWidth(item.count, split.map((row) => row.count))}%` }}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {orderLabels && (
                <ul className="card-list" aria-label="Correct order">
                  {orderLabels.map((label, index) => (
                    <li className="chalk-card" key={index}>
                      {label}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {state === 'leaderboard' && room && (
            <ul className="ranked-list" aria-label="Leaderboard">
              {room.standings.slice(0, 10).map((entry) => (
                <li key={entry.seatId}>{`${entry.rank}. ${entry.nickname} — ${entry.score}`}</li>
              ))}
            </ul>
          )}

          {state === 'podium' && room && (
            <ul className="ranked-list podium-list" aria-label="Podium">
              {room.standings.slice(0, 3).map((entry) => (
                <li key={entry.seatId}>{`${entry.rank}. ${entry.nickname} — ${entry.score}`}</li>
              ))}
            </ul>
          )}

          {state === 'ended' && (
            <div className="lobby">
              <h1 className="stage-prompt">The night has ended.</h1>
              <p className="stage-meta">
                <Link to="/host/nights">Past nights</Link>
              </p>
            </div>
          )}
        </div>

        <div className="control-bar">
          {STEPS.map((step) => (
            <button
              key={step.command}
              className="button"
              type="button"
              ref={step.command === 'end' ? endButtonRef : undefined}
              aria-keyshortcuts={step.key}
              disabled={!commandIsLegal(position, step.command)}
              onClick={() => {
                if (step.command === 'end') setDialogOpen(true);
                else void send(step.command);
              }}
            >
              <span>{step.label}</span>
              <span className="key-cap" aria-hidden="true">
                {step.key}
              </span>
            </button>
          ))}
        </div>
        <div className="stage-statuses">
          <StatusRegion label="Stage status" text={stageStatus} />
          <StatusRegion label="Connection status" text={connectionCopy} />
        </div>
      </div>

      {dialogOpen && (
        <EndDialog
          onKeepGoing={() => {
            setDialogOpen(false);
            endButtonRef.current?.focus();
          }}
          onEnd={() => {
            setDialogOpen(false);
            endButtonRef.current?.focus();
            void send('end');
          }}
        />
      )}
    </div>
  );
}

function withScores(players: readonly HostPlayer[], standings: readonly Standing[]): HostPlayer[] {
  const byId = new Map(standings.map((entry) => [entry.seatId, entry]));
  return players.map((player) => {
    const entry = byId.get(player.seatId);
    return entry ? { ...player, score: entry.score, rank: entry.rank } : player;
  });
}

function revealCounts(reveal: Reveal): number[] {
  if (reveal.type === 'multiple_choice') return reveal.counts;
  if (reveal.type === 'estimate') return reveal.bins.map((bin) => bin.count);
  return reveal.buckets;
}

function correctIndexes(reveal: Reveal): number[] {
  if (reveal.type === 'multiple_choice') return [reveal.correctIndex];
  if (reveal.type === 'estimate') return reveal.inBandBins;
  return [reveal.buckets.length - 1];
}

function barWidth(count: number, counts: readonly number[]): number {
  const largest = Math.max(...counts, 0);
  return largest > 0 ? Math.max(2, (count / largest) * 100) : 2;
}

function commandStatus(command: HostCommand, questionIndex: number): string {
  if (command === 'open_question') return `Question ${questionIndex} open`;
  if (command === 'lock') return 'Locked';
  if (command === 'reveal') return 'Revealed';
  if (command === 'show_leaderboard') return 'Leaderboard';
  if (command === 'show_podium') return 'Podium';
  return 'Night ended';
}

function Lobby({ room }: { room: HostRoom }): JSX.Element {
  return (
    <div className="lobby">
      <section role="region" aria-label="Join details">
        <p className="lobby-pin">{room.pin}</p>
        <p className="stage-meta">
          <span>{`Join at ${window.location.origin}`}</span>
          <span>{`${room.connected} of ${room.seated} phones connected`}</span>
        </p>
      </section>
      <ul className="player-chips" aria-label="Players">
        {room.players.map((player) => (
          <li key={player.seatId}>{player.nickname}</li>
        ))}
      </ul>
    </div>
  );
}

function AnswerArea({ question }: { question: PlayerQuestion }): JSX.Element {
  if (question.type === 'multiple_choice') {
    return (
      <div className="tiles">
        {question.options.map((option, index) => {
          const letter = OPTION_LETTERS[index] ?? 'A';
          return (
            <div className="tile" key={index} role="group" aria-label={`${letter}: ${option}`}>
              <span className="tile-letter">{letter}</span>
              <span className="tile-tally" aria-hidden="true">
                {tallyMark(index)}
              </span>
              <span className="tile-text">{option}</span>
            </div>
          );
        })}
      </div>
    );
  }
  if (question.type === 'estimate') {
    return (
      <div className="band-estimate">
        {`Estimate between ${question.min} and ${question.max}${question.unit ? ` ${question.unit}` : ''}`}
      </div>
    );
  }
  return (
    <ul className="card-list" aria-label="Items to order">
      {question.items.map((item) => (
        <li className="chalk-card" key={item.id}>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function StagePicture({ url }: { url: string | null }): JSX.Element | null {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url) return null;
  if (failed) return <p className="stage-meta">{copy.pictureUnavailable}</p>;
  return (
    <img
      src={url}
      alt=""
      style={{ maxHeight: '18vh', maxWidth: '100%', objectFit: 'contain', margin: '0 auto' }}
      onError={() => setFailed(true)}
    />
  );
}

function EndDialog({
  onKeepGoing,
  onEnd,
}: {
  onKeepGoing: () => void;
  onEnd: () => void;
}): JSX.Element {
  const keepRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    <div className="dialog-scrim">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="End the night?"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onKeepGoing();
            return;
          }
          if (event.key !== 'Tab') return;
          const first = keepRef.current;
          const last = endRef.current;
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2>End the night?</h2>
        <p>{copy.endDialogBody}</p>
        <div className="dialog-actions">
          <button className="button" type="button" ref={keepRef} onClick={onKeepGoing}>
            Keep going
          </button>
          <button className="button button-primary" type="button" ref={endRef} onClick={onEnd}>
            End night
          </button>
        </div>
      </div>
    </div>
  );
}
