import { clear, el, reducedMotion } from "./dom.js";
import { euros } from "./format.js";

const ROLL_MS = 560;
const STAGGER_MS = 40;
const EASING = "cubic-bezier(0.24, 0.9, 0.2, 1)";

const isDigit = (c: string): boolean => c >= "0" && c <= "9";

const figureOf = (text: string): number => Number(text.replace(/[^0-9]/g, ""));

/**
 * HammerNumeral is the saleroom's signature motion. When the server confirms
 * a new price, only the digits that differ roll: up when the price rises,
 * down when a removal lowers it, each starting a little after the changed
 * digit to its right. The euro sign and the commas never move.
 *
 * Each character is its own element whose text is always the confirmed
 * figure. The outgoing digit is drawn alongside it and carried out by the
 * same single animation, so the price reads the server's figure throughout.
 */
export class HammerNumeral {
  private readonly host: HTMLElement;
  private shown: string | null = null;
  private running: Animation[] = [];

  constructor(host: HTMLElement) {
    this.host = host;
  }

  /** set paints the server's confirmed price. */
  set(price: number): void {
    const next = euros(price);
    if (next === this.shown) return;
    const previous = this.shown;
    this.shown = next;
    for (const animation of this.running) animation.cancel();
    this.running = [];
    clear(this.host);
    const rolls = this.paint(next, previous);
    if (previous === null || reducedMotion() || rolls.length === 0) return;
    const rising = price > figureOf(previous);
    rolls.sort((a, b) => a.rightIndex - b.rightIndex);
    rolls.forEach(({ roll }, order) => {
      roll.classList.add(rising ? "hn-up" : "hn-down");
      const from = rising ? "translateY(1em)" : "translateY(-1em)";
      const animation = roll.animate([{ transform: from }, { transform: "translateY(0)" }], {
        duration: ROLL_MS,
        delay: order * STAGGER_MS,
        easing: EASING,
        fill: "both",
      });
      this.running.push(animation);
      animation.finished
        .then(() => {
          animation.cancel();
          this.running = this.running.filter((entry) => entry !== animation);
          roll.classList.remove("hn-up", "hn-down");
          roll.removeAttribute("data-from");
        })
        .catch(() => undefined);
    });
  }

  /** paint lays out one element per character and marks the changed digits. */
  private paint(
    next: string,
    previous: string | null,
  ): { roll: HTMLElement; rightIndex: number }[] {
    const oldChars = previous === null ? [] : [...previous];
    const newChars = [...next];
    const rolls: { roll: HTMLElement; rightIndex: number }[] = [];
    newChars.forEach((character, index) => {
      const rightIndex = newChars.length - 1 - index;
      const oldIndex = oldChars.length - 1 - rightIndex;
      const oldCharacter = oldIndex >= 0 ? oldChars[oldIndex] : "";
      const moves =
        previous !== null &&
        isDigit(character) &&
        oldCharacter !== character &&
        (oldCharacter === "" || isDigit(oldCharacter));
      const roll = el("span", { class: "hn-roll", text: character });
      if (moves) {
        roll.setAttribute("data-from", oldCharacter);
        rolls.push({ roll, rightIndex });
      }
      this.host.append(el("span", { class: "hn-char" }, [roll]));
    });
    return rolls;
  }
}

/** fadeIn plays the short fade the Reserve met line appears with. */
export const fadeIn = (node: HTMLElement): void => {
  if (reducedMotion()) return;
  const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 220,
    easing: "ease-out",
  });
  animation.finished.then(() => animation.cancel()).catch(() => undefined);
};
