import { Check, ChevronDown, ChevronUp, GripVertical, Hourglass } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { answerReceiptSchema, playerViewSchema, rejoinedSchema, type PlayerQuestion, type PlayerView, type Reveal, type StoredEvent } from "../../shared/schemas";
import { Status, TallyMark } from "../components";
import { ApiFailure, api } from "../lib/api";
import { forgetSeat, storedRejoinToken } from "../lib/seat";
import { keepClockSynced } from "../lib/serverClock";
import { useCountdown } from "../lib/useCountdown";
import { useRoomEvents, type Notice } from "../lib/useRoomEvents";
import { LETTERS } from "../stage/split";
import { playReducer, standingOf, stateCopy } from "./state";

const noticeCopy: Record<Notice, string> = {
  quiet: "",
  pending: "Reconnecting…",
  backup: "Backup link: live updates are down. Answers still count.",
  returned: "Back on the live link",
};
const LATE_SECONDS = 5;
const PAGE_STEPS = 10;

type Answer = { choice: number } | { estimate: number } | { order: string[] };
type Send = (answer: Answer, chosen?: number) => Promise<void>;

function Tiles({ question, disabled, chosen, send }: { question: Extract<PlayerQuestion, { type: "multiple_choice" }>; disabled: boolean; chosen: number | null; send: Send }) {
  return (
    <div className="choices">
      {question.options.map((option, index) => (
        <button
          key={index}
          type="button"
          className="choice"
          aria-label={`${LETTERS[index]}: ${option}`}
          aria-pressed={chosen === index}
          data-dim={chosen !== null && chosen !== index}
          disabled={disabled}
          onClick={() => void send({ choice: index }, index)}
        >
          <span className="choice-letter display" aria-hidden="true">
            {LETTERS[index]}
          </span>
          <TallyMark strokes={index + 1} />
          <span className="choice-text" aria-hidden="true">
            {option}
          </span>
          {chosen === index ? <Check className="choice-check" size={22} strokeWidth={2.5} aria-hidden="true" /> : <span />}
        </button>
      ))}
    </div>
  );
}

function EstimateControl({ question, disabled, send }: { question: Extract<PlayerQuestion, { type: "estimate" }>; disabled: boolean; send: Send }) {
  const { min, max, step, unit } = question;
  const [value, setValue] = useState(() => Math.min(max, Math.max(min, min + Math.round((max - min) / 2 / step) * step)));
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const moves: Record<string, number> = { PageUp: PAGE_STEPS * step, PageDown: -PAGE_STEPS * step };
    if (event.key in moves) {
      event.preventDefault();
      setValue((current) => clamp(current + (moves[event.key] as number)));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setValue(event.key === "Home" ? min : max);
    }
  };
  return (
    <div className="estimate">
      <p className="estimate-value display" aria-hidden="true">
        {value} {unit}
      </p>
      <input
        type="range"
        className="slider"
        aria-label="Your estimate"
        aria-valuetext={`${value} ${unit}`.trim()}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(Number(event.target.value))}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="button-primary lock" disabled={disabled} onClick={() => void send({ estimate: value })}>
        Lock in estimate
      </button>
    </div>
  );
}

