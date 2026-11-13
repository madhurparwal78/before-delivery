import type { JSX } from "preact";
import { useLayoutEffect, useMemo, useState } from "preact/hooks";
import type { Player, Room as RoomData } from "../../shared/protocol";
import { ApiFailure, get } from "../api";
import { Board } from "../components/Board";
import { Clock } from "../components/Clock";
import { Dialog } from "../components/Dialog";
import { Hem, HemCount } from "../components/Hem";
import { Pad } from "../components/Pad";
import { clientConfig } from "../config";
import { DuelSession } from "../game/duel";
import { M40 } from "../messages";
import { useMe } from "../me";
import { useStore } from "../store";
import { NotFound, Voice } from "./NotFound";
import { navigate } from "../router";

export function Room({ code }: { code: string }): JSX.Element {
  const me = useMe();
  if (!me) return <Voice sentence="The atelier is preparing your page." />;
  return <Seated key={code} code={code} me={me} />;
}

function Seated({ code, me }: { code: string; me: Player }): JSX.Element {
  const session = useMemo(() => new DuelSession(code, me, clientConfig.mistakeLimit), [code]);
  const state = useStore(session.state);
  const [dismissed, setDismissed] = useState(false);

  useLayoutEffect(() => {
    let current = true;
    get<{ room: RoomData }>(`/api/duels/${code}`).then(
      ({ room }) => current && session.open(room),
      (error: unknown) => {
        if (current) session.fail(error instanceof ApiFailure && error.code === "LIVE_UNAVAILABLE" ? "unavailable" : "missing");
      },
    );
    const onKey = (event: KeyboardEvent): void => {
      if (session.handleKey(event)) event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      current = false;
      document.removeEventListener("keydown", onKey);
      session.close();
    };
  }, [session]);

  const room = state.room;
  if (state.phase === "missing") return <NotFound />;
  if (state.phase === "unavailable") {
    return (
      <section class="room">
        <h1 class="page-title">{`Room ${code}`}</h1>
        <p id="duel-notice" class="voice-line">
          {M40}
        </p>
      </section>
    );
  }
  if (!room || state.phase === "loading" || (state.phase === "playing" && state.puzzle === null)) return <Voice sentence="The atelier is preparing your page." />;
  const playing = state.puzzle !== null && (state.phase === "playing" || state.phase === "over");
  return (
    <section class="room">
      <h1 class="page-title">{`Room ${code}`}</h1>
      {playing ? <Match session={session} /> : <Lobby session={session} room={room} />}
      {state.phase === "over" && state.result && !dismissed && (
        <Dialog name="Duel over" onEscape={() => setDismissed(true)}>
          <p id="duel-result" role="status">
            {session.resultSentence(state.result)}
          </p>
          <button type="button" class="button" data-autofocus onClick={() => navigate("/duel")}>
            Back to duels
          </button>
        </Dialog>
      )}
    </section>
  );
}

function Lobby({ session, room }: { session: DuelSession; room: RoomData }): JSX.Element {
  const me = useMe();
  const state = useStore(session.state);
  const mine = room.seats.find((seat) => seat.display_name === me?.display_name);
  return (
    <div class="tile lobby">
      <p class="lobby-level">{`${room.level[0]?.toUpperCase()}${room.level.slice(1)} duel`}</p>
      <ul class="seats" aria-label="Seats">
        {[0, 1].map((index) => {
          const seat = room.seats[index];
          return (
            <li key={index} data-ready={seat?.ready ? "true" : "false"}>
              {seat ? seat.display_name : "Waiting for a second player."}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        class="button"
        aria-pressed={mine?.ready ? "true" : "false"}
        disabled={state.phase !== "lobby" || room.seats.length < 2}
        onClick={() => session.setReady(!mine?.ready)}
      >
        Ready
      </button>
      {state.phase === "countdown" && state.countdown !== null && (
        <p id="countdown" class="countdown">{`Starting in ${state.countdown}`}</p>
      )}
    </div>
  );
}

function Match({ session }: { session: DuelSession }): JSX.Element {
  const state = useStore(session.state);
  const view = session.view();
  const you = state.you;
  const slots = session.slots;
  const name = session.opponentName;
  const mistakeLimit = clientConfig.mistakeLimit;
  return (
    <div class="play-grid">
      <div class="plinth">
        <div class="board-frame">
          <Board view={view} onSelect={(index) => session.select(index)} />
          <Hem id="hem" name="Your thread" stitches={you?.correct ?? 0} slots={slots} variant="own" />
          <Hem id="hem-opponent" name={`${name}'s thread`} stitches={state.opponent.correct} slots={slots} variant="opponent" />
        </div>
        <p class="thread-line">
          Stitches <HemCount count={you?.correct ?? 0} />
        </p>
      </div>
      <div class="side">
        <Clock read={session.elapsed} running={state.phase === "playing"} />
        <div class="bars">
          <Progress label="Your progress" text={`You: ${you?.correct ?? 0} of ${slots}`} done={you?.correct ?? 0} slots={slots} />
          <Progress label={`${name}'s progress`} text={`${name}: ${state.opponent.correct} of ${slots}`} done={state.opponent.correct} slots={slots} opponent />
          {state.opponent.presence && <p class="presence">{state.opponent.presence}</p>}
        </div>
        <div class="tally">
          <p id="mistakes">{`Mistakes: ${you?.mistakes ?? 0}/${mistakeLimit}`}</p>
          <p id="opponent-mistakes">{`Mistakes: ${state.opponent.mistakes}/${mistakeLimit}`}</p>
        </div>
        <div class="controls">
          <button type="button" class="button" onClick={() => session.undo()}>
            Undo
          </button>
          <button type="button" class="button" onClick={() => session.redo()}>
            Redo
          </button>
          <button type="button" class="button" onClick={() => session.erase()}>
            Erase
          </button>
          <button type="button" class="button" aria-pressed={state.notesMode ? "true" : "false"} onClick={() => session.toggleNotes()}>
            Notes
          </button>
        </div>
        <Pad cells={view.cells} onDigit={(digit) => session.enter(digit)} />
      </div>
    </div>
  );
}


interface ProgressProps {
  label: string;
  text: string;
  done: number;
  slots: number;
  opponent?: boolean;
}

function Progress({ label, text, done, slots, opponent = false }: ProgressProps): JSX.Element {
  return (
    <div class="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={slots} aria-valuenow={done}>
      <span class="bar-track">
        <span class={opponent ? "bar-fill opponent" : "bar-fill"} style={{ width: `${slots === 0 ? 0 : (done / slots) * 100}%` }} />
      </span>
      <span class="bar-text">{text}</span>
    </div>
  );
}
