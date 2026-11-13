import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type RefObject } from "react";
import { GlassWater } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { resolveCommand, showsQuestion } from "../../shared/machine";
import { hostCommands, hostRoomSchema, type HostCommand, type HostRoom, type PlayerQuestion, type StoredEvent } from "../../shared/schemas";
import { Status, TallyMark } from "../components";
import { ApiFailure, api } from "../lib/api";
import { keepClockSynced } from "../lib/serverClock";
import { useCountdown } from "../lib/useCountdown";
import { useRoomEvents, type Delivery, type Notice } from "../lib/useRoomEvents";
import { EndNightDialog } from "./EndNightDialog";
import { StageRoom } from "./scene/room3d";
import { LETTERS, share, splitItems } from "./split";
import { stageReducer, stageStatus } from "./state";

const roomReply = z.object({ room: hostRoomSchema });

const stepLabels: Record<HostCommand, { label: string; key: string }> = {
  open_question: { label: "Open question", key: "O" },
  lock: { label: "Lock", key: "L" },
  reveal: { label: "Reveal", key: "R" },
  show_leaderboard: { label: "Leaderboard", key: "B" },
  show_podium: { label: "Podium", key: "P" },
  end: { label: "End night", key: "E" },
};
const commandByKey = new Map(hostCommands.map((command) => [stepLabels[command].key.toLowerCase(), command]));

const noticeCopy: Record<Notice, string> = {
  quiet: "",
  pending: "Reconnecting…",
  backup: "Backup link: live updates are down. Answers still count.",
  returned: "Back on the live link",
};

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function QuestionBand({ room, question, showAnswer, bandRef }: { room: HostRoom; question: PlayerQuestion; showAnswer: boolean; bandRef: RefObject<HTMLElement | null> }) {
  const [pictureFailed, setPictureFailed] = useState(false);
  const long = question.prompt.length > 120;
  const reveal = room.reveal;
  return (
    <section ref={bandRef} aria-label="Question" className="band">
      <div className="band-text">
        <p className="kicker">
          Question {question.index} of {room.questionCount}
        </p>
        <p className={`prompt display${long ? " prompt-long" : ""}`}>{question.prompt}</p>
        <p className="answered">
          {room.answered} of {room.seated} answered
        </p>
        {showAnswer && reveal?.type === "estimate" && question.type === "estimate" ? (
          <p className="answer-line">
            Answer: {reveal.answer} {question.unit} ± {reveal.tolerance}
          </p>
        ) : null}
      </div>
      {question.imageUrl ? (
        pictureFailed ? (
          <p className="picture-missing">Picture unavailable</p>
        ) : (
          <img className="band-picture" src={question.imageUrl} alt="" onError={() => setPictureFailed(true)} />
        )
      ) : null}
    </section>
  );
}