function OrderControl({ question, disabled, send }: { question: Extract<PlayerQuestion, { type: "sequence" }>; disabled: boolean; send: Send }) {
  const [order, setOrder] = useState(() => question.items);
  const [focusTarget, setFocusTarget] = useState<{ id: string; direction: "up" | "down" } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    if (!focusTarget || !list.current) return;
    const index = order.findIndex((item) => item.id === focusTarget.id);
    const preferred = focusTarget.direction === "up" && index === 0 ? "down" : focusTarget.direction === "down" && index === order.length - 1 ? "up" : focusTarget.direction;
    list.current.querySelector<HTMLButtonElement>(`[data-item="${CSS.escape(focusTarget.id)}"][data-direction="${preferred}"]`)?.focus();
    setFocusTarget(null);
  }, [focusTarget, order]);

  const move = (id: string, direction: "up" | "down"): void => {
    setOrder((current) => {
      const from = current.findIndex((item) => item.id === id);
      const to = direction === "up" ? from - 1 : from + 1;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to] as (typeof next)[number], next[from] as (typeof next)[number]];
      return next;
    });
    setFocusTarget({ id, direction });
  };

  const drag = (event: PointerEvent<HTMLElement>): void => {
    if (!dragging || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>("li")];
    const target = rows.findIndex((row) => event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
    const to = target === -1 ? rows.length - 1 : target;
    setOrder((current) => {
      const from = current.findIndex((item) => item.id === dragging);
      if (from === to) return current;
      const next = [...current];
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked as (typeof next)[number]);
      return next;
    });
  };

  return (
    <div className="sequence">
      <ol ref={list} className="order" aria-label="Your order">
        {order.map((item, index) => (
          <li key={item.id} className="order-item" data-dragging={dragging === item.id}>
            <span
              className="grip"
              aria-hidden="true"
              onPointerDown={(event) => {
                if (disabled) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(item.id);
              }}
              onPointerMove={drag}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
            >
              <GripVertical size={20} strokeWidth={1.75} />
            </span>
            <span className="order-label">{item.label}</span>
            <button type="button" className="move" aria-label={`Move ${item.label} up`} data-item={item.id} data-direction="up" disabled={disabled || index === 0} onClick={() => move(item.id, "up")}>
              <ChevronUp size={22} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className="move" aria-label={`Move ${item.label} down`} data-item={item.id} data-direction="down" disabled={disabled || index === order.length - 1} onClick={() => move(item.id, "down")}>
              <ChevronDown size={22} strokeWidth={2} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="button-primary lock" disabled={disabled} onClick={() => void send({ order: order.map((item) => item.id) })}>
        Lock in order
      </button>
    </div>
  );
}

function RevealResult({ reveal, question, seatId }: { reveal: Reveal; question: PlayerQuestion | null; seatId: string }) {
  const mine = reveal.results.find((result) => result.seatId === seatId);
  const outcome = { correct: "Correct", partial: "Partly in order", wrong: "Not this time", none: "No answer" }[mine?.outcome ?? "none"];
  let right: string | null = null;
  if (reveal.type === "multiple_choice" && question?.type === "multiple_choice") right = `${LETTERS[reveal.correctIndex]}: ${question.options[reveal.correctIndex]}`;
  if (reveal.type === "estimate") right = `${reveal.answer} ± ${reveal.tolerance}`;
  return (
    <div className="result">
      <p className="result-outcome display">{outcome}</p>
      <p className="result-points display">+{mine?.points ?? 0} pts</p>
      {right ? (
        <p className="result-right">
          <Check size={18} strokeWidth={2} aria-hidden="true" /> Correct answer: {right}
        </p>
      ) : null}
    </div>
  );
}

export function Play() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(playReducer, null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [pictureFailed, setPictureFailed] = useState(false);

  useEffect(() => keepClockSynced(), []);

  const load = useCallback(
    async (client: string): Promise<void> => {
      try {
        dispatch({ type: "loaded", view: await api(`/api/rooms/${roomId}/state?clientId=${encodeURIComponent(client)}`, { schema: playerViewSchema }) });
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 409) dispatch({ type: "superseded" });
        if (error instanceof ApiFailure && error.status === 410) dispatch({ type: "gone" });
      }
    },
    [roomId],
  );

  useEffect(() => {
    const token = storedRejoinToken();
    if (!token) {
      navigate("/", { replace: true });
      return;
    }
    api("/api/rooms/rejoin", { method: "POST", body: { rejoinToken: token }, schema: rejoinedSchema }).then(
      async (seat) => {
        if (seat.roomId !== roomId) {
          navigate(`/play/${seat.roomId}`, { replace: true });
          return;
        }
        setClientId(seat.clientId);
        setNickname(seat.nickname);
        await load(seat.clientId);
      },
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 410) {
          forgetSeat();
          dispatch({ type: "gone" });
          return;
        }
        forgetSeat();
        navigate("/", { replace: true });
      },
    );
  }, [load, navigate, roomId]);

  const handlers = useMemo(
    () => ({
      onEvent: (event: StoredEvent) => {
        dispatch({ type: "event", event });
        if (event.type === "reveal" && clientRef.current) void load(clientRef.current);
      },
      onSuperseded: () => dispatch({ type: "superseded" }),
      onGone: () => dispatch({ type: "gone" }),
    }),
    [load],
  );
  const clientRef = useRef<string | null>(null);
  clientRef.current = clientId;
  const notice = useRoomEvents(roomId, clientId && state ? { clientId } : null, state?.view.lastEventId ?? null, handlers);

  const view: PlayerView | null = state?.view ?? null;
  const question = view?.question ?? null;
  const seconds = useCountdown(question?.deadlineAt ?? null, view?.state === "question_open");
  const send = useCallback<Send>(
    async (answer, chosen) => {
      if (!clientId || !view?.questionIndex) return;
      dispatch({ type: "status", text: "Sending…", answered: true, chosen: chosen ?? null });
      try {
        await api(`/api/rooms/${roomId}/answers`, { method: "POST", body: { clientId, questionIndex: view.questionIndex, ...answer }, schema: answerReceiptSchema });
        dispatch({ type: "status", text: "Locked in", answered: true });
      } catch (error) {
        const failure = error instanceof ApiFailure ? error : null;
        const code = failure?.body.error;
        if (code === "window_closed") {
          const remaining = failure?.body.remainingMs ?? 0;
          dispatch({ type: "locked" });
          dispatch({ type: "status", text: remaining < 0 ? `Too late — the server got it ${Math.abs(remaining)} ms after the bell.` : "Too late — the quizmaster locked this question.", answered: true });
        } else if (code === "question_not_open") {
          dispatch({ type: "status", text: "Too late — the quizmaster locked this question.", answered: true });
        } else if (code === "already_answered") {
          dispatch({ type: "status", text: "Already answered — your first answer stands.", answered: true });
        } else if (code === "client_superseded") {
          dispatch({ type: "superseded" });
        } else if (code === "room_ended") {
          dispatch({ type: "gone" });
        } else {
          dispatch({ type: "status", text: "Couldn't send that. Check your connection and try again.", answered: false, chosen: null });
        }
      }
    },
    [clientId, roomId, view?.questionIndex],
  );

  if (!state || !view) return <div className="play" aria-busy="true" />;

  const standing = standingOf(view);
  const controlsOff = state.answered || view.state !== "question_open" || state.superseded;
  const statusText = state.superseded ? stateCopy(state, nickname) : (state.override ?? stateCopy(state, nickname));
  const picture = question?.imageUrl && !pictureFailed ? question.imageUrl : null;
  const showQuestion = question !== null && (view.state === "question_open" || view.state === "locked");

  return (
    <div className="play">
      <div className="play-top">
        <section aria-label="Your standing" className="strip" tabIndex={0}>
          <span>Rank </span>
          <span className="display">{standing.rank}</span>
          <span> of </span>
          <span className="display">{state.seated}</span>
          <span> · </span>
          <span className="display">{standing.score}</span>
          <span> pts</span>
        </section>
        <Status name="Connection status" message={noticeCopy[notice]} tone={notice === "backup" ? "error" : notice === "pending" ? "pending" : notice === "returned" ? "success" : "idle"} />
        {question && (view.state === "question_open" || view.state === "locked" || view.state === "reveal") ? (
          <div className="echo-row">
            <section aria-label="Question echo" className="echo" tabIndex={0}>
              <p className="echo-kicker">
                Question {question.index} of {view.questionCount}
              </p>
              <p className="echo-prompt">{question.prompt}</p>
            </section>
            {picture ? <img className="echo-picture" src={picture} alt="" onError={() => setPictureFailed(true)} /> : question?.imageUrl ? <p className="echo-missing">Picture unavailable</p> : null}
          </div>
        ) : null}
        {showQuestion ? (
          <div role="timer" aria-label="Time left" className="timer display" data-late={view.state === "question_open" && seconds <= LATE_SECONDS}>
            {view.state === "locked" ? 0 : seconds}
          </div>
        ) : (
          <div className="hero" aria-hidden="true">
            {view.state === "lobby" ? (
              <p className="hero-name display">{nickname}</p>
            ) : (
              <>
                <p className="hero-rank display">{standing.rank}</p>
                <p className="hero-note">of {state.seated}</p>
              </>
            )}
          </div>
        )}
      </div>
      <div className="thumb-zone">
        <Status name="Answer status" message={statusText} tone={state.override?.startsWith("Too late") ? "late" : state.override === "Locked in" ? "success" : "idle"} />
        <div className="view" key={`${view.state}-${view.questionIndex}`}>
          {showQuestion && question.type === "multiple_choice" ? <Tiles question={question} disabled={controlsOff} chosen={state.chosen} send={send} /> : null}
          {showQuestion && question.type === "estimate" ? <EstimateControl key={question.index} question={question} disabled={controlsOff} send={send} /> : null}
          {showQuestion && question.type === "sequence" ? <OrderControl key={question.index} question={question} disabled={controlsOff} send={send} /> : null}
          {view.state === "reveal" && view.reveal ? <RevealResult reveal={view.reveal} question={question} seatId={view.you.seatId} /> : null}
          {view.state === "lobby" ? (
            <div className="waiting">
              <Hourglass size={64} strokeWidth={1} aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
