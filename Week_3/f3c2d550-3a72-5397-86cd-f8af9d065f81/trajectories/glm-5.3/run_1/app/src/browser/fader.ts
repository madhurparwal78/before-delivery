// The fader: a slider with one numbered detent per playable stop, and the
// scroll binding between the fader and the text column.

import { el, prefersReducedMotion } from "./dom.js";

export interface FaderParts {
  root: HTMLElement;
  input: HTMLInputElement;
  setStops: (n: number) => void;
  setPosition: (index: number, animate?: boolean) => void;
}

export function buildFader(onChange: (index: number, source: "key" | "pointer") => void): FaderParts {
  const root = el("div", { class: "fader" });
  const wrap = el("div", { class: "fader-track-wrap" });
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "0";
  input.value = "0";
  input.setAttribute("aria-label", "Reel position");
  input.id = "reel-position";
  const track = el("div", { class: "fader-track" });
  const knob = el("div", { class: "fader-knob" });
  const detents = el("div", { class: "detents" });
  track.append(knob);
  wrap.append(input, track);
  root.append(wrap, detents);

  let count = 1;

  const positionFor = (index: number) => count <= 1 ? 0.5 : index / (count - 1);

  const paint = (index: number) => {
    knob.style.left = `${positionFor(index) * 100}%`;
  };

  const parts: FaderParts = {
    root, input,
    setStops: (n: number) => {
      count = Math.max(1, n);
      input.max = String(Math.max(0, count - 1));
      detents.textContent = "";
      for (let i = 1; i <= count; i++) {
        const label = el("span");
        label.textContent = String(i);
        detents.append(label);
      }
      paint(Number(input.value));
    },
    setPosition: (index: number, animate = true) => {
      input.value = String(Math.min(index, Math.max(0, count - 1)));
      if (animate && !prefersReducedMotion()) {
        knob.style.transition = "left 180ms cubic-bezier(0.2, 0, 0.2, 1)";
        window.setTimeout(() => { knob.style.transition = ""; }, 180);
      }
      paint(Number(input.value));
    },
  };

  input.addEventListener("keydown", (e) => {
    const n = Number(input.max);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(n, Number(input.value) + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, Number(input.value) - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n;
    if (next !== null) {
      e.preventDefault();
      parts.setPosition(next);
      onChange(next, "key");
    }
  });

  // Dragging the knob: each detent boundary crossed changes the stop; on release
  // the knob settles onto the nearest detent over 180ms.
  let dragging = false;
  const indexFromEvent = (clientX: number): number => {
    const rect = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    if (count <= 1) return 0;
    const scaled = frac * (count - 1);
    return Math.round(scaled);
  };
  input.addEventListener("pointerdown", (e) => {
    dragging = true;
    input.setPointerCapture(e.pointerId);
    const idx = indexFromEvent(e.clientX);
    parts.setPosition(idx);
    onChange(idx, "pointer");
  });
  input.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const idx = indexFromEvent(e.clientX);
    if (idx !== Number(input.value)) {
      parts.setPosition(idx);
      onChange(idx, "pointer");
    }
  });
  input.addEventListener("pointerup", (e) => {
    dragging = false;
    const idx = indexFromEvent(e.clientX);
    parts.setPosition(idx);
    if (Number(input.value) !== idx) onChange(idx, "pointer");
  });

  return parts;
}
