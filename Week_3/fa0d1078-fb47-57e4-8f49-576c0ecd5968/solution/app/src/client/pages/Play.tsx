import type { JSX } from "preact";
import { useLayoutEffect, useMemo } from "preact/hooks";
import { LEVEL_NAMES } from "../../shared/levels";
import type { Game, Result } from "../../shared/protocol";
import { get } from "../api";
import { announce } from "../announcer";
import { Board } from "../components/Board";
import { Clock } from "../components/Clock";
import { Dialog } from "../components/Dialog";
import { Hem, HemCount } from "../components/Hem";
import { Pad } from "../components/Pad";
import { clientConfig } from "../config";
import { formatClock, longDate, plural } from "../format";
import { focusCell, GameSession } from "../game/session";
import { useLoad, useStartGame } from "../hooks";
import { failureSentence } from "../messages";
import { navigate } from "../router";
import { useStore } from "../store";
import { NotFound, Voice } from "./NotFound";

interface PlayProps {
  id: string;
}

export function Play({ id }: PlayProps): JSX.Element {
  const loaded = useLoad(async () => (await get<{ game: Game }>(`/api/games/${id}`)).game, id);
  if (loaded.status === "loading") return <Voice sentence="The atelier is preparing your page." />;
  if (loaded.status === "failed") {
    return loaded.error.code === "UNKNOWN_GAME" ? <NotFound sentence="This game isn't in the collection." /> : <Voice sentence={failureSentence(loaded.error)} />;
  }
  if (loaded.value.status === "abandoned") return <NotFound sentence="This game isn't in the collection." />;
  return <Table key={loaded.value.id} game={loaded.value} />;
}

function titleOf(game: Game): string {
  return game.mode === "daily" && game.date ? `Daily, ${longDate(game.date)}` : `${LEVEL_NAMES[game.level]} game`;
}

const solvedSentence = (result: Result): string =>
  `Solved in ${formatClock(result.seconds)} with ${plural(result.mistakes, "mistake")} and ${plural(result.hints, "hint")}. Score ${result.score}.`;

function Table({ game }: { game: Game }): JSX.Element {
  const session = useMemo(() => new GameSession(game, clientConfig), [game]);
  const state = useStore(session.state);
  const newGame = useStartGame();
  const view = session.view();
  const lost = state.board.standing.lost;
  const limits = session.limits;

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (session.handleKey(event)) event.preventDefault();
    };
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") session.pause(true);
    };
    const onBlur = (): void => session.pause(true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onBlur);
    if (session.state.get().dialog === "over") announce(`Game over. ${session.state.get().board.mistakes} mistakes.`);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onBlur);
    };
  }, [session]);

  const backToBoard = (): void => focusCell(session.state.get().selected);
  const hintsLeft = session.hintsLeft;

  return (
    <section class="play">
      <h1 class="page-title">{titleOf(game)}</h1>
      <div class="play-grid">
        <div class="plinth">
          <div class="board-frame">
            <Board view={view} onSelect={(index) => session.select(index)} />
            <Hem id="hem" name="Your thread" stitches={session.stitches} slots={session.slots} variant="own" closed={state.won} />
            {state.checking && (
              <p class="checking" aria-hidden="true">
                Checking your game.
              </p>
            )}
          </div>
          <p class="thread-line">
            Stitches <HemCount count={session.stitches} />
          </p>
        </div>
        <div class="side">
          <Clock read={session.elapsed} running={session.running} />
          <div class="tally">
            <p id="mistakes">{`Mistakes: ${state.board.mistakes}/${limits.mistakeLimit}`}</p>
            <p id="hints-left">{`Hints left: ${hintsLeft}`}</p>
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
            <button type="button" class="button" disabled={hintsLeft <= 0} onClick={() => session.hint()}>
              Hint
            </button>
            <button type="button" class="button" onClick={() => session.pause()}>
              Pause
            </button>
          </div>
          <Pad cells={view.cells} onDigit={(digit) => session.enter(digit)} />
        </div>
      </div>
      {state.saveFailed && <p class="board-note">Your game wasn't saved. It will be saved with your next move.</p>}
      {state.failure && <p class="board-note">{state.failure}</p>}
      {state.dialog === "paused" && (
        <Dialog name="Paused" onClose={backToBoard}>
          <p>Your game is paused.</p>
          <button type="button" class="button" data-autofocus onClick={() => session.resume()}>
            Resume
          </button>
        </Dialog>
      )}
      {state.dialog === "over" && (
        <Dialog name="Game over" role="alertdialog" onClose={backToBoard}>
          <p>{state.board.secondChanceUsed ? `You made ${limits.mistakeLimit} mistakes. Your second chance is used.` : `You made ${limits.mistakeLimit} mistakes.`}</p>
          <div class="dialog-actions">
            {!state.board.secondChanceUsed && !session.closed && lost && (
              <button type="button" class="button" data-autofocus onClick={() => session.secondChance()}>
                Second chance
              </button>
            )}
            <NewGameButton level={game.level} newGame={newGame} focused={state.board.secondChanceUsed || session.closed} />
          </div>
          {newGame.failure && <p class="form-note">{newGame.failure}</p>}
        </Dialog>
      )}
      {state.dialog === "solved" && state.result && (
        <Dialog name="Puzzle solved" onEscape={() => session.closeDialog()} onClose={backToBoard}>
          <p>{solvedSentence(state.result)}</p>
          <div class="dialog-actions">
            <NewGameButton level={game.level} newGame={newGame} focused />
            <button type="button" class="button" onClick={() => navigate("/profile")}>
              View profile
            </button>
          </div>
          {newGame.failure && <p class="form-note">{newGame.failure}</p>}
        </Dialog>
      )}
      {state.dialog === "refused" && state.refusal && (
        <Dialog name="Not counted" role="alertdialog" onEscape={() => session.closeDialog()} onClose={backToBoard}>
          <p>{state.refusal}</p>
          <button type="button" class="button" data-autofocus onClick={() => session.closeDialog()}>
            Close
          </button>
        </Dialog>
      )}
    </section>
  );
}

interface NewGameButtonProps {
  level: Game["level"];
  newGame: { pending: boolean; start: (level: Game["level"]) => void };
  focused: boolean;
}

function NewGameButton({ level, newGame, focused }: NewGameButtonProps): JSX.Element {
  return (
    <button type="button" class="button" data-autofocus={focused ? "" : undefined} aria-disabled={newGame.pending ? "true" : "false"} onClick={() => newGame.start(level)}>
      New game
    </button>
  );
}
