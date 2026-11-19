// The Settle roll: changed cells animate in dependency order, the status bar counts up
// to the recalculation sentence, and the workspace reports when everything has settled.
import type { Kind, Recalc } from "./api.js";
import { reducedMotion } from "./dom.js";

const ROLL_STEP_MS = 60;
const ROLL_MS = 220;
const STAMP_MS = 120;
const TALLY_MAX_MS = 600;

const DECIMAL = /^-?\d+\.\d+$/;

// A Decimal shows one span per character; anything else is plain text.
export function paint(el: HTMLElement, display: string, kind: Kind | null): void {
  el.replaceChildren();
  if (kind === "decimal") {
    for (const ch of display) {
      const span = document.createElement("span");
      span.setAttribute("data-char", ch);
      span.textContent = ch;
      el.append(span);
    }
  } else el.textContent = display;
}

// The character positions that differ once old and new are aligned on the decimal point.
function differing(oldDisplay: string | null, newDisplay: string): boolean[] {
  if (oldDisplay === null || !DECIMAL.test(oldDisplay)) return Array.from(newDisplay, () => true);
  const newPoint = newDisplay.indexOf(".");
  const oldPoint = oldDisplay.indexOf(".");
  return Array.from(newDisplay, (ch, i) => oldDisplay[oldPoint + (i - newPoint)] !== ch || oldPoint + (i - newPoint) < 0);
}

function paintRolling(el: HTMLElement, oldDisplay: string | null, newDisplay: string, kind: Kind | null): void {
  if (kind === "decimal") {
    paint(el, newDisplay, kind);
    const diff = differing(oldDisplay, newDisplay);
    const newPoint = newDisplay.indexOf(".");
    const oldPoint = oldDisplay?.indexOf(".") ?? -1;
    [...el.children].forEach((span, i) => {
      if (!diff[i]) return;
      span.setAttribute("data-rolling", "true");
      const from = oldDisplay && DECIMAL.test(oldDisplay) ? oldDisplay[oldPoint + (i - newPoint)] ?? "" : "";
      span.setAttribute("data-from", from);
    });
    return;
  }
  paint(el, newDisplay, kind);
  if (kind === "error") el.setAttribute("data-stamp", "true");
  else el.setAttribute("data-fade", "true");
  el.setAttribute("data-from", oldDisplay ?? "");
}

export interface RollTarget {
  el: HTMLElement;
  old: string | null;
  now: string;
  kind: Kind | null;
  depth: number;
  visible: boolean; // inside the scrolled view, so it animates
}

export class Roll {
  private timers: number[] = [];
  private finishers: (() => void)[] = [];
  private marked: HTMLElement[] = [];
  private active = false;

  constructor(
    private readonly tally: (text: string) => void,
    private readonly onSettled: () => void,
  ) {
    reducedMotion.addEventListener("change", () => {
      if (reducedMotion.matches) this.finish();
    });
  }

  get playing(): boolean {
    return this.active;
  }

  // Ends a playing roll at once: final values shown, nothing pending afterwards.
  finish(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const finishers = this.finishers;
    this.finishers = [];
    for (const f of finishers) f();
    if (this.active) {
      this.active = false;
      this.onSettled();
    }
  }

  // Removes every marker of the last roll.
  clear(): void {
    this.finish();
    for (const el of this.marked) {
      for (const a of ["data-recalc-depth", "data-roll", "data-error", "data-rolling", "data-stamp", "data-fade", "data-from"]) el.removeAttribute(a);
    }
    this.marked = [];
  }

  play(recalc: Recalc, targets: RollTarget[]): void {
    this.clear();
    const reduced = reducedMotion.matches;
    const lastStart = Math.max(0, ...recalc.cells.map((c) => c.depth)) * ROLL_STEP_MS;
    const tallyMs = recalc.cells.length === 0 ? 0 : Math.min(TALLY_MAX_MS, lastStart + ROLL_MS);
    let lastSettle = 0;
    this.active = true;
    const later = (ms: number, f: () => void) => {
      this.timers.push(window.setTimeout(f, ms));
    };
    for (const t of targets) {
      const el = t.el;
      this.marked.push(el);
      el.setAttribute("data-recalc-depth", String(t.depth));
      if (t.kind === "error") el.setAttribute("data-error", "true");
      const settle = () => {
        for (const a of ["data-rolling", "data-stamp", "data-fade", "data-from"]) el.removeAttribute(a);
        el.querySelectorAll("[data-rolling]").forEach((s) => {
          s.removeAttribute("data-rolling");
          s.removeAttribute("data-from");
        });
        paint(el, t.now, t.kind);
        if (t.visible) el.setAttribute("data-roll", "settled");
      };
      if (reduced || !t.visible) {
        settle();
        continue;
      }
      const start = t.depth * ROLL_STEP_MS;
      const length = t.kind === "error" ? STAMP_MS : ROLL_MS;
      lastSettle = Math.max(lastSettle, start + length);
      el.setAttribute("data-roll", "waiting");
      paint(el, t.old ?? "", t.old !== null && DECIMAL.test(t.old) ? "decimal" : "text");
      later(start, () => {
        el.setAttribute("data-roll", "rolling");
        paintRolling(el, t.old, t.now, t.kind);
      });
      later(start + length, settle);
      this.finishers.push(settle);
    }
    const sentence = recalc.sentence;
    const counted = (n: number) =>
      sentence.replace(/^Recalculated \d+ cells?/, `Recalculated ${n} ${n === 1 ? "cell" : "cells"}`);
    if (reduced || tallyMs === 0) this.tally(sentence);
    else {
      this.tally(counted(0));
      const n = recalc.cells.length;
      for (let k = 1; k <= n; k++) later(Math.round((k * tallyMs) / n), () => this.tally(k === n ? sentence : counted(k)));
      this.finishers.push(() => this.tally(sentence));
    }
    const settledAt = reduced ? 0 : Math.max(tallyMs, lastSettle);
    if (settledAt === 0) {
      this.finishers = [];
      this.active = false;
      this.onSettled();
    } else {
      later(settledAt, () => {
        this.finishers = [];
        this.active = false;
        this.onSettled();
      });
    }
  }
}
