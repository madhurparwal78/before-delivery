import { api, ApiError, Line, newIdempotencyKey, NetworkError } from "../api.js";
import { el, reducedMotion, Unsubscribe } from "../util.js";
import { announce } from "../live.js";
import { openDialog } from "../dialog.js";
import { crateName, gridColumns, lineIsNewer } from "../crate/crate.js";
import { crateManager } from "../crate/manager.js";
import { cancelSequence, runFillSequence, sequenceRunning } from "../fx.js";

export interface BlockHooks {
  getCycleId(): string;
  isAccepting(): boolean;
  setCredit(credit: unknown): void;
  cutoffRefusal(): void;
  panelShown(block: CaseBlock): boolean;
  /** The block's sealed state changed: move it and follow the focus rules. */
  sealChange(block: CaseBlock, nowSealed: boolean, animated: boolean): void;
}

/**
 * One case block: manifest block, unit grid, crate, controls and dialogs. The
 * one place per block that keeps its shown line, stepped value and turn.
 */
export class CaseBlock {
  readonly productId: string;
  readonly caseKey: string;
  line: Line;
  shownVersion: number;
  stepped: number | null = null;
  turn = 0;
  article!: HTMLElement;
  numeralEl!: HTMLElement;
  gridEl!: HTMLElement;
  cells: HTMLElement[] = [];
  canvas!: HTMLCanvasElement;
  slider!: HTMLElement;
  spinbutton!: HTMLInputElement;
  pledgeBtn!: HTMLButtonElement;
  pledgeControls!: HTMLElement;
  private stateText!: HTMLElement;
  private withdrawBtn: HTMLButtonElement | null = null;
  private attempt: { key: string; units: number; networkFailed: boolean } | null = null;
  private inFlight = false;
  private unsubs: Unsubscribe[] = [];
  private readonly hooks: BlockHooks;

  constructor(line: Line, hooks: BlockHooks) {
    this.productId = line.product_id;
    this.caseKey = line.product_id;
    this.hooks = hooks;
    this.line = line;
    this.shownVersion = line.version;
  }

  build(): HTMLElement {
    const line = this.line;
    const priceDollars = (line.price_cents / 100).toFixed(2);
    const perUnit = (Math.floor(line.price_cents / line.pack) / 100).toFixed(2);
    this.article = el("article", { class: "case-block", "data-product": line.product_id });
    this.stateText = el("p", { class: "state-text" });
    this.numeralEl = el("div", { class: "numeral" });
    this.gridEl = el("div", {
      class: "unit-grid",
      role: "img",
      "aria-label": `${line.pledged_units} of ${line.pack} units pledged`,
      style: { gridTemplateColumns: `repeat(${gridColumns(line.pack)}, 1fr)` },
    });
    for (let i = 0; i < line.pack; i++) {
      const cell = el("div", { class: "cell", "data-cell": line.cells[i] });
      this.cells.push(cell);
      this.gridEl.append(cell);
    }
    this.canvas = el("canvas", {
      class: "crate-canvas",
      role: "img",
      "aria-label": crateName(line),
    });
    this.slider = el("div", {
      class: "turn-strip",
      role: "slider",
      tabindex: "0",
      "aria-label": `Turn crate of ${line.case_name}`,
      "aria-valuemin": "-75",
      "aria-valuemax": "75",
      "aria-valuenow": "0",
    });
    this.slider.append(
      el("span", { class: "label", text: "TURN" }),
      el("span", { class: "ticks", text: "-75      0      75" })
    );
    this.spinbutton = el("input", { type: "number", min: "0", value: String(line.my_units ?? 0) }) as HTMLInputElement;
    this.spinbutton.setAttribute("aria-label", `Units of ${line.case_name}`);
    const fewer = el("button", { class: "step", text: "−", "aria-label": `Fewer units of ${line.case_name}` });
    const more = el("button", { class: "step", text: "+", "aria-label": `More units of ${line.case_name}` });
    this.pledgeBtn = el("button", { text: "Pledge", "aria-label": `Pledge ${line.case_name}` });
    this.pledgeControls = el("div", { class: "pledge-controls" },
      el("div", { class: "stepper" }, fewer, this.spinbutton, more),
      this.pledgeBtn
    );
    const crateFigure = el("div", { class: "crate-figure" }, this.canvas);
    this.article.append(
      el("div", { class: "case-title" },
        el("h2", { text: line.case_name }),
        el("span", { class: "case-price", text: `$${priceDollars} · $${perUnit} per ${line.unit}` })
      ),
      this.stateText,
      this.numeralEl,
      this.gridEl,
      el("div", { class: "crate-side" }, crateFigure, this.slider),
      this.pledgeControls,
      el("span", { class: "my-units", text: "" })
    );

    fewer.addEventListener("click", () => this.step(-1));
    more.addEventListener("click", () => this.step(1));
    this.spinbutton.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.step(1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.step(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        this.setStepped(0);
      } else if (e.key === "End") {
        e.preventDefault();
        this.setStepped(this.maxUnits());
      } else if (e.key === "Enter") {
        e.preventDefault();
        void this.pledge();
      }
    });
    this.spinbutton.addEventListener("input", () => {
      const v = parseInt(this.spinbutton.value, 10);
      if (!Number.isNaN(v)) this.stepped = v;
    });
    this.pledgeBtn.addEventListener("click", () => void this.pledge());
    this.bindTurnControls();

