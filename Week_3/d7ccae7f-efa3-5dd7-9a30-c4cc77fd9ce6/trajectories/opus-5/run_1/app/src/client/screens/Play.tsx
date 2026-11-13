import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  AnswerAccepted,
  PlayerQuestion,
  PlayerView,
  RejoinResult,
  RoomEvent,
  SequenceItem,
} from '../../shared/protocol';
import { api } from '../lib/api';
import { OPTION_LETTERS, answerFailureMessage, copy, tallyMark } from '../lib/copy';
import { useConnectionCopy } from '../lib/connection';
import { useRoomLink } from '../lib/roomLink';
import { useRouter } from '../lib/router';
import { forgetRejoinToken, storedRejoinToken } from '../lib/seat';
import { useSecondsLeft } from '../lib/useCountdown';
import { StatusRegion } from '../components';

type Phase = 'loading' | 'seated' | 'superseded' | 'ended';

const LATE_SECONDS = 5;

export function Play({ roomId }: { roomId: string }): JSX.Element {
  const { navigate } = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [clientId, setClientId] = useState('');
  const [view, setView] = useState<PlayerView | null>(null);
  const [seated, setSeated] = useState(0);
  const [answerStatus, setAnswerStatus] = useState('');
  const [late, setLate] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const clientRef = useRef('');

  const setViewState = (next: PlayerView): void => {
    viewRef.current = next;
    setView(next);
    setSeated(next.standings.length);
  };

  useEffect(() => {
    const token = storedRejoinToken(roomId);
    if (!token) {
      navigate('/', true);
      return;
    }
    void (async () => {
      const rejoin = await api.post<RejoinResult>('/api/rooms/rejoin', { rejoinToken: token });
      if (!rejoin.ok) {
        if (rejoin.failure.code === 'room_ended') {
          setPhase('ended');
          setAnswerStatus(copy.roomEnded);
          return;
        }
        forgetRejoinToken(roomId);
        navigate('/', true);
        return;
      }
      clientRef.current = rejoin.data.clientId;
      setClientId(rejoin.data.clientId);
      setPhase('seated');
    })();
  }, [roomId, navigate]);

  const resync = useCallback(async (): Promise<number | null> => {
    const result = await api.get<PlayerView>(
      `/api/rooms/${roomId}/state?clientId=${encodeURIComponent(clientRef.current)}`,
    );
    if (!result.ok) {
      if (result.failure.code === 'room_ended') {
        setPhase('ended');
        setAnswerStatus(copy.roomEnded);
      } else if (result.failure.code === 'client_superseded') {
        setPhase('superseded');
        setAnswerStatus(copy.clientSuperseded);
      }
      return null;
    }
    setViewState(result.data);
    setAnswered(result.data.you.answeredCurrent);
    if (result.data.state === 'lobby') {
      setAnswerStatus(`You're in, ${result.data.you.nickname}. Watch the big screen.`);
    }
    return result.data.lastEventId;
  }, [roomId]);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await api.get<PlayerView>(
      `/api/rooms/${roomId}/state?clientId=${encodeURIComponent(clientRef.current)}`,
    );
    if (!result.ok) return;
    const current = viewRef.current;
    if (current && result.data.lastEventId < current.lastEventId) return;
    setViewState({ ...result.data, state: current ? current.state : result.data.state });
  }, [roomId]);

  const onEvent = useCallback(
    (event: RoomEvent): void => {
      const current = viewRef.current;
      if (!current) return;
      const next: PlayerView = { ...current, lastEventId: event.id };
      if (event.type === 'player_joined' || event.type === 'presence') {
        const data = event.data as { seated: number };
        setSeated(data.seated);
        viewRef.current = next;
        setView(next);
        return;
      }
      if (event.type === 'question_open') {
        const question = event.data as PlayerQuestion;
        next.state = 'question_open';
        next.question = question;
        next.questionIndex = question.index;
        next.reveal = null;
        next.you = { ...next.you, answeredCurrent: false };
        setAnswered(false);
        setChosen(null);
        setLate(false);
        setAnswerStatus(`Question ${question.index} is open`);
      } else if (event.type === 'locked') {
        next.state = 'locked';
        setAnswerStatus(copy.timesUp);
        setLate(false);
      } else if (event.type === 'reveal') {
        next.state = 'reveal';
        next.reveal = event.data as PlayerView['reveal'];
        setAnswerStatus(copy.answersAreIn);
        setLate(false);
        void refresh();
      } else if (event.type === 'leaderboard') {
        const data = event.data as { standings: PlayerView['standings'] };
        next.state = 'leaderboard';
        next.standings = data.standings;
        const mine = data.standings.find((entry) => entry.seatId === next.you.seatId);
        if (mine) {
          next.you = { ...next.you, rank: mine.rank, score: mine.score, streak: mine.streak };
        }
        setSeated(data.standings.length);
        setAnswerStatus(copy.leaderboardOnScreen);
      } else if (event.type === 'podium') {
        const data = event.data as { standings: PlayerView['standings'] };
        next.state = 'podium';
        next.standings = data.standings;
        setAnswerStatus(copy.podiumTime);
      } else if (event.type === 'ended') {
        next.state = 'ended';
        setPhase('ended');
        setAnswerStatus(copy.roomEnded);
      } else {
        return;
      }
      viewRef.current = next;
      setView(next);
    },
    [refresh],
  );

  const transport = useRoomLink({
    roomId,
    query: `clientId=${encodeURIComponent(clientId)}`,
    enabled: phase === 'seated' && clientId.length > 0,
    resync,
    onEvent,
    onSuperseded: () => {
      setPhase('superseded');
      setAnswerStatus(copy.clientSuperseded);
    },
    onEnded: () => {
      setPhase('ended');
      setAnswerStatus(copy.roomEnded);
    },
    onLost: () => {
      forgetRejoinToken(roomId);
      navigate('/', true);
    },
  });
  const connectionCopy = useConnectionCopy(transport);

  const sendAnswer = async (body: Record<string, unknown>): Promise<void> => {
    const current = viewRef.current;
    if (!current || current.questionIndex === null) return;
    setAnswerStatus(copy.sending);
    setLate(false);
    const result = await api.post<{ answer: AnswerAccepted }>(`/api/rooms/${roomId}/answers`, {
      clientId: clientRef.current,
      questionIndex: current.questionIndex,
      ...body,
    });
    if (result.ok) {
      setAnswered(true);
      setAnswerStatus(copy.lockedIn);
      return;
    }
    const message = answerFailureMessage(result.failure);
    setAnswerStatus(message);
    setLate(result.failure.code === 'window_closed');
    if (result.failure.code === 'window_closed') {
      const next = { ...current, state: 'locked' as const };
      viewRef.current = next;
      setView(next);
    }
    if (result.failure.code === 'already_answered') setAnswered(true);
    if (result.failure.code === 'client_superseded') setPhase('superseded');
    if (result.failure.code === 'room_ended') setPhase('ended');
  };

  const question = view?.question ?? null;
  const secondsLeft = useSecondsLeft(
    view?.state === 'question_open' && question ? question.deadlineAt : null,
  );
  const standing = view
    ? `Rank ${view.you.rank} of ${Math.max(seated, 1)} · ${view.you.score} pts`
    : 'Rank 0 of 0 · 0 pts';

  return (
    <main className="play">
      <div className="play-top">
        <div className="standing-strip" role="region" aria-label="Your standing" tabIndex={0}>
          {standing}
        </div>
        <div className="echo" role="region" aria-label="Question echo" tabIndex={0}>
          {question && <QuestionThumb url={question.imageUrl} />}
          <div className="echo-text">
            <p className="echo-counter">
              {question ? `Question ${question.index} of ${view?.questionCount ?? 0}` : ''}
            </p>
            <p className="echo-prompt">{question ? question.prompt : lobbyHeadline(phase, view)}</p>
          </div>
        </div>
        {view?.state === 'question_open' && question && (
          <div
            className={secondsLeft <= LATE_SECONDS ? 'play-timer late' : 'play-timer'}
            role="timer"
            aria-label="Time left"
          >
            {secondsLeft}
          </div>
        )}
        <StatusRegion label="Answer status" text={answerStatus} late={late} />
        <StatusRegion label="Connection status" text={connectionCopy} />
      </div>
      <div className="play-answers play-fade" key={view?.state ?? phase}>
        {phase === 'seated' && view?.state === 'question_open' && question ? (
          <AnswerControls
            question={question}
            answered={answered}
            chosen={chosen}
            onChoose={(index) => {
              setChosen(index);
              void sendAnswer({ choice: index });
            }}
            onEstimate={(value) => void sendAnswer({ estimate: value })}
            onOrder={(order) => void sendAnswer({ order })}
          />
        ) : (
          <p className="play-note">{restingNote(phase, view)}</p>
        )}
      </div>
    </main>
  );
}

