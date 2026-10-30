import { api } from "../../../planner/api";
import { numbers } from "../../content";
import { type Disposables, query, queryAll } from "../Disposables";

const ROLL_MS = 650;
const ROLL_STAGGER_MS = 45;
const REFRESH_MS = 60_000;

/**
 * Each digit column rolls a strip of digits (drawn by CSS, outside the page text) up from zero to its
 * digit, then the real digit takes its place. All six columns finish in under a second.
 */
function roll(reduced: boolean) {
  queryAll<HTMLElement>(".sh-numerals").forEach((numeral, group) => {
    const digits = numeral.dataset.roll ?? "";
    queryAll<HTMLElement>(".sh-numerals__column", numeral).forEach((column, place) => {
      const strip = query(".sh-numerals__strip", column);
      const cells = 10 + Number(digits[place]);
      const land = () => column.classList.add("is-rolled");
      if (reduced) {
        land();
        return;
      }
      const cell = column.getBoundingClientRect().height;
      const animation = strip.animate([{ transform: "translateY(0)" }, { transform: `translateY(${-cells * cell}px)` }], {
        duration: ROLL_MS,
        delay: (group * digits.length + place) * ROLL_STAGGER_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      });
      animation.finished.then(land).catch(() => {});
    });
  });
}

function liveCountCopy(count: number) {
  return count === 1 ? numbers.liveOne : numbers.liveMany(count.toLocaleString("en-US"));
}

/** The live figure: how many people keep a Stillhour tonight, straight from the server. */
async function loadLiveCount(line: HTMLElement) {
  const result = await api<{ keeping: number }>("GET", "/api/tonight");
  line.dataset.state = result.ok ? "ready" : "resting";
  line.textContent = result.ok ? liveCountCopy(result.data.keeping) : numbers.liveResting;
}

/** Rolls the numerals the first time the band is on screen; the live count loads when the gate closes and every minute while the band is on screen. */
export function initNumerals(disposables: Disposables, reduced: boolean) {
  const band = query(".sh-numbers");
  const line = query("[data-live-count]", band);
  let rolled = false;
  let visible = false;
  let timer = 0;

  const schedule = () => {
    window.clearInterval(timer);
    if (visible) timer = window.setInterval(() => void loadLiveCount(line), REFRESH_MS);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visible = entry.isIntersecting;
      if (visible && !rolled) {
        rolled = true;
        roll(reduced);
      }
      schedule();
    });
  });
  observer.observe(band);
  disposables.add(() => {
    observer.disconnect();
    window.clearInterval(timer);
  });

  return { refresh: () => void loadLiveCount(line) };
}