function AnswerArea({ question }: { question: PlayerQuestion }) {
  if (question.type === "multiple_choice") {
    return (
      <ul className="tiles" aria-label="Answer options" data-count={question.options.length}>
        {question.options.map((option, index) => (
          <li key={index} className="tile" aria-label={`${LETTERS[index]}: ${option}`}>
            <span className="tile-letter display" aria-hidden="true">
              {LETTERS[index]}
            </span>
            <TallyMark strokes={index + 1} />
            <span className="tile-text" aria-hidden="true">
              {option}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (question.type === "estimate") {
    return <p className="estimate-band display">{`Estimate between ${question.min} and ${question.max} ${question.unit}`.trim()}</p>;
  }
  return (
    <ul className="items-cards" aria-label="Items to order">
      {question.items.map((item) => (
        <li key={item.id} className="item-card">
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function AnswerSplit({ room, question, values, settled, still, listRef }: { room: HostRoom; question: PlayerQuestion; values: number[]; settled: boolean; still: boolean; listRef: RefObject<HTMLUListElement | null> }) {
  const items = room.reveal ? splitItems(question, room.reveal) : [];
  const shown = still ? items.map((item) => item.count) : values;
  const total = shown.reduce((sum, count) => sum + count, 0);
  const marked = still || settled;
  return (
    <ul ref={listRef} className={`split${still ? " split-still" : ""}`} aria-label="Answer split" style={{ gridTemplateColumns: still ? undefined : `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item, index) => {
        const count = shown[index] ?? 0;
        return (
          <li key={index} className="split-item" data-correct={marked && item.correct} style={{ "--share": `${total === 0 ? 0 : (count / total) * 100}%` } as CSSProperties}>
            {item.label} — {count}
            {still ? ` (${share(count, total)}%)` : ""}
            {marked && item.correct ? (
              <span className="mark">
                {" "}
                <span className="check">✓</span> Correct answer
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Standings({ name, standings, limit }: { name: string; standings: HostRoom["standings"]; limit: number }) {
  return (
    <ul className="board" aria-label={name}>
      {standings.slice(0, limit).map((row) => (
        <li key={row.seatId} className="board-row display">
          <span className="board-rank">{row.rank}.</span> <span className="board-name">{row.nickname}</span> <span className="board-score">— {row.score}</span>
        </li>
      ))}
    </ul>
  );
}

export function Stage() {
  const { roomId = "" } = useParams();
  const [state, dispatch] = useReducer(stageReducer, null);
  const [missing, setMissing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [values, setValues] = useState<number[]>([]);
  const [settled, setSettled] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const drawn = webgl && !reduced;
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const splitList = useRef<HTMLUListElement>(null);
  const band = useRef<HTMLElement>(null);
  const podiumList = useRef<HTMLUListElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const [scene, setScene] = useState<StageRoom | null>(null);
  const busy = useRef(false);

  useEffect(() => keepClockSynced(), []);

  useEffect(() => {
    api(`/api/rooms/${roomId}/host`, { schema: roomReply }).then(
      ({ room }) => dispatch({ type: "loaded", room }),
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
      },
    );
  }, [roomId]);

  const room = state?.room ?? null;
  const handlers = useMemo(
    () => ({
      onEvent: (event: StoredEvent, delivery: Delivery) => dispatch({ type: "event", event, replay: delivery.replay }),
    }),
    [],
  );
  const notice = useRoomEvents(roomId, state ? { role: "stage" } : null, room?.lastEventId ?? null, handlers);

  const loaded = state !== null;
  useEffect(() => {
    if (!drawn || !loaded || !canvas.current || !labelLayer.current) {
      setScene(null);
      return;
    }
    let created: StageRoom;
    try {
      created = new StageRoom(canvas.current, labelLayer.current);
    } catch {
      setWebgl(false);
      return;
    }
    setScene(created);
    const observer = new ResizeObserver(() => created.resize());
    observer.observe(canvas.current);
    return () => {
      observer.disconnect();
      created.dispose();
      setScene(null);
    };
  }, [drawn, loaded]);

  const send = useCallback(
    async (command: HostCommand): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      try {
        await api(`/api/rooms/${roomId}/commands`, { method: "POST", body: { command } });
      } catch (error) {
        const code = error instanceof ApiFailure ? error.body.error : "";
        if (code === "illegal_transition" || code === "no_more_questions") dispatch({ type: "refused", text: "That step isn't available right now." });
      } finally {
        busy.current = false;
      }
    },
    [roomId],
  );

  const legal = useMemo(() => {
    const ok = (command: HostCommand): boolean => (room ? resolveCommand(room.state, command, room.questionIndex, room.questionCount).ok : false);
    return Object.fromEntries(hostCommands.map((command) => [command, ok(command)])) as Record<HostCommand, boolean>;
  }, [room]);

  const press = useCallback(
    (command: HostCommand): void => {
      if (command === "end") setDialogOpen(true);
      else void send(command);
    },
    [send],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || dialogOpen) return;
      const command = commandByKey.get(event.key.toLowerCase());
      if (!command || !legal[command]) return;
      event.preventDefault();
      press(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [legal, press, dialogOpen]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !dialogOpen) endButton.current?.focus();
    wasOpen.current = dialogOpen;
  }, [dialogOpen]);

  const revealKey = room?.state === "reveal" && room.reveal ? room.reveal.questionIndex : null;
  const instantReveal = state?.revealMode === "instant";
  useEffect(() => {
    setSettled(false);
    setValues([]);
    if (revealKey === null || !room?.reveal || !room.question) return;
    const items = splitItems(room.question, room.reveal);
    if (!drawn) {
      setValues(items.map((item) => item.count));
      setSettled(true);
      return;
    }
    if (!scene || !splitList.current || !band.current) return;
    scene.showReveal(
      { counts: items.map((item) => item.count), correct: items.flatMap((item, i) => (item.correct ? [i] : [])), plate: room.reveal.type === "estimate" ? room.reveal.inBandBins : [], list: splitList.current, ceiling: band.current.getBoundingClientRect().bottom },
      { onValues: setValues, onSettled: () => setSettled(true) },
      instantReveal,
    );
    return () => scene.clearReveal();
    // The reveal is drawn once per revealed question.
  }, [revealKey, scene, drawn]);

  const podiumOn = room?.state === "podium";
  const instantPodium = state?.podiumMode === "instant";
  useEffect(() => {
    setArrived(!drawn);
    if (!podiumOn || !scene || !podiumList.current || !drawn) return;
    scene.showPodium(podiumList.current, 3, () => setArrived(true), instantPodium);
    return () => scene.clearPodium();
    // The camera moves once when the podium step begins.
  }, [podiumOn, scene, drawn]);

  const deadline = room?.question?.deadlineAt ?? null;
  const seconds = useCountdown(deadline, room?.state === "question_open");

  if (missing) {
    return (
      <main className="stage-missing">
        <h1>Room not found</h1>
        <Link to="/host">Back to decks</Link>
      </main>
    );
  }
  if (!state || !room) return <div className="stage" aria-busy="true" />;

  const showBand = room.question !== null && showsQuestion(room.state);
  const question = room.question;

  return (
    <div className={`stage ${drawn ? "stage-drawn" : "stage-flat"}`} data-state={room.state}>
      {drawn ? <canvas ref={canvas} className="stage-canvas" aria-hidden="true" /> : null}
      <div ref={labelLayer} className="pillar-layer" aria-hidden="true" />
      <div className="stage-scrim" aria-hidden="true" />
      <header className="stage-top">
        <span className="wordmark display">Lastbell</span>
        <Status name="Connection status" message={noticeCopy[notice]} tone={notice === "backup" ? "error" : notice === "pending" ? "pending" : notice === "returned" ? "success" : "idle"} />
      </header>
      <main className="stage-main" data-lobby={room.state === "lobby" || undefined}>
        {room.state === "lobby" ? (
          <>
            <section aria-label="Join details" className="join-details">
              <p className="join-address">Join at {window.location.origin}</p>
              <p className="pin display">{room.pin}</p>
              <p className="connected">
                {room.connected} of {room.seated} phones connected
              </p>
            </section>
            <ul className="players" aria-label="Players">
              {room.players.map((player) => (
                <li key={player.seatId} className="player display" data-connected={player.connected}>
                  {player.nickname}
                </li>
              ))}
            </ul>
            {room.players.length === 0 ? <p className="waiting">Waiting for the first phone to join.</p> : null}
          </>
        ) : null}
        {showBand && question ? (
          <>
            <QuestionBand room={room} question={question} showAnswer={room.state === "reveal"} bandRef={band} />
            {room.state === "question_open" || room.state === "locked" ? (
              <>
                <div role="timer" aria-label="Time left" className="countdown display" data-late={room.state === "question_open" && seconds <= 5}>
                  {room.state === "locked" ? 0 : seconds}
                </div>
                <AnswerArea question={question} />
              </>
            ) : null}
            {room.state === "reveal" ? (
              <>
                {room.reveal?.type === "sequence" && question.type === "sequence" ? (
                  <ul className="items-cards correct-order" aria-label="Correct order">
                    {room.reveal.correctOrder.map((id) => (
                      <li key={id} className="item-card">
                        {question.items.find((item) => item.id === id)?.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <AnswerSplit room={room} question={question} values={values} settled={settled} still={!drawn} listRef={splitList} />
              </>
            ) : null}
          </>
        ) : null}
        {room.state === "leaderboard" ? (
          <section className="leaderboard">
            <h2>Leaderboard</h2>
            <Standings name="Leaderboard" standings={room.standings} limit={10} />
          </section>
        ) : null}
        {room.state === "podium" ? (
          <section className="podium" data-arrived={arrived}>
            <ul ref={podiumList} className="podium-list display" aria-label="Podium" style={{ opacity: arrived ? 1 : 0 }}>
              {room.standings.slice(0, 3).map((row) => (
                <li key={row.seatId} className="podium-place" data-rank={row.rank}>
                  {`${row.rank}. ${row.nickname} — ${row.score}`}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {room.state === "ended" ? (
          <section className="ended">
            <GlassWater size={88} strokeWidth={1} aria-hidden="true" />
            <h2>The night has ended</h2>
            <Link className="button button-primary" to="/host/nights">
              See it in Past nights
            </Link>
          </section>
        ) : null}
      </main>
      <footer className="stage-bottom">
        <Status name="Stage status" message={stageStatus(state)} tone={state.refusal ? "error" : "idle"} />
        <div className="control-bar" role="group" aria-label="Night controls">
          {hostCommands.map((command) => (
            <button
              key={command}
              type="button"
              ref={command === "end" ? endButton : undefined}
              data-step={command}
              aria-label={stepLabels[command].label}
              aria-keyshortcuts={stepLabels[command].key}
              disabled={!legal[command]}
              onClick={() => press(command)}
            >
              <span>{stepLabels[command].label}</span>
              <kbd aria-hidden="true">{stepLabels[command].key}</kbd>
            </button>
          ))}
        </div>
      </footer>
      <EndNightDialog
        open={dialogOpen}
        onKeepGoing={() => setDialogOpen(false)}
        onEnd={() => {
          setDialogOpen(false);
          void send("end");
        }}
      />
    </div>
  );
}