function lobbyHeadline(phase: Phase, view: PlayerView | null): string {
  if (phase === 'superseded') return copy.clientSuperseded;
  if (phase === 'ended' || view?.state === 'ended') return copy.roomEnded;
  return 'Watch the big screen.';
}

function restingNote(phase: Phase, view: PlayerView | null): string {
  if (phase === 'superseded') return copy.clientSuperseded;
  if (phase === 'ended' || view?.state === 'ended') return copy.roomEnded;
  if (!view) return '';
  if (view.state === 'locked') return copy.timesUp;
  if (view.state === 'reveal') return copy.answersAreIn;
  if (view.state === 'leaderboard') return copy.leaderboardOnScreen;
  if (view.state === 'podium') return copy.podiumTime;
  return 'In and waiting. Watch the big screen.';
}

function QuestionThumb({ url }: { url: string | null }): JSX.Element | null {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url) return null;
  if (failed) return <p className="echo-counter">{copy.pictureUnavailable}</p>;
  return <img className="echo-thumb" src={url} alt="" onError={() => setFailed(true)} />;
}

function AnswerControls({
  question,
  answered,
  chosen,
  onChoose,
  onEstimate,
  onOrder,
}: {
  question: PlayerQuestion;
  answered: boolean;
  chosen: number | null;
  onChoose: (index: number) => void;
  onEstimate: (value: number) => void;
  onOrder: (order: string[]) => void;
}): JSX.Element {
  if (question.type === 'multiple_choice') {
    return (
      <>
        {question.options.map((option, index) => {
          const letter = OPTION_LETTERS[index] ?? 'A';
          const dimmed = chosen !== null && chosen !== index;
          return (
            <button
              key={index}
              type="button"
              className={`option-button${chosen === index ? ' chosen' : ''}${dimmed ? ' dimmed' : ''}`}
              disabled={answered || chosen !== null}
              aria-label={`${letter}: ${option}`}
              onClick={() => onChoose(index)}
            >
              <span className="tile-letter">{letter}</span>
              <span className="tile-tally" aria-hidden="true">
                {tallyMark(index)}
              </span>
              <span className="tile-text">{option}</span>
            </button>
          );
        })}
      </>
    );
  }
  if (question.type === 'estimate') {
    return <EstimateControls question={question} answered={answered} onEstimate={onEstimate} />;
  }
  return <OrderControls items={question.items} answered={answered} onOrder={onOrder} />;
}

