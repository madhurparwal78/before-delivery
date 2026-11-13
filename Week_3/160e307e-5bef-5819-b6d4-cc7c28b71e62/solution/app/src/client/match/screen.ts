import { app } from "../app";
import { ApiFail } from "../api";
import { formatClock, h, reducedMotion, setText } from "../dom";
import { icon } from "../icons";
import { BASELINE_Y, BOARD_MM, BREAK_ATTEMPTS, EMOTES, MAX_OFFSET, TIMEOUTS_TO_FORFEIT, baselineY, otherSeat } from "../../shared/constants";
import { boardLabel, coinsLeftText, coinsOnBoard, queenStatusText } from "../../shared/rules";
import { aimDirection, aimGuide, placementLegal, strikerSpot } from "../../shared/shot";
import type { PieceId, PieceState, Seat, ShotIntent } from "../../shared/types";
import { createBoard } from "./art";
import type { BoardParts } from "./art";
import { boardOverSheet, matchOverDialog, menuDialog, resignDialog, rulesDialog } from "./dialogs";
import type { MatchOverHandle } from "./dialogs";
import { play } from "./playback";
import type { Running, Spot } from "./playback";
import type { MatchView, RulingView } from "./view";

/** The match screen: one full-viewport field in the shooter's colour, the board, the rail and the aiming controls. */

interface ScreenCallbacks {
  shoot: (intent: ShotIntent, seq: number) => Promise<RulingView>;
  preview: (preview: { x: number; dx: number; dy: number; p: number }) => void;
  emote: (emote: string) => void;
  rematch: (accept: boolean) => void;
  resync: () => void;
  /** pass and play: the finished match is sent to the server or kept on the device */
  finished: (view: MatchView, notify: (status: string, chalk: string | null) => void) => void;
  resignHere: () => void;
}

interface ScreenOptions {
  mode: "online" | "local";
  viewer: Seat | null;
  rotateBoard: boolean;
  look: { board: string; coins: string };
  callbacks: ScreenCallbacks;
}

type Phase = "waiting" | "aim" | "refereeing" | "moving" | "board-over" | "match-over";

const SHOT_ERRORS: Record<string, string> = {
  NOT_YOUR_TURN: "It's not your turn.",
  TURN_EXPIRED: "Time ran out. The turn has passed.",
  ILLEGAL_PLACEMENT: "Striker overlaps a coin.",
  INVALID_INTENT: "That shot isn't valid. Aim again.",
  RATE_LIMITED: "Too many moves. Wait a moment.",
  CLIENT_OUTDATED: "A new version is available. Reload to keep playing.",
};

const WIPE_MS = 520;
const BANNER_IN_MS = 200;
const BANNER_OUT_MS = 150;
const TURN_MS = 500;
const CROSSFADE_MS = 150;
const PULL_SHARE = 0.4;
const CANCEL_PX = 8;
const GRAB_MM = 30;
const PREVIEW_EVERY_MS = 1000 / 15;
const EMOTE_SHOWN_MS = 3000;
const LOW_CLOCK_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function signed(delta: number): string {
  const whole = Math.round(delta);
  return whole > 0 ? `+${whole}` : String(whole);
}

export class MatchScreen {
  readonly element: HTMLElement;
  private readonly options: ScreenOptions;
  private view: MatchView;
  private readonly parts: BoardParts;
  private phase: Phase = "aim";
  private seq: number;
  private aim = { offset2: 0, angle10: 0, power: 0 };
  private chain: Promise<void> = Promise.resolve();
  private jobs = 0;
  private running: Running | null = null;
  private rotating = false;
  private legal = true;
  private bannerToken = 0;
  private pulse = false;
  private clockEnd: number | null = null;
  private opponentGone: { name: string; endsAt: number } | null = null;
  private previewTimer: number | undefined;
  private lastPreviewAt = -Infinity;
  private pendingPreview: { x: number; dx: number; dy: number; p: number } | null = null;
  private gesture: { kind: "slide" | "pull"; startX: number; startY: number; startOffset2: number; rect: DOMRect } | null = null;
  private matchOver: MatchOverHandle | null = null;
  private readonly timers: number[] = [];
  private emoteTimer: number | undefined;
  private toGhost: { x: number; dx: number; dy: number; p: number } | null = null;
  private readonly keys: (event: KeyboardEvent) => void;

  private readonly el: Record<string, HTMLElement> = {};

  constructor(options: ScreenOptions, initial: MatchView) {
    this.options = options;
    this.view = initial;
    this.seq = initial.shotSeq;
    this.parts = createBoard({
      boardTheme: options.look.board,
      coins: options.look.coins,
      strikerSkin: initial.seats[initial.turn].strikerSkin,
      live: true,
    });
    this.element = this.build();
    this.keys = (event) => this.onKey(event);
    this.element.addEventListener("keydown", this.keys);
    this.render(true);
    if (initial.toss && initial.shotSeq === 0 && !initial.finished) this.announce(initial.toss);
  }

  // ------------------------------------------------------------------------------------------
  // structure

