// A split case as a ruled manifest block: giant units-to-go numeral, unit grid, state in words
// and the household's controls. Drawing is split between `draw` (straight to a line, used by
// refreshes and reduced motion) and `fill` (the household's own confirmed change, animated). The
// crate beside the grid shows the same line, through the same two doors.
import { Crate } from "./crate/crate.js";
import { h, money, reducedMotion } from "./dom.js";
import { CELL_MS, COUNT_MS, FRAME_MS, GLIDE_MS, planFill } from "./fill-plan.js";
import { gridColumns, type Line, onSealedSide } from "./line.js";

const EASE = "cubic-bezier(.55,0,.15,1)";

const STATE_WORD: Record<Line["status"], string> = { filling: "", sealed: "Sealed", taken_up: "TAKEN UP", dropped: "DROPPED" };

interface BlockActions {
  pledge(block: CaseBlock): void;
  withdraw(block: CaseBlock): void;
}

export class CaseBlock {
  readonly el: HTMLElement;
  line: Line;
  /** The server version this block was last drawn from. */
  version: number;
  stepped = false;
  inFlight = false;
  accepting = true;
  /** The pledge controls take input: the cycle accepts pledges and the case is not dropped. */
  live = true;
  private readonly cells: HTMLElement[];
  private readonly grid: HTMLElement;
  private readonly numeral: HTMLElement;
  private readonly stateEl: HTMLElement;
  readonly crate: Crate;
  private shownSealed: boolean;
  private readonly yoursEl: HTMLElement;
  private readonly noticeEl: HTMLElement;
  readonly spin: HTMLInputElement;
  readonly fewer: HTMLButtonElement;
  readonly more: HTMLButtonElement;
  readonly pledgeButton: HTMLButtonElement;
  readonly withdrawButton: HTMLButtonElement;
  private timers: number[] = [];

