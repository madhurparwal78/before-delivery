// Notices: every async action's pending and outcome copy, with fade and slide phases.

import { h, type Attrs } from "../dom.js";

export type NoticeRegion = {
  el: HTMLElement;
  show(text: string, now: number, reduced: boolean): void;
  clear(now: number, reduced: boolean): void;
  tick(now: number, reduced: boolean): void;
  text(): string;
  phase(): string;
};

const ENTER_MS = 200; // 0.15–0.25 s
const EXIT_MS = 200;

/** Each new notice fades in while sliding down 8–12 px; a replaced entering notice continues from its state. */
export function createNotices(parent: HTMLElement): NoticeRegion {
  let current = "";
  let phase: "idle" | "entering" | "shown" | "leaving" = "idle";
  let phaseStartedAt = 0;
  let startY = 10; // px of slide remaining

  const el = h("div", {
    role: "status",
    "aria-label": "Notices",
    class: "notices",
    "data-notice-phase": "idle",
  });
  const text = h("span", { class: "notice-text" });
  el.append(text);
  parent.append(el);

  function apply(now: number, reduced: boolean): void {
    el.setAttribute("data-notice-phase", phase);
    if (phase === "idle") {
      text.textContent = "";
      el.classList.remove("is-shown");
      return;
    }
    el.classList.add("is-shown");
    if (reduced) {
      if (phase === "entering") {
        phase = "shown";
        phaseStartedAt = now;
        startY = 0;
        el.setAttribute("data-notice-phase", phase);
      }
      if (phase === "leaving") {
        phase = "idle";
        el.setAttribute("data-notice-phase", phase);
        text.textContent = "";
        el.classList.remove("is-shown");
      }
      el.style.opacity = phase === "shown" ? "1" : "0";
      el.style.transform = "translateY(0)";
      return;
    }
    const t = (now - phaseStartedAt) / (phase === "leaving" ? EXIT_MS : ENTER_MS);
    if (phase === "entering") {
      const eased = 1 - Math.pow(1 - Math.min(1, t), 3);
      el.style.opacity = String(Math.min(1, eased));
      el.style.transform = `translateY(${(1 - eased) * startY}px)`;
      if (t >= 1) {
        phase = "shown";
        phaseStartedAt = now;
        startY = 0;
        el.setAttribute("data-notice-phase", phase);
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      }
    } else if (phase === "leaving") {
      const eased = Math.min(1, t);
      el.style.opacity = String(1 - eased);
      if (t >= 1) {
        phase = "idle";
        el.setAttribute("data-notice-phase", phase);
        text.textContent = "";
        el.classList.remove("is-shown");
      }
    } else {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    }
  }

  return {
    el,
    show(t, now, reduced) {
      if (current === t && phase !== "idle" && phase !== "leaving") {
        return;
      }
      current = t;
      text.textContent = t;
      // A notice replaced while entering continues from its current position and fade.
      if (phase === "entering" && !reduced) {
        const t0 = (now - phaseStartedAt) / ENTER_MS;
        startY = (1 - t0) * startY;
      } else {
        startY = 10;
      }
      phase = "entering";
      phaseStartedAt = now;
      apply(now, reduced);
    },
    clear(now, reduced) {
      if (phase === "idle") return;
      current = "";
      phase = "leaving";
      phaseStartedAt = now;
      apply(now, reduced);
    },
    tick(now, reduced) {
      if (phase === "idle") return;
      apply(now, reduced);
    },
    text: () => current,
    phase: () => phase,
  };
}

export type NoticeAttrs = Attrs;
