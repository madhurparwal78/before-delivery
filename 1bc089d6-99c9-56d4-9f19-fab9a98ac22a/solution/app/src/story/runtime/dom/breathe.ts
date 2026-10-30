import { breathe } from "../../content";
import { type Disposables, query } from "../Disposables";
import type { Sound } from "./sound";

type Phase = "idle" | "in" | "hold" | "out" | "done";
const PHASE_KEYS: Phase[] = ["in", "hold", "out"];

/**
 * The guided 4-7-8 breath: three rounds of in, hold, out (57 seconds). The circle's size is a CSS
 * transition lasting exactly the phase; the phase name is announced and a quiet chime marks each change.
 * The button is renamed "Stop" while it runs and keeps focus throughout; the round counter
 * always shows: round 1 at rest, the last round once all three are done.
 */
export function initBreathe(disposables: Disposables, sound: Sound) {
  const guide = query(".sh-breathe__guide");
  const status = query(".sh-breathe__phase", guide);
  const round = query(".sh-breathe__round", guide);
  const count = query(".sh-breathe__count", guide);
  const button = query<HTMLButtonElement>(".sh-breathe__toggle", guide);
  let timers: number[] = [];
  let running = false;

  const clear = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers = [];
  };

  const setPhase = (phase: Phase, seconds = 0) => {
    guide.dataset.phase = phase;
    guide.style.setProperty("--phase-seconds", `${seconds}s`);
  };

  const showRound = (r: number) => {
    round.textContent = `Round ${r} of ${breathe.rounds}`;
  };

  const finish = (ending: "done" | "idle", text: string) => {
    clear();
    running = false;
    setPhase(ending);
    status.textContent = text;
    showRound(ending === "done" ? breathe.rounds : 1);
    count.textContent = "";
    button.textContent = breathe.start;
  };

  const start = () => {
    clear();
    running = true;
    button.textContent = breathe.stop;
    let at = 0;
    for (let r = 1; r <= breathe.rounds; r += 1) {
      breathe.phases.forEach((step, index) => {
        const begin = at;
        timers.push(
          window.setTimeout(() => {
            setPhase(PHASE_KEYS[index], step.seconds);
            status.textContent = step.name;
            showRound(r);
            sound.chime("breath");
          }, begin * 1000),
        );
        for (let second = 0; second < step.seconds; second += 1) {
          timers.push(
            window.setTimeout(() => {
              count.textContent = `${step.seconds - second}`;
            }, (begin + second) * 1000),
          );
        }
        at += step.seconds;
      });
    }
    timers.push(window.setTimeout(() => finish("done", breathe.done), at * 1000));
  };

  showRound(1);
  disposables.listen(button, "click", () => (running ? finish("idle", breathe.stopped) : start()));
  disposables.add(clear);
}
