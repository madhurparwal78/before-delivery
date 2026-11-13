import type { Standing } from "../shared/api.ts";
import type { Badge } from "./components/Shirt.tsx";

// The Points relay (brief: Motion and effects): pulse 180 ms → flight 380 ms → digit roll 600 ms →
// row move 330 ms, strictly in order, ending on the server's values. Stage order runs on timers;
// the movement is WAAPI. Reduced motion, and any update that lands mid-relay, apply at once with
// a static badge.

interface RelayJob {
  playerId: string;
  chip: string;
  negative: boolean;
  shirtPoints: number;
  total: number;
  rows: Standing[] | null;
}

interface RelayHooks {
  shirt: (playerId: string, points: number) => void;
  total: (total: number, roll: boolean) => void;
  rows: (rows: Standing[], move: boolean) => void;
  badge: (playerId: string, badge: Badge, ms: number) => void;
}

const PULSE = 180;
const FLIGHT = 380;
const ROLL = 600;
const ROW = 330;
const BADGE_MS = 4000;

const centre = (element: Element) => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

export function createRelay(hooks: RelayHooks) {
  let running: RelayJob | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let animations: Animation[] = [];
  let chip: HTMLElement | null = null;

  const settle = (job: RelayJob, badge: boolean) => {
    hooks.shirt(job.playerId, job.shirtPoints);
    hooks.total(job.total, false);
    if (job.rows) hooks.rows(job.rows, false);
    if (badge) hooks.badge(job.playerId, { text: job.chip, tone: job.negative ? "down" : "up" }, BADGE_MS);
  };

  const stopRunning = () => {
    for (const timer of timers) clearTimeout(timer);
    for (const animation of animations) animation.cancel();
    chip?.remove();
    timers = [];
    animations = [];
    chip = null;
    if (running) settle(running, false);
    running = null;
  };

  const at = (ms: number, step: () => void) => timers.push(setTimeout(step, ms));

  function play(job: RelayJob, reduced: boolean): void {
    if (running || reduced) {
      stopRunning();
      settle(job, true);
      return;
    }
    running = job;
    // 1. Pulse: the shirt flashes amber and the signed chip appears on it.
    hooks.shirt(job.playerId, job.shirtPoints);
    const shirt = document.querySelector(`[data-player-id="${job.playerId}"]`);
    const start = shirt ? centre(shirt) : { x: innerWidth / 2, y: innerHeight / 2 };
    if (shirt) {
      animations.push(
        shirt.animate(
          [
            { boxShadow: "0 0 0 0 rgb(242 179 61 / 0.9)", outlineColor: "#f2b33d" },
            { boxShadow: "0 0 0 10px rgb(242 179 61 / 0)", outlineColor: "#f2b33d", offset: 0.7 },
            { boxShadow: "0 0 0 0 rgb(242 179 61 / 0)", outlineColor: "transparent" },
          ],
          { duration: PULSE, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.2)" },
        ),
      );
    }
    chip = document.createElement("div");
    chip.className = `relay-chip${job.negative ? " negative" : ""}`;
    chip.setAttribute("data-relay-chip", "");
    chip.setAttribute("aria-hidden", "true");
    const [delta, multiplier] = job.chip.split(" ");
    chip.textContent = delta ?? "";
    if (multiplier) {
      const tag = document.createElement("span");
      tag.className = "mult";
      tag.textContent = multiplier;
      chip.append(tag);
    }
    chip.style.transform = `translate(${start.x}px, ${start.y}px) translate(-50%, -50%)`;
    document.body.append(chip);
    animations.push(chip.animate([{ scale: "0.6" }, { scale: "1.15", offset: 0.6 }, { scale: "1" }], { duration: PULSE, easing: "ease-out" }));

    // 2. Flight along a gentle arc to the gameweek total (the bottom strip on a phone).
    at(PULSE, () => {
      const target = document.querySelector("[data-gameweek-total]");
      const end = target ? centre(target) : start;
      const lift = Math.min(140, Math.hypot(end.x - start.x, end.y - start.y) * 0.35);
      const control = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - lift };
      const frames = Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        const x = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x;
        const y = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y;
        return { transform: `translate(${x}px, ${y}px) translate(-50%, -50%)`, opacity: i === 8 ? 0.2 : 1 };
      });
      if (chip) {
        const flight = chip.animate(frames, { duration: FLIGHT, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
        animations.push(flight);
      }
    });

    // 3. Digit roll: the chip lands and the total counts to the new value.
    at(PULSE + FLIGHT, () => {
      chip?.remove();
      chip = null;
      hooks.total(job.total, true);
    });

    // 4. Row move: the viewer's league row slides to its new rank.
    at(PULSE + FLIGHT + ROLL, () => {
      if (job.rows) hooks.rows(job.rows, true);
    });

    at(PULSE + FLIGHT + ROLL + ROW, () => {
      running = null;
      timers = [];
      animations = [];
    });
  }

  return {
    play,
    // An update that is not a relay of the viewer's points applies at once, ending any relay first.
    apply(update: () => void): void {
      stopRunning();
      update();
    },
    stop: stopRunning,
  };
}