function EstimateControls({
  question,
  answered,
  onEstimate,
}: {
  question: Extract<PlayerQuestion, { type: 'estimate' }>;
  answered: boolean;
  onEstimate: (value: number) => void;
}): JSX.Element {
  const [value, setValue] = useState(() =>
    Math.round((question.min + question.max) / 2 / question.step) * question.step,
  );
  useEffect(() => {
    setValue(Math.round((question.min + question.max) / 2 / question.step) * question.step);
  }, [question.index, question.min, question.max, question.step]);

  return (
    <div className="slider-row">
      <p className="slider-value">{`${value}${question.unit ? ` ${question.unit}` : ''}`}</p>
      <input
        type="range"
        aria-label="Your estimate"
        min={question.min}
        max={question.max}
        step={question.step}
        value={value}
        disabled={answered}
        aria-valuetext={`${value}${question.unit ? ` ${question.unit}` : ''}`}
        onChange={(event) => setValue(Number(event.target.value))}
      />
      <button
        className="lock-button"
        type="button"
        disabled={answered}
        onClick={() => onEstimate(value)}
      >
        Lock in estimate
      </button>
    </div>
  );
}

function OrderControls({
  items,
  answered,
  onOrder,
}: {
  items: SequenceItem[];
  answered: boolean;
  onOrder: (order: string[]) => void;
}): JSX.Element {
  const [order, setOrder] = useState<SequenceItem[]>(items);
  const [dragId, setDragId] = useState<string | null>(null);
  const focusTarget = useRef<{ id: string; direction: 'up' | 'down' } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setOrder(items), [items]);

  useLayoutEffect(() => {
    const target = focusTarget.current;
    if (!target || !listRef.current) return;
    focusTarget.current = null;
    const primary = listRef.current.querySelector<HTMLButtonElement>(
      `[data-move="${target.id}-${target.direction}"]`,
    );
    const other = listRef.current.querySelector<HTMLButtonElement>(
      `[data-move="${target.id}-${target.direction === 'up' ? 'down' : 'up'}"]`,
    );
    if (primary && !primary.disabled) primary.focus();
    else other?.focus();
  }, [order]);

  const move = (index: number, direction: 'up' | 'down'): void => {
    const to = direction === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const moved = next[index] as SequenceItem;
    next[index] = next[to] as SequenceItem;
    next[to] = moved;
    focusTarget.current = { id: moved.id, direction };
    setOrder(next);
  };

  const dragTo = (fromId: string, clientY: number): void => {
    if (!listRef.current) return;
    const rows = Array.from(listRef.current.querySelectorAll('li'));
    const fromIndex = order.findIndex((item) => item.id === fromId);
    if (fromIndex < 0) return;
    const target = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return clientY >= box.top && clientY <= box.bottom;
    });
    if (target < 0 || target === fromIndex) return;
    const next = [...order];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(target, 0, moved as SequenceItem);
    setOrder(next);
  };

  return (
    <>
      <ul className="order-list" aria-label="Your order" ref={listRef}>
        {order.map((item, index) => (
          <li
            className={`order-item${dragId === item.id ? ' dragging' : ''}`}
            key={item.id}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest('button')) return;
              if (answered) return;
              setDragId(item.id);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (dragId !== item.id) return;
              dragTo(item.id, event.clientY);
            }}
            onPointerUp={() => setDragId(null)}
            onPointerCancel={() => setDragId(null)}
          >
            <span className="order-label">{item.label}</span>
            <button
              className="move-button"
              type="button"
              data-move={`${item.id}-up`}
              aria-label={`Move ${item.label} up`}
              disabled={answered || index === 0}
              onClick={() => move(index, 'up')}
            >
              ↑
            </button>
            <button
              className="move-button"
              type="button"
              data-move={`${item.id}-down`}
              aria-label={`Move ${item.label} down`}
              disabled={answered || index === order.length - 1}
              onClick={() => move(index, 'down')}
            >
              ↓
            </button>
          </li>
        ))}
      </ul>
      <button
        className="lock-button"
        type="button"
        disabled={answered}
        onClick={() => onOrder(order.map((item) => item.id))}
      >
        Lock in order
      </button>
    </>
  );
}