  private build(): HTMLElement {
    const online = this.options.mode === "online";
    const make = <K extends keyof HTMLElementTagNameMap>(id: string, tag: K, attrs: Record<string, string | number | boolean> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
      const node = h(tag, { id, ...attrs }, ...kids);
      this.el[id] = node;
      return node;
    };

    const seatBlock = (seat: Seat): HTMLElement =>
      h(
        "div",
        { class: `seat seat-${seat}` },
        h("span", { class: "seat-chip", "aria-hidden": "true" }),
        make(`name-${seat}`, "p", { class: "seat-name" }),
        make(`score-${seat}`, "p", { class: "seat-score" }),
        make(`coins-left-${seat}`, "p", { class: "seat-line" }),
        make(`dues-${seat}`, "p", { class: "seat-line" }),
      );

    const slider = (id: string, label: string, min: number, max: number, step: number, readout: string, handler: (value: number) => void, cls = ""): HTMLElement => {
      const input = make(id, "input", { type: "range", min, max, step, value: 0, class: `slider ${cls}`, "aria-label": label });
      input.addEventListener("input", () => handler(Number((input as HTMLInputElement).value)));
      return h("div", { class: "control" }, h("div", { class: "control-head" }, h("label", { for: id }, label), make(readout, "span", { class: "readout" })), input);
    };

    const board = this.parts.svg;
    board.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    board.addEventListener("pointermove", (event) => this.onPointerMove(event));
    board.addEventListener("pointerup", (event) => this.onPointerUp(event));
    board.addEventListener("pointercancel", () => this.endGesture(false));

    const menu = make("menu", "button", { type: "button", class: "btn btn-small", "aria-haspopup": "dialog" }, icon("menu", 20), h("span", {}, "Menu"));
    menu.addEventListener("click", () =>
      menuDialog(menu, {
        rules: () => rulesDialog(menu),
        resign: () => resignDialog(menu, () => this.options.callbacks.resignHere()),
      }),
    );
    const emotes = online ? make("emotes", "button", { type: "button", class: "btn btn-small", "aria-haspopup": "menu", "aria-expanded": "false" }, icon("message", 20), h("span", {}, "Emotes")) : null;
    const emoteMenu = online
      ? make("emote-menu", "div", { role: "menu", "aria-label": "Emotes", class: "emote-menu", hidden: true }, ...EMOTES.map(([id, label]) => h("button", { type: "button", role: "menuitem", class: "btn btn-small", tabindex: -1, "data-emote": id }, label)))
      : null;
    if (emotes && emoteMenu) this.wireEmotes(emotes, emoteMenu);

    const shoot = make("shoot", "button", { type: "button", class: "btn btn-ink btn-shoot" }, "Shoot");
    shoot.addEventListener("click", () => void this.fire());
    const skip = make("skip-shot", "button", { type: "button", class: "btn", hidden: true }, "Skip shot");
    skip.addEventListener("click", () => this.running?.skip());

    const rotator = make("board-rotator", "div", { class: "board-rotator", "data-rotation": 0 }, board);
    const stage = h(
      "div",
      { class: "stage" },
      h("div", { class: "board-wrap" }, rotator),
      make("verdict", "div", { class: "verdict", role: "status", "aria-live": "off", hidden: true }, make("verdict-word", "p", { class: "verdict-word" }), make("verdict-line", "p", { class: "verdict-line" })),
      make("reconnect-overlay", "div", { class: "reconnect", hidden: true }),
      make("emote-bubble", "p", { class: "emote-bubble", hidden: true }),
    );

    const root = make("match-root", "div", { class: "match", "data-phase": "aim", "data-turn": 0, "data-field": "tomato", "data-board": 1, "data-shot-seq": 0 },
      h("div", { class: "opp-name", "aria-hidden": "true" }),
      h(
        "header",
        { class: "match-top" },
        h("div", { class: "turnline" }, make("turn-text", "p", { class: "turn-text" }), make("referee-note", "span", { class: "referee-note", hidden: true }, "Refereeing...")),
        h("div", { class: "labels" }, make("board-label", "span", { class: "board-label" }), make("break-label", "span", { class: "break-label" })),
        online ? make("shot-timer", "div", { role: "timer", "aria-label": "Shot clock", class: "shot-timer" }, "0:00") : null,
        h("div", { class: "top-buttons" }, menu, emotes),
        emoteMenu,
      ),
      h("section", { class: "rail", "aria-label": "Score rail" }, seatBlock(0), seatBlock(1), make("queen-status", "p", { class: "queen-status" })),
      stage,
      h(
        "section",
        { class: "controls", "aria-label": "Aiming controls" },
        slider("striker-slider", "Striker position", -MAX_OFFSET, MAX_OFFSET, 0.5, "striker-readout", (v) => this.setOffset2(Math.round(v * 2), true), "slider-striker"),
        slider("aim-slider", "Aim angle", -180, 180, 0.1, "aim-readout", (v) => this.setAngle10(Math.round(v * 10))),
        slider("power-slider", "Power", 0, 100, 1, "power-readout", (v) => this.setPower(Math.round(v) * 10)),
        h("div", { class: "fire" }, shoot, skip),
        h("div", { class: "messages" }, make("placement-message", "p", { class: "message" }), make("shot-error", "p", { class: "message", role: "alert" })),
      ),
      make("announcer", "div", { role: "log", "aria-label": "Match announcements", "aria-live": "polite", class: "sr-only" }),
      make("pulse", "div", { class: "pulse", "aria-hidden": "true" }),
    );
    return root;
  }