  constructor(line: Line, actions: BlockActions) {
    this.line = line;
    this.version = line.version;
    this.shownSealed = onSealedSide(line);
    this.crate = new Crate(line);
    const name = line.case_name;
    const headingId = `case-${line.product_id}`;
    this.cells = line.cells.map((c) => h("span", { class: "cell", "data-cell": c }));
    this.grid = h("div", { class: "unit-grid", role: "img" }, ...this.cells);
    const columns = gridColumns(line.pack);
    this.grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, var(--cell, 1fr)))`;
    this.grid.style.setProperty("--rows", String(line.pack / columns));
    this.numeral = h("span", { class: "numeral-value" });
    this.stateEl = h("p", { class: "case-state" });
    this.yoursEl = h("p", { class: "yours" });
    this.noticeEl = h("p", { class: "case-notice", hidden: true });
    this.spin = h("input", {
      class: "spin",
      type: "number",
      inputmode: "numeric",
      min: 0,
      step: 1,
      "aria-label": `Units of ${name}`,
      onkeydown: (event: KeyboardEvent) => this.onKey(event),
      oninput: () => {
        const value = Number.parseInt(this.spin.value, 10);
        this.stepped = true;
        if (Number.isFinite(value)) this.spin.value = String(this.clamp(value));
      },
    });
    this.fewer = h("button", { type: "button", class: "step", "aria-label": `Fewer units of ${name}`, onclick: () => this.step(-1) }, "−");
    this.more = h("button", { type: "button", class: "step", "aria-label": `More units of ${name}`, onclick: () => this.step(1) }, "+");
    this.pledgeButton = h("button", { type: "button", class: "button primary", "aria-label": `Pledge ${name}`, onclick: () => actions.pledge(this) }, "Pledge");
    this.withdrawButton = h("button", { type: "button", class: "button quiet", "aria-label": `Withdraw from ${name}`, onclick: () => actions.withdraw(this) }, "Withdraw");
    this.el = h(
      "article",
      { class: "case", "aria-labelledby": headingId, "data-product": line.product_id },
      h("header", { class: "case-head" },
        h("h2", { id: headingId, class: "case-name" }, name),
        h("p", { class: "case-price" }, h("span", { class: "label" }, "CASE"), " ", money(line.price_cents), " ",
          h("span", { class: "per" }, `${line.pack} × ${line.unit}`)),
        this.stateEl),
      h("p", { class: "numeral" }, this.numeral, " ", h("span", { class: "numeral-label" }, "to go")),
      h("div", { class: "case-picture" }, this.grid, this.crate.el),
      this.yoursEl,
      this.noticeEl,
      h("div", { class: "case-controls" },
        h("div", { class: "stepper" }, this.fewer, this.spin, this.more),
        this.pledgeButton,
        this.withdrawButton),
    );
    this.draw(line);
  }

  /** A line is drawn only when its version is newer than the one shown. */
  isNewer(line: Line): boolean {
    return line.version > this.version;
  }

  get name(): string {
    return this.line.case_name;
  }

  get max(): number {
    return (this.line.my_units ?? 0) + this.line.units_to_go;
  }

  get value(): number {
    return Number.parseInt(this.spin.value, 10) || 0;
  }

  private clamp(n: number): number {
    return Math.min(Math.max(n, 0), this.max);
  }

  private step(delta: number): void {
    if (!this.live) return;
    this.spin.value = String(this.clamp(this.value + delta));
    this.stepped = true;
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.live) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      this.spin.value = String(event.key === "Home" ? 0 : this.max);
      this.stepped = true;
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      this.step(event.key === "ArrowUp" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.pledgeButton.click();
    }
  }

  /** Which units the household holds, in words, and its short-shipment notice. */
  private drawYours(line: Line): void {
    const mine = line.my_units ?? 0;
    this.yoursEl.replaceChildren(
      h("span", { class: "label" }, "YOURS"), " ",
      mine ? `${mine} ${line.unit}${mine === 1 ? "" : "s"}` : "None yet",
    );
    const short = line.my_short_units ?? 0;
    this.noticeEl.hidden = short === 0;
    this.noticeEl.textContent = short
      ? `Short shipment: ${short} of your ${mine} units didn't arrive. You won't be charged for them.`
      : "";
  }

  /** The state classes, state word, numeral, grid label and every cell, straight to a line. */
  draw(line: Line): void {
    this.cancel();
    this.line = line;
    this.version = line.version;
    this.crate.show(line);
    line.cells.forEach((c, i) => this.cells[i]!.setAttribute("data-cell", c));
    this.setNumeral(line.units_to_go);
    this.drawFrame(line);
    this.drawSpin();
    this.drawYours(line);
  }

  /** The numeral and its digit count, which sizes it to span most of the block. */
  private setNumeral(n: number): void {
    this.numeral.textContent = String(n);
    this.numeral.dataset.digits = String(String(n).length);
  }

  private drawFrame(line: Line): void {
    this.shownSealed = onSealedSide(line);
    this.grid.setAttribute("aria-label", `${line.pledged_units} of ${line.pack} units pledged`);
    this.el.classList.toggle("is-sealed", line.status === "sealed");
    this.el.classList.toggle("is-taken", line.status === "taken_up");
    this.el.classList.toggle("is-dropped", line.status === "dropped");
    this.stateEl.textContent = STATE_WORD[line.status];
    this.stateEl.hidden = line.status === "filling";
    this.setControls(this.accepting);
  }

  /** Maximum follows the server; a stepped value is kept unless it now exceeds it. */
  drawSpin(): void {
    this.spin.max = String(this.max);
    this.spin.setAttribute("aria-valuemax", String(this.max));
    if (!this.stepped) this.spin.value = String(this.line.my_units ?? 0);
    else if (this.value > this.max) this.spin.value = String(this.max);
  }

  setControls(accepting: boolean): void {
    this.accepting = accepting;
    const live = accepting && this.line.status !== "dropped";
    this.live = live;
    this.spin.readOnly = !live;
    for (const control of [this.spin, this.fewer, this.more, this.pledgeButton, this.withdrawButton]) {
      control.setAttribute("aria-disabled", String(!live));
      control.classList.toggle("off", !live);
    }
    const hasPledge = (this.line.my_units ?? 0) > 0;
    if (!hasPledge && document.activeElement === this.withdrawButton) this.spin.focus();
    this.withdrawButton.hidden = !hasPledge;
  }

  /** After the household's own response: the stepped value gives way to the server's units. */
  settleSpin(): void {
    this.stepped = false;
    this.drawSpin();
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private cancel(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  }

  /** Removes the block's crate from the page's single list of crates. */
  destroy(): void {
    this.cancel();
    this.crate.destroy();
  }

  /**
   * Fill the case: changed cells one after another in reading order (backwards for a reduction),
   * then the numeral counts one integer at a time, then the frame thickens and the block moves.
   * An unsealing change runs that last step first. `move` places the block in its new container;
   * it runs once the frame has changed. The crate follows the same timeline.
   */
  fill(next: Line, move: (() => void) | null): void {
    if (reducedMotion()) {
      this.draw(next);
      move?.();
      return;
    }
    this.cancel();
    const from = Number(this.numeral.textContent);
    const shown = this.cells.map((c) => c.getAttribute("data-cell") as Line["cells"][number]);
    const plan = planFill(this.line, this.shownSealed, next, shown, from);
    this.line = next;
    this.version = next.version;
    this.grid.setAttribute("aria-label", `${next.pledged_units} of ${next.pack} units pledged`);
    this.crate.play(next, plan.crate);
    this.drawSpin();
    this.drawYours(next);
    this.setControls(this.accepting);
    for (const { index, at } of plan.cells) {
      this.later(at, () => {
        const cell = this.cells[index]!;
        cell.setAttribute("data-cell", next.cells[index]!);
        cell.animate([{ transform: "scale(.55)" }, { transform: "scale(1)" }], { duration: CELL_MS, easing: EASE });
      });
    }
    const steps = Math.abs(next.units_to_go - from);
    for (let k = 1; k <= steps; k++) {
      this.later(plan.countAt + (k * COUNT_MS) / steps, () => {
        this.setNumeral(from + Math.sign(next.units_to_go - from) * k);
      });
    }
    if (plan.stepAt === null) {
      this.drawFrame(next);
      return;
    }
    this.later(plan.stepAt, () => this.sealStep(next, move));
  }

  /** The seal step's block half: the frame and colour change, then the block glides to its place. */
  private sealStep(next: Line, move: (() => void) | null): void {
    const style = getComputedStyle(this.el);
    const was = { outlineWidth: style.outlineWidth, backgroundColor: style.backgroundColor, color: style.color };
    this.drawFrame(next);
    if (!move) return;
    const now = getComputedStyle(this.el);
    const frames: Keyframe[] = [was, { outlineWidth: now.outlineWidth, backgroundColor: now.backgroundColor, color: now.color }];
    if (!matchMedia("(min-width: 768px)").matches) {
      frames[0] = { ...frames[0], transform: "translateX(0)", opacity: 1 };
      frames[1] = { ...frames[1], transform: "translateX(48px)", opacity: 0 };
    }
    this.el.animate(frames, { duration: FRAME_MS, easing: EASE, fill: "forwards" });
    this.later(FRAME_MS, () => {
      this.el.getAnimations().forEach((a) => a.cancel());
      const first = this.el.getBoundingClientRect();
      move();
      const last = this.el.getBoundingClientRect();
      if (last.width === 0) return;
      this.el.animate(
        [{ transform: `translate(${first.left - last.left}px, ${first.top - last.top}px)` }, { transform: "none" }],
        { duration: GLIDE_MS, easing: EASE },
      );
    });
  }
}
