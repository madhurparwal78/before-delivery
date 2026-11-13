import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { TypingEngine, replayLog } from "../../shared/engine";
import type { LogEntry } from "../../shared/engine";
import { ordinal, twoDecimals } from "../../shared/format";
import type { LivePush, RacerView, RoomEvent, RoomView } from "../../shared/protocol";
import { exchange } from "../api";
import { TypingSurface, useCapsLock } from "../components/TypingSurface";
import { WordsArea } from "../components/WordsArea";
import { live } from "../live";
import { runBody } from "../testSession";
import { Link, navigate } from "../router";
import { useStore } from "../store";
import { viewer } from "../viewer";

const ROOM_ERRORS: Readonly<Record<string, string>> = {
  room_not_found: "No room with that code.",
  room_full: "This room is full.",
  race_started: "This race has already started.",
};

/** Set when this browser just created or joined the room, so the room page does not join a second time. */
let justSeated: { code: string; rejoined: boolean } | null = null;

function SignInInvitation(): JSX.Element {
  return (
    <section class="paper narrow">
      <h1 class="page-title">Race rooms</h1>
      <p>Sign in to race.</p>
      <Link href="/signin" class="button">Sign in</Link>
    </section>
  );
}

export function RacePage(): JSX.Element {
  const { me } = useStore(viewer.state);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState("");

  if (!me) return <SignInInvitation />;

  async function create(): Promise<void> {
    const answer = await exchange("POST", "/api/rooms", {});
    if (answer.status !== 201) return setProblem("Something went wrong. Try again.");
    const made = String(answer.body.code);
    justSeated = { code: made, rejoined: false };
    navigate(`/race/${made.slice(0, 3)}-${made.slice(3)}`);
  }

  async function join(event: Event): Promise<void> {
    event.preventDefault();
    const answer = await exchange("POST", `/api/rooms/${encodeURIComponent(code.trim())}/join`, {});
    if (answer.status === 200) {
      const joined = String(answer.body.code);
      justSeated = { code: joined, rejoined: answer.body.rejoined === true };
      navigate(`/race/${joined.slice(0, 3)}-${joined.slice(3)}`);
    } else setProblem(ROOM_ERRORS[String(answer.body.error)] ?? "Something went wrong. Try again.");
  }

  return (
    <section class="paper race-lobby">
      <h1 class="page-title">Race rooms</h1>
      <p class="aside">Race the same passage against friends in a private room.</p>
      {problem && <p class="alert" role="alert">{problem}</p>}
      <div class="race-actions">
        <button type="button" class="button" onClick={() => void create()}>Create room</button>
        <form class="join-form" onSubmit={(event) => void join(event)}>
          <label for="room-code-input">Room code</label>
          <input id="room-code-input" type="text" value={code} autocomplete="off" spellcheck={false} onInput={(event) => setCode(event.currentTarget.value)} />
          <button type="submit" class="button">Join</button>
        </form>
      </div>
    </section>
  );
}

function announcementOf(event: RoomEvent): string | null {
  switch (event.kind) {
    case "joined":
      return `${event.racer} joined.`;
    case "left":
      return `${event.racer} left.`;
    case "host":
      return `${event.racer} is now the host.`;
    case "finished":
      return `${event.racer} finished ${ordinal(event.place)} with ${twoDecimals(event.speed)} wpm.`;
    case "over":
      return "Race finished.";
    case "step":
      return null;
  }
}

function label(racer: RacerView): string {
  return `${racer.name}${racer.host ? " (host)" : ""}${racer.left ? " (Left)" : ""}`;
}

function resultRows(room: RoomView): { place: string; racer: string; speed: string; accuracy: string }[] {
  const placed = room.racers.filter((racer) => racer.place !== null).sort((a, b) => a.place! - b.place! || a.seat - b.seat);
  const rows = placed.map((racer) => ({ place: String(racer.place), racer: racer.name, speed: twoDecimals(racer.speed ?? 0), accuracy: `${twoDecimals(racer.accuracy ?? 0)}%` }));
  const unplaced = (racer: RacerView): boolean => racer.place === null && (racer.dnf || room.state === "finished" || racer.left);
  const missing = room.racers.filter(unplaced).map((racer) => ({ place: racer.left ? "Left" : "DNF", racer: racer.name, speed: "-", accuracy: "-" }));
  return [...rows, ...missing.filter((row) => row.place === "DNF"), ...missing.filter((row) => row.place === "Left")];
}