  private wireEmotes(button: HTMLElement, menu: HTMLElement): void {
    const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    const close = (focus: boolean): void => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (focus) button.focus();
    };
    const move = (index: number): void => {
      items.forEach((item, i) => (item.tabIndex = i === index ? 0 : -1));
      items[index]?.focus();
    };
    button.addEventListener("click", () => {
      if (menu.hidden) {
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        move(0);
      } else close(true);
    });
    menu.addEventListener("keydown", (event) => {
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown") move((index + 1) % items.length);
      else if (event.key === "ArrowUp") move((index - 1 + items.length) % items.length);
      else if (event.key === "Escape") close(true);
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    for (const item of items) {
      item.addEventListener("click", () => {
        this.options.callbacks.emote(item.dataset.emote as string);
        close(true);
      });
    }
  }

  // ------------------------------------------------------------------------------------------
  // small helpers

  private seatName(seat: Seat): string {
    return this.view.seats[seat].name;
  }

  private fieldOf(seat: Seat): "tomato" | "cobalt" {
    return seat === 0 ? "tomato" : "cobalt";
  }

  /** The seat whose controls act on this device now, or null when the opponent is shooting online. */
  private shooter(): Seat | null {
    if (this.options.mode === "local") return this.view.turn;
    return this.options.viewer === this.view.turn ? this.view.turn : null;
  }

  private canAim(): boolean {
    return this.phase === "aim" && this.shooter() !== null && !this.rotating && !this.view.finished;
  }

  private offset(): number {
    return this.aim.offset2 / 2;
  }

  private angle(): number {
    return this.aim.angle10 / 10;
  }

  private announce(text: string): void {
    const log = this.el.announcer as HTMLElement;
    log.append(h("p", {}, text, " "));
    while (log.childElementCount > 60) log.firstElementChild?.remove();
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    (this.el["match-root"] as HTMLElement).dataset.phase = phase;
    (this.el["referee-note"] as HTMLElement).hidden = phase !== "refereeing";
    (this.el["skip-shot"] as HTMLElement).hidden = phase !== "moving" || this.running === null;
    this.syncControls();
  }

  private later(callback: () => void, ms: number): void {
    this.timers.push(window.setTimeout(callback, ms));
  }

  // ------------------------------------------------------------------------------------------
  // rendering

  private rotationFor(seat: Seat): 0 | 180 {
    if (this.options.mode === "online") return this.options.viewer === 1 ? 180 : 0;
    return this.options.rotateBoard && seat === 1 ? 180 : 0;
  }

  private currentRotation(): number {
    return Number((this.el["board-rotator"] as HTMLElement).dataset.rotation ?? 0);
  }

  private placePiece(id: PieceId, spot: Spot, scale = 1): void {
    const group = this.parts.pieces.get(id) as SVGGElement;
    if (spot) {
      group.setAttribute("transform", scale === 1 ? `translate(${spot.x} ${spot.y})` : `translate(${spot.x} ${spot.y}) scale(${scale})`);
      group.removeAttribute("visibility");
      group.setAttribute("data-x", spot.x.toFixed(1));
      group.setAttribute("data-y", spot.y.toFixed(1));
      group.setAttribute("data-state", "board");
    } else {
      group.setAttribute("visibility", "hidden");
      group.setAttribute("data-x", "");
      group.setAttribute("data-y", "");
      group.setAttribute("data-state", "pocketed");
    }
  }

  private spotOf(id: PieceId): Spot {
    const group = this.parts.pieces.get(id) as SVGGElement;
    if (group.getAttribute("data-state") !== "board") return null;
    return { x: Number(group.getAttribute("data-x")), y: Number(group.getAttribute("data-y")) };
  }

  private syncPieces(pieces: readonly PieceState[]): void {
    for (const piece of pieces) {
      if (piece.id === "striker") continue;
      this.placePiece(piece.id, piece.state === "board" ? { x: piece.x as number, y: piece.y as number } : null);
      const group = this.parts.pieces.get(piece.id) as SVGGElement;
      group.setAttribute("data-pocketed-by", piece.pocketedBy === null ? "" : String(piece.pocketedBy));
    }
    this.renderStriker();
  }

  /** Where the striker is drawn: on the shooter's placement while aiming, else at its resting place. */
  private renderStriker(): void {
    const striker = this.parts.pieces.get("striker") as SVGGElement;
    const turn = this.view.turn;
    const placing = (this.phase === "aim" || this.phase === "refereeing") && this.shooter() !== null;
    const spot = placing ? strikerSpot(turn, this.offset()) : (this.toGhost ? strikerSpot(turn, this.toGhost.x) : { x: 0, y: baselineY(turn) });
    this.placePiece("striker", this.phase === "moving" ? this.spotOf("striker") : spot);
    striker.setAttribute("data-skin", this.view.seats[turn].strikerSkin);
    striker.setAttribute("data-legal", String(this.legal));
    striker.classList.toggle("ghosted", this.phase === "refereeing");
  }

  private coinPieces(): PieceState[] {
    return this.view.pieces;
  }

  private recomputeLegal(): void {
    this.legal = placementLegal(this.coinPieces(), this.view.turn, this.offset());
  }

  private render(initial: boolean): void {
    const view = this.view;
    const root = this.element;
    root.dataset.turn = String(view.turn);
    root.dataset.field = this.fieldOf(view.turn);
    root.dataset.board = String(view.board);
    root.dataset.shotSeq = String(view.shotSeq);
    this.parts.setLook(this.options.look.board, this.options.look.coins);
    this.parts.setStrikerSkin(view.seats[view.turn].strikerSkin);
    this.syncPieces(view.pieces);
    this.renderRail();
    this.renderTurn();
    this.rotateInstantly(this.rotationFor(view.turn));
    const state: Phase = view.status === "waiting" ? "waiting" : view.finished ? "match-over" : "aim";
    if (initial || !this.running) this.setPhase(state);
    this.resetAim();
    this.renderAim();
    if (this.options.mode === "online") this.setClock(view.turnRemainingMs);
    if (view.finished && !this.matchOver) this.openMatchOver(null);
  }

  private renderRail(shownPieces: readonly PieceState[] = this.view.pieces): void {
    const view = this.view;
    const white: Seat = view.seats[0].color === "white" ? 0 : 1;
    for (const seat of [0, 1] as const) {
      const block = view.seats[seat];
      setText(this.el[`name-${seat}`] as HTMLElement, block.name);
      setText(this.el[`score-${seat}`] as HTMLElement, String(block.score));
      const left = coinsOnBoard(shownPieces, white, seat).length;
      setText(this.el[`coins-left-${seat}`] as HTMLElement, coinsLeftText(left));
      setText(this.el[`dues-${seat}`] as HTMLElement, `Dues owed: ${block.dues}`);
    }
    setText(this.el["queen-status"] as HTMLElement, queenStatusText({ queen: view.queen } as never, [view.seats[0].name, view.seats[1].name]));
    const opposing = this.options.viewer === null ? view.turn : otherSeat(this.options.viewer);
    (this.element.querySelector(".opp-name") as HTMLElement).dataset.name = view.seats[opposing].name;
  }

  private turnText(): string {
    if (this.options.mode === "online") return this.options.viewer === this.view.turn ? "Your turn" : `${this.seatName(this.view.turn)}'s turn`;
    return `${this.seatName(this.view.turn)}'s turn`;
  }

  private renderTurn(): void {
    setText(this.el["turn-text"] as HTMLElement, this.view.status === "waiting" ? "Waiting for the players" : this.turnText());
    setText(this.el["board-label"] as HTMLElement, boardLabel(this.view));
    setText(this.el["break-label"] as HTMLElement, this.view.breakAttempt ? `Break attempt ${this.view.breakAttempt} of ${BREAK_ATTEMPTS}` : "");
  }

  private resetAim(): void {
    this.aim = { offset2: 0, angle10: 0, power: 0 };
    this.recomputeLegal();
    setText(this.el["shot-error"] as HTMLElement, "");
  }

  private renderAim(): void {
    const direction = aimDirection(this.view.turn, this.angle());
    const spot = strikerSpot(this.view.turn, this.offset());
    const aiming = this.canAim();
    this.recomputeLegal();
    const set = (id: string, value: string): void => {
      const input = this.el[id] as HTMLInputElement;
      if (input.value !== value) input.value = value;
    };
    set("striker-slider", String(this.offset()));
    set("aim-slider", String(this.angle()));
    set("power-slider", String(Math.round(this.aim.power / 10)));
    const power = Math.round(this.aim.power / 10);
    setText(this.el["striker-readout"] as HTMLElement, `Striker ${this.offset().toFixed(1)} mm`);
    setText(this.el["aim-readout"] as HTMLElement, `Aim ${this.angle().toFixed(1)} degrees`);
    setText(this.el["power-readout"] as HTMLElement, `Power ${power}%`);
    this.el["striker-slider"]?.setAttribute("aria-valuetext", `${this.offset().toFixed(1)} mm`);
    this.el["aim-slider"]?.setAttribute("aria-valuetext", `${this.angle().toFixed(1)} degrees`);
    this.el["power-slider"]?.setAttribute("aria-valuetext", `${power}%`);
    setText(this.el["placement-message"] as HTMLElement, aiming && !this.legal ? "Striker overlaps a coin." : "");
    this.renderStriker();
    const guide = this.parts.guide;
    guide.style.display = aiming ? "" : "none";
    if (aiming) {
      const trace = aimGuide(this.coinPieces(), this.view.turn, this.offset(), direction.dx, direction.dy);
      guide.setAttribute("data-first-contact", trace.first);
      const end = { x: spot.x + direction.dx * trace.distance, y: spot.y + direction.dy * trace.distance };
      this.parts.guideLine.setAttribute("x1", String(spot.x));
      this.parts.guideLine.setAttribute("y1", String(spot.y));
      this.parts.guideLine.setAttribute("x2", String(end.x));
      this.parts.guideLine.setAttribute("y2", String(end.y));
      this.parts.guideMark.setAttribute("cx", String(end.x));
      this.parts.guideMark.setAttribute("cy", String(end.y));
      this.parts.guideMark.style.display = trace.first === "cushion" ? "none" : "";
    }
    this.syncControls();
    if (aiming) this.sendPreview();
  }

  private syncControls(): void {
    const aiming = this.canAim();
    for (const id of ["striker-slider", "aim-slider", "power-slider"]) (this.el[id] as HTMLInputElement).disabled = !aiming;
    (this.el.shoot as HTMLButtonElement).disabled = !(aiming && this.aim.power > 0 && this.legal);
  }

  // ------------------------------------------------------------------------------------------
  // aiming input

  private setOffset2(value: number, fromUser: boolean): void {
    const next = Math.max(-MAX_OFFSET * 2, Math.min(MAX_OFFSET * 2, value)) + 0;
    if (next === this.aim.offset2) return;
    const wasLegal = this.legal;
    this.aim.offset2 = next;
    this.renderAim();
    if (fromUser && wasLegal && !this.legal) this.enteredIllegal();
  }

  private setAngle10(value: number): void {
    this.aim.angle10 = Math.max(-1800, Math.min(1800, value)) + 0;
    this.renderAim();
  }

  private setPower(perMille: number): void {
    this.aim.power = Math.max(0, Math.min(1000, perMille)) + 0;
    this.renderAim();
  }

  private enteredIllegal(): void {
    this.announce("Striker overlaps a coin.");
    if (reducedMotion()) return;
    const scale = this.parts.svg.getBoundingClientRect().width / BOARD_MM || 1;
    const reach = 4 / scale;
    this.parts.ring.animate(
      [0, 1, -1, 1, -1, 0].map((step, index, all) => ({ transform: `translateX(${step * reach}px)`, offset: index / (all.length - 1) })),
      { duration: 120, easing: "linear" },
    );
  }

  private onKey(event: KeyboardEvent): void {
    if (this.element.querySelector("dialog[open]")) return;
    const target = event.target as HTMLElement;
    const onBoard = (target as Element) === this.parts.svg;
    const onButton = target.tagName === "BUTTON" && !target.closest(".emote-menu");
    const key = event.key;
    const lower = key.toLowerCase();
    if (key === "k" || key === "K") {
      if (this.running && (onBoard || onButton)) {
        event.preventDefault();
        this.running.skip();
      }
      return;
    }
    if (!this.canAim()) return;
    if (onBoard && (key === "ArrowLeft" || key === "ArrowRight")) {
      event.preventDefault();
      const step = event.shiftKey ? 1 : 2;
      this.setOffset2(this.aim.offset2 + (key === "ArrowRight" ? step : -step), true);
    } else if (onBoard && (key === " " || key === "Spacebar")) {
      event.preventDefault();
      void this.fire();
    } else if ((onBoard || onButton) && (lower === "a" || lower === "d")) {
      event.preventDefault();
      const step = event.shiftKey ? 1 : 10;
      this.setAngle10(this.aim.angle10 + (lower === "d" ? step : -step));
    } else if ((onBoard || onButton) && (lower === "w" || lower === "s")) {
      event.preventDefault();
      const next = Math.round(this.aim.power / 10) + (lower === "w" ? 2 : -2);
      this.setPower(next * 10);
    } else if ((onBoard || onButton) && key === "Escape") {
      event.preventDefault();
      this.aim.angle10 = 0;
      this.aim.power = 0;
      this.renderAim();
    }
  }

  private shooterPoint(event: PointerEvent, rect: DOMRect): { x: number; y: number } {
    const scale = rect.width / BOARD_MM;
    let x = (event.clientX - (rect.left + rect.width / 2)) / scale;
    let y = (event.clientY - (rect.top + rect.height / 2)) / scale;
    const seat = this.view.turn;
    if (this.currentRotation() !== (seat === 0 ? 0 : 180)) {
      x = -x;
      y = -y;
    }
    return { x, y };
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.canAim() || this.gesture || event.button > 0) return;
    event.preventDefault();
    const rect = this.parts.svg.getBoundingClientRect();
    const point = this.shooterPoint(event, rect);
    const onStriker = Math.hypot(point.x - this.offset(), point.y - BASELINE_Y) <= GRAB_MM;
    this.gesture = { kind: onStriker ? "slide" : "pull", startX: event.clientX, startY: event.clientY, startOffset2: this.aim.offset2, rect };
    this.parts.svg.setPointerCapture(event.pointerId);
    this.parts.svg.focus({ preventScroll: true });
  }

