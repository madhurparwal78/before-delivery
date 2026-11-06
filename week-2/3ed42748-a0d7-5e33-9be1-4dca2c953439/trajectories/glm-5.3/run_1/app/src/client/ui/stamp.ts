// The stamp balance: one stamp-press per confirmed change, queued in order.

import { h } from "../dom.js";

export type StampBalance = {
  el: HTMLElement;
  setTarget(balance: number): void;
  tick(now: number, reduced: boolean): void;
  shown(): number;
  presses(): number;
};

const PRESS_MS = 250; // 0.2–0.3 s
const GLOW_MS = 500;

type Queued = { from: number; to: number };

/** Each confirmed balance change plays one stamp-press; changes queue up and play in turn. */
export function createStampBalance(parent: HTMLElement): StampBalance {
  let shownBalance = 0;
  let pressCount = 0;
  const queue: Queued[] = [];
  let active: { change: Queued; startedAt: number; switched: boolean } | null = null;

  const numeral = h("span", { class: "balance-numeral" });
  const glow = h("span", { class: "balance-glow" });
  const el = h(
    "div",
    { role: "status", "aria-label": "Stamp balance", class: "stamp-balance", "data-balance-shown": "0", "data-stamp-presses": "0" },
    numeral,
    h("span", { class: "balance-word" }, " stamps"),
    glow,
  );
  parent.append(el);

  function tick(now: number, reduced: boolean): void {
    if (!active && queue.length > 0) {
      const change = queue.shift()!;
      active = { change, startedAt: now, switched: false };
    }
    if (!active) return;
    const t = (now - active.startedAt) / PRESS_MS;
    if (reduced) {
      // The numeral changes with no press or glow, and presses still count each change.
      shownBalance = active.change.to;
      numeral.textContent = String(shownBalance);
      el.setAttribute("data-balance-shown", String(shownBalance));
      pressCount += 1;
      el.setAttribute("data-stamp-presses", String(pressCount));
      active = null;
      glow.classList.remove("is-on");
      return;
    }
    const scale = 1 + 0.22 * Math.sin(Math.min(1, t) * Math.PI);
    numeral.style.transform = `scale(${scale})`;
    if (!active.switched && t >= 0.5) {
      active.switched = true;
      shownBalance = active.change.to;
      numeral.textContent = String(shownBalance);
      el.setAttribute("data-balance-shown", String(shownBalance));
      glow.classList.add("is-on");
      glow.style.opacity = "1";
    }
    if (t >= 1) {
      pressCount += 1;
      el.setAttribute("data-stamp-presses", String(pressCount));
      active = null;
      const glowStart = now;
      const fade = () => {
        const gt = (performance.now() - glowStart) / GLOW_MS;
        glow.style.opacity = String(Math.max(0, 1 - gt));
        if (gt < 1) requestAnimationFrame(fade);
        else glow.classList.remove("is-on");
      };
      requestAnimationFrame(fade);
    }
  }

  return {
    el,
    setTarget(balance) {
      if (balance === shownBalance && queue.length === 0 && !active) return;
      queue.push({ from: shownBalance, to: balance });
    },
    tick,
    shown: () => shownBalance,
    presses: () => pressCount,
  };
}