export function RoomPage({ code }: { code: string }): JSX.Element {
  const { me } = useStore(viewer.state);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [you, setYou] = useState(0);
  const [problem, setProblem] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [countdown, setCountdown] = useState("");
  const [version, setVersion] = useState(0);
  const [blurred, setBlurred] = useState(false);
  const engine = useRef<TypingEngine | null>(null);
  const startedAt = useRef<number | null>(null);
  const lastEvent = useRef<number | null>(null);
  const submitted = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const capsLock = useCapsLock();
  const settings = useStore(viewer.settings);
  const config = useStore(viewer.config);
  const dashed = `${code.replace("-", "").slice(0, 3)}-${code.replace("-", "").slice(3)}`.toUpperCase();

  function submitFinish(race: TypingEngine, words: readonly string[]): void {
    if (submitted.current) return;
    submitted.current = true;
    const { score } = replayLog(words, race.log, race.rules);
    if (score === null) return;
    const body = runBody(words, score, race.log);
    void exchange("POST", `/api/rooms/${dashed}/finish`, body);
  }

  function absorb(push: Extract<LivePush, { type: "room" }>): void {
    setRoom(push.room);
    setYou(push.you);
    const words = push.room.words;
    if (words && !engine.current) {
      engine.current = new TypingEngine(words, { timeLimitMs: null, maxExtraLetters: config.maxExtraLetters });
    }
    const race = engine.current;
    const held = push.entries;
    if (race && held && held.length > race.log.length) for (const entry of held.slice(race.log.length)) race.apply(entry);
    else if (race && held && race.log.length > held.length) live.send({ type: "entries", code: dashed, entries: race.log.slice(held.length) });
    const lastSeen = lastEvent.current ?? 0;
    const fresh = push.events.filter((record) => record.id > lastSeen);
    lastEvent.current = Math.max(lastSeen, push.through);
    for (const record of fresh) {
      const event = record.event;
      if (event.kind === "step") {
        setCountdown(event.step);
        if (event.step === "Go" && startedAt.current === null) startedAt.current = performance.now();
      } else if (!("seat" in event && event.seat === push.you)) {
        const text = announcementOf(event);
        if (text) setAnnouncement(text);
      }
    }
    if (push.room.state === "racing" && startedAt.current === null) startedAt.current = performance.now() - (push.room.elapsedMs ?? 0);
    if (race?.ended && words) submitFinish(race, words);
    setVersion((n) => n + 1);
  }

  useLayoutEffect(() => {
    if (!me) return;
    let current = true;
    const seated = justSeated?.code === code.replace("-", "").toUpperCase() ? justSeated : null;
    justSeated = null;
    const enter = async (): Promise<boolean> => {
      if (seated) return seated.rejoined;
      const answer = await exchange("POST", `/api/rooms/${dashed}/join`, {});
      if (answer.status !== 200) {
        if (current) setProblem(ROOM_ERRORS[String(answer.body.error)] ?? "Something went wrong. Try again.");
        return false;
      }
      return answer.body.rejoined === true;
    };
    let leave: (() => void) | null = null;
    void enter().then((rejoined) => {
      if (!current) return;
      if (rejoined) setAnnouncement(`Rejoined race ${dashed}.`);
      leave = live.subscribe({
        open: () => ({ type: "room", code: dashed, since: lastEvent.current }),
        onPush: (push) => {
          if (push.type === "room" && push.room.code === code.replace("-", "").toUpperCase()) absorb(push);
          else if (push.type === "room-gone") setProblem("No room with that code.");
        },
      });
    });
    return () => {
      current = false;
      leave?.();
    };
  }, [me?.id, code]);

  const racing = room?.state === "racing";
  useLayoutEffect(() => {
    if (racing) inputRef.current?.focus({ preventScroll: true });
  }, [racing, engine.current]);

  function type(key: string): void {
    const race = engine.current;
    if (!room?.words || !race || room.state !== "racing" || startedAt.current === null) return;
    const entry: LogEntry = { k: key, t: Math.round(performance.now() - startedAt.current) };
    if (!race.apply(entry)) return;
    live.send({ type: "entries", code: dashed, entries: [entry] });
    setVersion((n) => n + 1);
    if (race.ended) submitFinish(race, room.words);
  }

  async function start(): Promise<void> {
    const answer = await exchange("POST", `/api/rooms/${dashed}/start`, {});
    if (answer.status !== 200) setProblem(ROOM_ERRORS[String(answer.body.error)] ?? "Something went wrong. Try again.");
  }

  if (!me) return <SignInInvitation />;
  if (problem && !room) {
    return (
      <section class="paper race-lobby">
        <h1 class="page-title">Race room</h1>
        <p class="alert" role="alert">{problem}</p>
        <Link href="/race" class="button">Back to race rooms</Link>
      </section>
    );
  }

  const mine = room?.racers.find((racer) => racer.seat === you);
  const race = engine.current;
  const finished = room?.state === "finished";
  const typedOut = race?.ended ?? false;
  const lines = room ? resultRows(room) : [];

  return (
    <section class="ticket">
      <div class="ticket-head">
        <p class="ticket-label">Race room</p>
        <p id="room-code" class="room-code">{dashed}</p>
        {finished ? <h2 class="ticket-heading">Race finished</h2> : <h2 class="ticket-heading">{room?.state === "open" ? "Waiting for racers" : room?.state === "countdown" ? "Get ready" : "Race on"}</h2>}
      </div>
      {problem && <p class="alert" role="alert">{problem}</p>}
      <ul class="racers" aria-label="Racers">
        {room?.racers.map((racer) => <li class="stamp" key={racer.seat}>{label(racer)}</li>)}
      </ul>
      {mine?.host && room?.state === "open" && (
        <button type="button" class="button" disabled={room.racers.length < 2} onClick={() => void start()}>Start race</button>
      )}
      <p class="countdown" role="status" aria-label="Race countdown">{countdown}</p>
      <p class="sr-only" role="status" aria-label="Race updates">{announcement}</p>
      {room?.words && race && (
        <div class="race-track">
          {typedOut || mine?.place || mine?.dnf ? (
            <p class="own-result">
              {mine?.place ? `You finished ${ordinal(mine.place)} with ${twoDecimals(mine.speed ?? 0)} wpm at ${twoDecimals(mine.accuracy ?? 0)}% accuracy.` : mine?.dnf ? "Your finish was not counted." : "Checking your result."}
            </p>
          ) : (
            <>
              <WordsArea id="words" caretId="caret" engine={race} version={version} settings={settings} busy={false} blurred={blurred} onFocusRequest={() => inputRef.current?.focus({ preventScroll: true })} />
              <TypingSurface inputRef={inputRef} onKey={type} onFocus={() => setBlurred(false)} onBlur={() => setBlurred(room.state === "racing")} />
              <p class="caps-lock" role="status" aria-label="Caps Lock">{capsLock ? "Caps Lock is on" : ""}</p>
            </>
          )}
        </div>
      )}
      <div class="bars">
        {room?.racers.map((racer) => (
          <div class="bar-row" key={racer.seat}>
            <span class="bar-name">{racer.name}</span>
            <div class="bar" role="progressbar" aria-label={`${racer.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={racer.progress}>
              <div class="bar-fill" style={{ width: `${racer.progress}%` }} />
            </div>
          </div>
        ))}
      </div>
      <table class="data-table" aria-label="Race results">
        <thead>
          <tr><th scope="col">Place</th><th scope="col">Racer</th><th scope="col">Speed</th><th scope="col">Accuracy</th></tr>
        </thead>
        <tbody>
          {lines.map((row) => (
            <tr key={row.racer + row.place}><td>{row.place}</td><td>{row.racer}</td><td>{row.speed}</td><td>{row.accuracy}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