  private onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    const scale = gesture.rect.width / BOARD_MM;
    const flip = this.currentRotation() !== (this.view.turn === 0 ? 0 : 180) ? -1 : 1;
    if (gesture.kind === "slide") {
      const moved = (flip * (event.clientX - gesture.startX)) / scale;
      this.setOffset2(Math.round((gesture.startOffset2 / 2 + moved) * 2), true);
      return;
    }
    const pullX = flip * (gesture.startX - event.clientX);
    const pullY = flip * (gesture.startY - event.clientY);
    const length = Math.hypot(pullX, pullY);
    if (length <= CANCEL_PX) {
      this.aim.power = 0;
    } else {
      const ratio = Math.min(1, length / (PULL_SHARE * gesture.rect.width));
      this.aim.power = Math.round(ratio * ratio * 1000);
      this.aim.angle10 = Math.round(((Math.atan2(pullX, -pullY) * 180) / Math.PI) * 10) + 0;
    }
    this.renderAim();
  }

  private onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.parts.svg.releasePointerCapture(event.pointerId);
    this.endGesture(gesture.kind === "pull");
  }

  private endGesture(release: boolean): void {
    this.gesture = null;
    if (release && this.aim.power > 0 && this.legal && this.canAim()) void this.fire();
  }

  private sendPreview(): void {
    if (this.options.mode !== "online") return;
    const direction = aimDirection(this.view.turn, this.angle());
    this.pendingPreview = { x: this.offset(), dx: direction.dx, dy: direction.dy, p: this.aim.power / 1000 };
    const flush = (): void => {
      this.previewTimer = undefined;
      if (!this.pendingPreview) return;
      this.lastPreviewAt = performance.now();
      this.options.callbacks.preview(this.pendingPreview);
      this.pendingPreview = null;
    };
    if (this.previewTimer !== undefined) return;
    const wait = PREVIEW_EVERY_MS - (performance.now() - this.lastPreviewAt);
    if (wait <= 0) flush();
    else this.previewTimer = window.setTimeout(flush, wait);
  }

  // ------------------------------------------------------------------------------------------
  // the opponent's live aim

  showGhost(seat: Seat, preview: { x: number; dx: number; dy: number; p: number }): void {
    if (this.options.mode !== "online" || seat === this.options.viewer || this.phase !== "aim") return;
    this.toGhost = preview;
    const spot = strikerSpot(seat, preview.x);
    const ghost = this.parts.ghost;
    ghost.style.display = "";
    ghost.setAttribute("transform", `translate(${spot.x} ${spot.y})`);
    ghost.setAttribute("data-x", spot.x.toFixed(1));
    ghost.setAttribute("data-y", spot.y.toFixed(1));
    const line = this.parts.ghostAim;
    line.style.display = "";
    const reach = 60 + preview.p * 260;
    line.setAttribute("x1", String(spot.x));
    line.setAttribute("y1", String(spot.y));
    line.setAttribute("x2", String(spot.x + preview.dx * reach));
    line.setAttribute("y2", String(spot.y + preview.dy * reach));
    this.renderStriker();
  }

  private hideGhost(): void {
    this.toGhost = null;
    this.parts.ghost.style.display = "none";
    this.parts.ghostAim.style.display = "none";
  }

  // ------------------------------------------------------------------------------------------
  // shots

  private async fire(): Promise<void> {
    if (!this.canAim() || this.aim.power === 0 || !this.legal) return;
    const direction = aimDirection(this.view.turn, this.angle());
    const intent: ShotIntent = { x: this.offset(), dx: direction.dx, dy: direction.dy, p: this.aim.power / 1000 };
    setText(this.el["shot-error"] as HTMLElement, "");
    this.setPhase("refereeing");
    this.parts.guide.style.display = "none";
    this.renderStriker();
    try {
      const ruling = await this.options.callbacks.shoot(intent, this.seq + 1);
      this.playRuling(ruling);
    } catch (error) {
      const code = error instanceof ApiFail ? error.code : "NETWORK";
      const message = SHOT_ERRORS[code] ?? (error instanceof ApiFail && error.status === 503 ? "Online play is unavailable right now." : "That shot didn't go through. Try again.");
      setText(this.el["shot-error"] as HTMLElement, message);
      this.announce(message);
      this.setPhase("aim");
      this.renderAim();
      if (code === "NOT_YOUR_TURN" || code === "TURN_EXPIRED" || code === "STALE_SEQ") this.options.callbacks.resync();
    }
  }

  shotStarted(): void {
    if (this.jobs === 0 && this.phase === "aim" && this.shooter() === null) {
      this.setPhase("refereeing");
      this.parts.guide.style.display = "none";
      this.parts.ghost.style.display = "none";
      this.parts.ghostAim.style.display = "none";
      this.renderStriker();
    }
  }

  private enqueue(job: () => Promise<void>): void {
    this.jobs += 1;
    this.chain = this.chain.then(job).catch(() => undefined).then(() => {
      this.jobs -= 1;
    });
  }

  applyState(view: MatchView): void {
    this.enqueue(async () => {
      if (view.shotSeq < this.seq) return;
      if (view.shotSeq === this.seq && view.turn === this.view.turn && view.board === this.view.board && !view.finished && this.view.finished === view.finished) {
        this.mergeLive(view);
        return;
      }
      this.seq = view.shotSeq;
      this.view = view;
      this.hideGhost();
      this.render(false);
    });
  }

  /** A state push that changes nothing about the shot in progress: connections, readiness, clocks. */
  private mergeLive(view: MatchView): void {
    this.view = { ...this.view, seats: view.seats, turnRemainingMs: view.turnRemainingMs, rematch: view.rematch, settlement: view.settlement };
    this.renderRail();
    if (this.options.mode === "online" && this.phase === "aim" && view.turnRemainingMs !== null) this.setClock(view.turnRemainingMs);
    this.syncRematch();
  }

  playRuling(ruling: RulingView): void {
    this.enqueue(() => this.runRuling(ruling));
  }

  private async runRuling(ruling: RulingView): Promise<void> {
    if (ruling.shotSeq <= this.seq) return;
    this.seq = ruling.shotSeq;
    const root = this.element;
    const reduced = reducedMotion();
    root.dataset.shotSeq = String(ruling.shotSeq);
    this.hideGhost();
    this.hideBanner(true);
    setText(this.el["shot-error"] as HTMLElement, "");
    this.parts.guide.style.display = "none";
    this.setPhase("moving");
    if (this.options.mode === "online") this.setClock(ruling.match.turnRemainingMs);
    const striker = this.parts.pieces.get("striker") as SVGGElement;
    striker.classList.remove("ghosted");

    const sink = {
      position: (id: PieceId): Spot => this.spotOf(id),
      place: (id: PieceId, spot: Spot, scale: number): void => this.placePiece(id, spot, scale),
    };
    if (reduced) {
      for (const f of ruling.final) this.placePiece(f.id, f.x === null || f.y === null ? null : { x: f.x, y: f.y });
    } else {
      this.running = play(sink, ruling.frames, ruling.final, ruling.events);
      this.setPhase("moving");
      await this.running.done;
      this.running = null;
    }
    const previous = this.view;
    const finalPieces = ruling.final;
    for (const piece of finalPieces) {
      const group = this.parts.pieces.get(piece.id) as SVGGElement;
      this.placePiece(piece.id, piece.state === "board" ? { x: piece.x as number, y: piece.y as number } : null);
      group.setAttribute("data-pocketed-by", piece.pocketedBy === null ? "" : String(piece.pocketedBy));
      if (piece.state === "board" && previous.pieces.find((p) => p.id === piece.id)?.state === "pocketed" && !reduced) {
        group.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      }
    }
    this.view = { ...ruling.match, pieces: finalPieces };
    this.renderRail(finalPieces);
    setText(this.el["break-label"] as HTMLElement, ruling.boardEnd || ruling.match.breakAttempt === null ? "" : `Break attempt ${ruling.match.breakAttempt} of ${BREAK_ATTEMPTS}`);
    this.showBanner(ruling.verdict.word, ruling.verdict.line);
    this.announce(ruling.verdict.line);
    await sleep(reduced ? 0 : BANNER_IN_MS);

    if (ruling.match.finished) {
      if (ruling.boardEnd) this.announce(`${this.seatName(ruling.boardEnd.winnerSeat)} wins board ${ruling.boardEnd.board}. ${ruling.boardEnd.line}`);
      this.setPhase("match-over");
      this.openMatchOver(ruling.boardEnd?.line ?? null);
      await new Promise<void>(() => undefined);
      return;
    }
    if (ruling.boardEnd) {
      this.announce(`${this.seatName(ruling.boardEnd.winnerSeat)} wins board ${ruling.boardEnd.board}. ${ruling.boardEnd.line}`);
      this.setPhase("board-over");
      const finished = ruling.match;
      await new Promise<void>((resolve) => {
        boardOverSheet(finished, ruling.boardEnd as NonNullable<RulingView["boardEnd"]>, resolve);
      });
      this.view = finished;
      this.render(false);
      this.setPhase("aim");
      this.announce(this.turnText());
      (this.parts.svg as unknown as HTMLElement).focus();
      return;
    }
    if (ruling.match.turn !== previous.turn) {
      await this.wipeTo(ruling.match.turn, reduced);
      this.view = { ...ruling.match, pieces: finalPieces };
      this.announce(this.turnText());
    } else if (!reduced) {
      this.pulseField();
    }
    this.resetAim();
    this.setPhase("aim");
    this.renderAim();
    this.hideGhost();
  }

  // ------------------------------------------------------------------------------------------
  // the verdict, the wipe, the turn of the board

  private showBanner(word: string, line: string): void {
    const banner = this.el.verdict as HTMLElement;
    const token = ++this.bannerToken;
    banner.getAnimations().forEach((a) => a.cancel());
    setText(this.el["verdict-word"] as HTMLElement, word);
    setText(this.el["verdict-line"] as HTMLElement, line);
    banner.hidden = false;
    if (!reducedMotion()) {
      banner.animate([{ transform: "translateY(-24px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: BANNER_IN_MS, easing: "cubic-bezier(.2,.8,.2,1)" });
      (this.el["verdict-word"] as HTMLElement).animate([{ transform: "scale(0.4)" }, { transform: "scale(1)" }], { duration: 250, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    this.later(() => {
      if (token === this.bannerToken) this.hideBanner(false);
    }, app.config?.verdictBannerMs ?? 2000);
  }

  private hideBanner(now: boolean): void {
    const banner = this.el.verdict as HTMLElement;
    const token = ++this.bannerToken;
    if (banner.hidden) return;
    if (now || reducedMotion()) {
      banner.hidden = true;
      return;
    }
    const leaving = banner.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-24px)", opacity: 0 }], { duration: BANNER_OUT_MS, easing: "ease-in", fill: "forwards" });
    void leaving.finished.then(
      () => {
        if (token === this.bannerToken) {
          banner.hidden = true;
          leaving.cancel();
        }
      },
      () => undefined,
    );
  }

  private async wipeTo(turn: Seat, reduced: boolean): Promise<void> {
    const root = this.element;
    if (!reduced) {
      const rotation = this.currentRotation();
      const bottom = turn === 0 ? rotation === 0 : rotation === 180;
      const wipe = h("div", { id: "field-wipe", class: `wipe wipe-${this.fieldOf(turn)}`, "data-from": bottom ? "bottom" : "top", "aria-hidden": "true" });
      root.append(wipe);
      wipe.animate([{ transform: `translateY(${bottom ? "100%" : "-100%"})` }, { transform: "translateY(0)" }], { duration: WIPE_MS, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
      await sleep(WIPE_MS);
      this.view = { ...this.view, turn };
      this.applyTurn(turn);
      wipe.remove();
    } else {
      this.view = { ...this.view, turn };
      this.applyTurn(turn);
    }
    await this.rotateTo(this.rotationFor(turn), reduced);
  }

  private applyTurn(turn: Seat): void {
    const root = this.element;
    root.dataset.turn = String(turn);
    root.dataset.field = this.fieldOf(turn);
    this.renderTurn();
    this.renderRail();
    this.parts.setStrikerSkin(this.view.seats[turn].strikerSkin);
  }

  private rotateInstantly(degrees: number): void {
    const rotator = this.el["board-rotator"] as HTMLElement;
    rotator.dataset.rotation = String(degrees);
    rotator.style.transform = `rotate(${degrees}deg)`;
  }

  private async rotateTo(degrees: number, reduced: boolean): Promise<void> {
    const rotator = this.el["board-rotator"] as HTMLElement;
    const from = this.currentRotation();
    if (from === degrees) return;
    this.rotating = true;
    this.syncControls();
    if (reduced) {
      this.rotateInstantly(degrees);
      await rotator.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: CROSSFADE_MS }).finished.catch(() => undefined);
    } else {
      const turning = rotator.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${degrees}deg)` }], { duration: TURN_MS, easing: "cubic-bezier(.4,0,.2,1)" });
      await turning.finished.catch(() => undefined);
      this.rotateInstantly(degrees);
    }
    this.rotating = false;
    this.syncControls();
  }

  private pulseField(): void {
    (this.el.pulse as HTMLElement).animate([{ opacity: 0 }, { opacity: 0.28 }, { opacity: 0 }], { duration: 250, easing: "ease-out" });
  }

  // ------------------------------------------------------------------------------------------
  // the shot clock, the reconnect overlay, emotes

  setClock(ms: number | null): void {
    const timer = this.el["shot-timer"];
    if (!timer) return;
    this.clockEnd = ms === null ? null : performance.now() + ms;
    this.tickClock();
  }

  tickClock(): void {
    const timer = this.el["shot-timer"];
    if (!timer) return;
    const remaining = this.clockEnd === null ? (app.config?.shotTimerSeconds ?? 20) * 1000 : Math.max(0, this.clockEnd - performance.now());
    setText(timer, formatClock(remaining));
    const low = this.clockEnd !== null && remaining <= LOW_CLOCK_MS && !this.view.finished;
    if (low !== this.pulse) {
      this.pulse = low;
      timer.classList.toggle("low", low);
    }
    if (this.opponentGone) {
      const overlay = this.el["reconnect-overlay"] as HTMLElement;
      setText(overlay, `${this.opponentGone.name} is reconnecting... ${formatClock(this.opponentGone.endsAt - performance.now())}`);
    }
  }

  setOpponent(status: { connected: boolean; reconnectRemainingMs: number | null }): void {
    const overlay = this.el["reconnect-overlay"] as HTMLElement;
    if (status.connected || status.reconnectRemainingMs === null || this.view.finished) {
      this.opponentGone = null;
      overlay.hidden = true;
      setText(overlay, "");
      return;
    }
    const name = this.seatName(otherSeat(this.options.viewer ?? 0));
    const first = this.opponentGone === null;
    this.opponentGone = { name, endsAt: performance.now() + status.reconnectRemainingMs };
    overlay.hidden = false;
    this.tickClock();
    if (first) this.announce(overlay.textContent ?? "");
  }

  receiveEmote(seat: Seat, id: string): void {
    const label = EMOTES.find(([key]) => key === id)?.[1] ?? id;
    const bubble = this.el["emote-bubble"] as HTMLElement;
    setText(bubble, `${this.seatName(seat)}: ${label}`);
    bubble.hidden = false;
    this.announce(`${this.seatName(seat)}: ${label}`);
    window.clearTimeout(this.emoteTimer);
    this.emoteTimer = window.setTimeout(() => {
      bubble.hidden = true;
      setText(bubble, "");
    }, EMOTE_SHOWN_MS);
  }

  // ------------------------------------------------------------------------------------------
  // the end of the match

  private openMatchOver(boardPoints: string | null): void {
    if (this.matchOver) return;
    const view = this.view;
    const online = this.options.mode === "online";
    const viewer = this.options.viewer;
    const winner = view.winnerSeat;
    const mine: Seat = viewer ?? 0;
    const names = [view.seats[0].name, view.seats[1].name];
    const heading = online ? (winner === viewer ? "You won" : "You lost") : `${names[winner ?? 0]} wins`;
    const loser = winner === null ? null : otherSeat(winner);
    const reasons: Record<string, string> = {
      left: `${names[loser ?? 0]} forfeited: left the match`,
      timeouts: `${names[loser ?? 0]} forfeited: ${TIMEOUTS_TO_FORFEIT} timeouts in a row`,
      resigned: `${names[loser ?? 0]} resigned`,
    };
    const settlement = view.settlement?.seats[mine] ?? null;
    const content = {
      heading,
      finalScore: `Final score ${view.seats[mine].score}-${view.seats[otherSeat(mine)].score}`,
      boardPoints: view.endReason === "played" ? boardPoints : null,
      endReason: view.endReason && view.endReason !== "played" ? (reasons[view.endReason] ?? null) : null,
      ratingChange: view.mode === "ranked" && settlement && settlement.ratingAfter !== null && settlement.ratingDelta !== null ? `Rating ${Math.round(settlement.ratingAfter)} (${signed(settlement.ratingDelta)})` : null,
      chalk: online && settlement ? `+${settlement.chalk} chalk` : null,
      saveStatus: !online,
      rematch: view.mode === "private",
    };
    this.matchOver = matchOverDialog(content, {
      rematch: () => this.options.callbacks.rematch(true),
      accept: () => this.options.callbacks.rematch(true),
    });
    this.announce(`${heading}. ${content.finalScore}.`);
    if (!online) {
      this.matchOver.setSaveStatus("Saving...");
      this.options.callbacks.finished(view, (status, chalk) => {
        this.matchOver?.setSaveStatus(status);
        if (chalk) this.matchOver?.setChalk(chalk);
      });
    }
    this.syncRematch();
  }

  /** The Match over dialog reflects the rematch offer: who offered, whether it expired. */
  syncRematch(): void {
    const handle = this.matchOver;
    const offer = this.view.rematch;
    if (!handle || this.view.mode !== "private") return;
    const viewer = this.options.viewer;
    const mine = offer?.status === "offered" && offer.offeredBy === viewer;
    const theirs = offer?.status === "offered" && offer.offeredBy !== viewer;
    const line = theirs && offer ? `${this.seatName(offer.offeredBy)} wants a rematch.` : null;
    handle.setRematch({ label: mine ? "Rematch offered" : "Rematch", disabled: Boolean(mine), offer: line, expired: offer?.status === "expired" });
    if (line && this.offerAnnounced !== line) {
      this.offerAnnounced = line;
      this.announce(line);
    }
  }

  private offerAnnounced = "";

  setRematchView(offer: MatchView["rematch"]): void {
    this.view = { ...this.view, rematch: offer };
    this.syncRematch();
  }

  destroy(): void {
    this.running?.skip();
    for (const t of this.timers) window.clearTimeout(t);
    window.clearTimeout(this.emoteTimer);
    window.clearTimeout(this.previewTimer);
    this.element.removeEventListener("keydown", this.keys);
    this.matchOver?.dialog.element.remove();
    for (const dialog of document.querySelectorAll("dialog")) dialog.remove();
  }
}