    crateManager.register({
      caseKey: this.caseKey,
      canvas: this.canvas,
      line: this.line,
      turn: this.turn,
      blockBg: () => (this.line.status === "sealed" || this.line.status === "taken_up" ? "green" : "kraft"),
    });
    this.redrawStatic();
    return this.article;
  }

  maxUnits(): number {
    return (this.line.my_units ?? 0) + this.line.units_to_go;
  }

  spinValue(): number {
    return this.stepped !== null ? Math.min(this.stepped, this.maxUnits()) : this.line.my_units ?? 0;
  }

  /** Applies a newer line; the version rule is decided in one place. */
  applyLine(newLine: Line, opts: { sequence: boolean }): void {
    if (!lineIsNewer(this.shownVersion, newLine.version)) return;
    const oldLine = this.line;
    const wasSealed = oldLine.status === "sealed" || oldLine.status === "taken_up";
    if (opts.sequence && sequenceRunning(this)) {
      // A new own response snaps the running sequence to its end first.
      cancelSequence(this);
      this.redrawStatic();
      this.panelDraw("line");
    }
    this.line = newLine;
    this.shownVersion = newLine.version;
    const nowSealed = newLine.status === "sealed" || newLine.status === "taken_up";
    if (opts.sequence && !reducedMotion()) {
      runFillSequence(this, oldLine, newLine, () =>
        this.hooks.sealChange(this, nowSealed, true)
      );
    } else {
      cancelSequence(this);
      this.redrawStatic();
      this.panelDraw("line");
      this.hooks.sealChange(this, nowSealed, false);
    }
  }

  /** Redraws every static part of the block from its shown line. */
  redrawStatic(): void {
    const line = this.line;
    this.article.classList.toggle("sealed-block", line.status === "sealed" || line.status === "taken_up");
    this.article.classList.toggle("dropped-block", line.status === "dropped");
    this.stateText.textContent =
      line.status === "sealed" ? "Sealed"
      : line.status === "taken_up" ? "TAKEN UP"
      : line.status === "dropped" ? "DROPPED"
      : "";
    this.numeralEl.textContent = "";
    this.numeralEl.append(
      document.createTextNode(String(line.units_to_go)),
      el("span", { class: "to-go-words", text: " to go" })
    );
    this.gridEl.setAttribute("aria-label", `${line.pledged_units} of ${line.pack} units pledged`);
    this.cells.forEach((cell, i) => cell.setAttribute("data-cell", line.cells[i]));
    this.canvas.setAttribute("aria-label", crateName(line));
    const myUnits = line.my_units ?? 0;
    (this.article.querySelector(".my-units") as HTMLElement).textContent =
      myUnits > 0 ? `Your units: ${myUnits}` : "";
    this.updateWithdraw(myUnits > 0);
    const disabled = line.status === "dropped" || !this.hooks.isAccepting();
    this.pledgeBtn.toggleAttribute("disabled", disabled || this.inFlight);
    this.spinbutton.toggleAttribute("disabled", disabled);
    this.updateMax();
  }

  updateMax(): void {
    const max = this.maxUnits();
    this.spinbutton.setAttribute("aria-valuemax", String(max));
    this.spinbutton.setAttribute("max", String(max));
    if (this.stepped !== null) {
      if (this.stepped > max) {
        this.stepped = max;
        this.spinbutton.value = String(max);
      }
      this.spinbutton.setAttribute("aria-valuenow", String(this.spinValue()));
    } else {
      const v = this.line.my_units ?? 0;
      this.spinbutton.value = String(v);
      this.spinbutton.setAttribute("aria-valuenow", String(v));
    }
  }

  private setStepped(value: number): void {
    const v = Math.max(0, Math.min(this.maxUnits(), value));
    this.stepped = v;
    this.spinbutton.value = String(v);
    this.spinbutton.setAttribute("aria-valuenow", String(v));
  }

  private step(delta: number): void {
    this.setStepped(this.spinValue() + delta);
  }

  setTurn(deg: number, draw: boolean): void {
    const clamped = Math.max(-75, Math.min(75, Math.round(deg)));
    this.turn = clamped;
    this.slider.setAttribute("aria-valuenow", String(clamped));
    if (draw) void crateManager.draw(this.caseKey, "turn");
  }

  panelDraw(cause: "line" | "shown" | "size" | "first" | "font" | "context-restored"): void {
    if (!this.hooks.panelShown(this) && cause !== "shown") return;
    void crateManager.draw(this.caseKey, cause);
  }

  private bindTurnControls(): void {
    const strip = this.slider;
    let stripDragging = false;
    const setFromStrip = (clientX: number) => {
      const rect = strip.getBoundingClientRect();
      const frac = (clientX - rect.left) / Math.max(1, rect.width);
      this.setTurn(-75 + frac * 150, true);
    };
    strip.addEventListener("pointerdown", (e) => {
      stripDragging = true;
      strip.setPointerCapture(e.pointerId);
      setFromStrip(e.clientX);
    });
    strip.addEventListener("pointermove", (e) => {
      if (stripDragging) setFromStrip(e.clientX);
    });
    strip.addEventListener("pointerup", () => {
      stripDragging = false;
    });
    strip.addEventListener("keydown", (e) => {
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") next = this.turn + 15;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = this.turn - 15;
      else if (e.key === "Home") next = -75;
      else if (e.key === "End") next = 75;
      if (next === null) return;
      e.preventDefault();
      this.setTurn(next, true);
    });

    let penDrag: { lastX: number } | null = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" || e.pointerType === "pen") {
        penDrag = { lastX: e.clientX };
        this.canvas.setPointerCapture(e.pointerId);
      }
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (penDrag) {
        const dx = e.clientX - penDrag.lastX;
        penDrag.lastX = e.clientX;
        this.setTurn(this.turn + dx * 0.5, true);
      }
    });
    this.canvas.addEventListener("pointerup", () => {
      penDrag = null;
    });

    let touch: { lastX: number; decided: boolean; turning: boolean } | null = null;
    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches[0];
        touch = { lastX: t.clientX, decided: false, turning: false };
      },
      { passive: true }
    );
    this.canvas.addEventListener(
      "touchmove",
      (e) => {
        if (!touch) return;
        const t = e.touches[0];
        const dx = t.clientX - touch.lastX;
        if (!touch.decided) {
          touch.decided = true;
          // The gesture's dominant axis decides on its first real move.
          if (Math.abs(dx) < 4) return;
        }
        if (!touch.turning) {
          if (Math.abs(dx) >= 4) touch.turning = true;
          else return;
        }
        e.preventDefault();
        touch.lastX = t.clientX;
        this.setTurn(this.turn + dx * 0.5, true);
      },
      { passive: false }
    );
    this.canvas.addEventListener("touchend", () => {
      touch = null;
    });
  }

  private updateWithdraw(has: boolean): void {
    const existing = this.pledgeControls.querySelector("button.withdraw");
    if (has && !existing) {
      const btn = el("button", {
        class: "withdraw",
        text: "Withdraw",
        "aria-label": `Withdraw from ${this.line.case_name}`,
        onclick: () => this.withdrawDialog(),
      });
      this.pledgeControls.append(btn);
      this.withdrawBtn = btn as HTMLButtonElement;
    } else if (!has && existing) {
      existing.remove();
      this.withdrawBtn = null;
    }
  }

  private withdrawDialog(): void {
    const myUnits = this.line.my_units ?? 0;
    openDialog({
      label: "Withdraw pledge",
      returnFocusTo: this.withdrawBtn ?? undefined,
      onClose: () => {},
      build: (body, close) => {
        const keep = el("button", { text: "Keep pledge" });
        const withdraw = el("button", { text: "Withdraw" });
        body.append(
          el("h2", { text: "Withdraw pledge" }),
          el("p", { text: `Withdraw your ${myUnits} from ${this.line.case_name}?` }),
          el("div", { class: "actions" }, keep, withdraw)
        );
        keep.addEventListener("click", close);
        withdraw.addEventListener("click", () => {
          close();
          void this.withdraw();
        });
        keep.focus();
      },
    });
  }

  async pledge(): Promise<void> {
    const units = this.spinValue();
    if (units === 0 && (this.line.my_units ?? 0) > 0) {
      this.withdrawDialog();
      return;
    }
    if (this.inFlight || this.pledgeBtn.hasAttribute("disabled")) return;
    this.inFlight = true;
    this.pledgeBtn.setAttribute("disabled", "");
    this.pledgeBtn.textContent = "Saving...";
    let key: string;
    if (this.attempt && this.attempt.networkFailed && this.attempt.units === units) {
      key = this.attempt.key;
    } else {
      key = newIdempotencyKey();
    }
    this.attempt = { key, units, networkFailed: false };
    try {
      const { data } = await api<{ line: Line; credit: unknown }>(
        `/api/cycles/${this.hooks.getCycleId()}/lines/${this.productId}/pledge`,
        { method: "PUT", body: JSON.stringify({ units }), idempotencyKey: key }
      );
      this.attempt = null;
      this.hooks.setCredit(data.credit);
      const line = data.line;
      const caseName = this.line.case_name;
      announce(
        "pledge",
        line.status === "sealed"
          ? `Pledged ${units} of ${caseName}. Case sealed.`
          : `Pledged ${units} of ${caseName}. ${line.units_to_go} to go.`
      );
      this.stepped = null;
      this.applyLine(line, { sequence: true });
    } catch (e) {
      this.handlePledgeError(e, key, units);
    } finally {
      this.inFlight = false;
      this.pledgeBtn.removeAttribute("disabled");
      this.pledgeBtn.textContent = "Pledge";
      this.redrawStatic();
      if ((document.activeElement === document.body || document.activeElement === null) && this.article.isConnected) {
        this.spinbutton.focus();
      }
    }
  }

  private handlePledgeError(e: unknown, key: string, units: number): void {
    if (e instanceof NetworkError) {
      this.attempt = { key, units, networkFailed: true };
      announce("pledge", `Couldn't confirm your pledge on ${this.line.case_name}. Check your connection and try again.`);
      return;
    }
    if (!(e instanceof ApiError)) return;
    this.attempt = null;
    if (e.code === "cutoff_passed") {
      this.hooks.cutoffRefusal();
      announce("pledge", `Cutoff has passed. ${this.line.case_name} was not changed.`);
    } else if (e.code === "not_enough_units") {
      const toGoRaw = e.fields?.["units_to_go"];
      const toGo = toGoRaw !== undefined ? parseInt(toGoRaw, 10) : this.line.units_to_go;
      announce("pledge", `Only ${toGo} left on ${this.line.case_name}. Your pledge was not changed.`);
    } else if (e.code === "insufficient_credit") {
      announce("pledge", `Not enough credit for ${this.line.case_name}. Top up to pledge more.`);
    }
  }

  async withdraw(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const key = this.attempt?.networkFailed ? this.attempt.key : newIdempotencyKey();
    this.attempt = { key, units: 0, networkFailed: false };
    try {
      const { data } = await api<{ line: Line; credit: unknown }>(
        `/api/cycles/${this.hooks.getCycleId()}/lines/${this.productId}/pledge`,
        { method: "DELETE", idempotencyKey: key }
      );
      this.attempt = null;
      this.hooks.setCredit(data.credit);
      const line = data.line;
      announce("pledge", `Withdrew from ${this.line.case_name}. ${line.units_to_go} to go.`);
      this.applyLine(line, { sequence: true });
    } catch (e) {
      if (e instanceof NetworkError) {
        this.attempt = { key, units: 0, networkFailed: true };
        announce("pledge", `Couldn't confirm your pledge on ${this.line.case_name}. Check your connection and try again.`);
      } else if (e instanceof ApiError) {
        this.attempt = null;
        if (e.code === "cutoff_passed") {
          this.hooks.cutoffRefusal();
          announce("pledge", `Cutoff has passed. ${this.line.case_name} was not changed.`);
        }
      }
    } finally {
      this.inFlight = false;
      this.redrawStatic();
      if ((document.activeElement === document.body || document.activeElement === null) && this.article.isConnected) {
        this.spinbutton.focus();
      }
    }
  }

  destroy(): void {
    crateManager.unregister(this.caseKey);
    for (const u of this.unsubs) u();
  }
}
