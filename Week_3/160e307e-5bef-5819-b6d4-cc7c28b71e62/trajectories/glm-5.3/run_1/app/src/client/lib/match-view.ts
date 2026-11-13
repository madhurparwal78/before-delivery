import {
  BOARD_SIDE,
  CUSHION,
  POCKET_CENTERS,
  COIN_RADIUS,
  STRIKER_RADIUS,
  offsetToBoardX,
  boardXToOffset,
  strikerBaselineY,
  aimVector,
  isPlacementLegal,
  aimGuideFirstContact,
  mm,
  type Piece,
  type PieceId,
  type Seat,
} from "../../shared/rules.js";
import { prefersReducedMotion } from "./app.js";

export interface MatchState {
  id: string;
  mode: "private" | "casual" | "ranked";
  format: "quick" | "classic";
  status: string;
  board: number;
  turn: Seat;
  phase: string;
  shotSeq: number;
  breakAttempt: number | null;
  seats: {
    seat: Seat;
    playerId: string;
    name: string;
    avatar: number;
    color: string;
    score: number;
    coinsLeft: number;
    dues: number;
    timeouts: number;
    connected: boolean;
    ready: boolean;
    strikerSkin: string;
  }[];
  queen: { state: string; seat: Seat | null };
  pieces: Piece[];
  turnRemainingMs: number | null;
  winnerSeat: Seat | null;
  endReason: string | null;
  roomCode: string | null;
  viewerSeat: Seat | null;
}

export interface ShotResult {
  shotSeq: number;
  seat: Seat;
  events: { firstContact: string | null; pocketed: { id: string; pocket: string }[]; strikerPocketed: boolean };
  verdict: { word: string; line: string };
  frames: { t: number; pieces: { id: string; x: number; y: number }[] }[];
  final: { id: string; x: number | null; y: number | null; state: string }[];
  match: MatchState;
  boardEnd: {
    winnerSeat: Seat;
    loserSeat: Seat;
    points: number;
    pointsLine: string;
  } | null;
  matchOver: boolean;
}

export type WipeDir = "top" | "bottom";

/** The whole match screen: board, controls, verdicts, wipes and announcements. */
export class MatchView {
  readonly root: HTMLElement;
  readonly matchRoot: HTMLElement;
  private readonly boardEl: SVGElement;
  private readonly boardGroup: HTMLElement;
  private readonly rotator: SVGElement;
  private readonly piecesLayer: SVGGElement;
  private readonly guideLayer: SVGGElement;
  private readonly ghostLayer: SVGGElement;
  private readonly pieceEls = new Map<string, SVGGElement>();
  private readonly pieceMirror = new Map<string, HTMLElement>();
  private aimGuideEl: SVGLineElement;
  private readonly announcer: HTMLElement;
  private readonly strikerSlider: HTMLInputElement;
  private readonly aimSlider: HTMLInputElement;
  private readonly powerSlider: HTMLInputElement;
  private readonly strikerReadout: HTMLElement;
  private readonly aimReadout: HTMLElement;
  private readonly powerReadout: HTMLElement;
  private readonly shootButton: HTMLButtonElement;
  private readonly skipButton: HTMLButtonElement;
  private readonly placementMessage: HTMLElement;
  private readonly shotError: HTMLElement;
  private readonly turnText: HTMLElement;
  private readonly boardLabel: HTMLElement;
  private readonly breakLabel: HTMLElement;
  private readonly scoreRail: HTMLElement;
  private readonly verdict: HTMLElement;
  private readonly verdictWord: HTMLElement;
  private readonly verdictLine: HTMLElement;
  private readonly shotTimer: HTMLElement;
  private readonly fieldWipe: HTMLElement;
  private readonly emoteBubble: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly emotesButton: HTMLButtonElement | null;

  private state: MatchState | null = null;
  private viewerSeat: Seat | null = null;
  private local = false;
  private announcePlacement = false;

  // aiming values
  private offset = 0;
  private aim = 0;
  private power = 0;

  private legal = true;
  private rotation: 0 | 180 = 0;
  private turnSwitch = true;
  private verdictTimer: number | null = null;
  private shotClockTimer: number | null = null;
  private shotDeadline: number | null = null;
  private onShoot: ((intent: { x: number; dx: number; dy: number; p: number }) => void) | null = null;
  private onMenu: (() => void) | null = null;
  private onEmote: ((emote: string) => void) | null = null;
  private onPreview: ((x: number, dx: number, dy: number, p: number) => void) | null = null;
  private lastPreviewSent = 0;
  private onSkip: (() => void) | null = null;
  private ghostPreview: { seat: Seat; x: number; dx: number; dy: number; p: number } | null = null;
  private bannerMs = 2000;

  constructor(opts: {
    local: boolean;
    onShoot: (intent: { x: number; dx: number; dy: number; p: number }) => void;
    onMenu: () => void;
    onEmote?: ((emote: string) => void) | null;
    onSkip?: (() => void) | null;
    onPreview?: ((x: number, dx: number, dy: number, p: number) => void) | null;
    bannerMs?: number;
  }) {
    this.local = opts.local;
    this.onShoot = opts.onShoot;
    this.onMenu = opts.onMenu;
    this.onEmote = opts.onEmote ?? null;
    this.onSkip = opts.onSkip ?? null;
    this.onPreview = opts.onPreview ?? null;
    this.bannerMs = opts.bannerMs ?? 2000;
    this.turnSwitch = !this.local;

    this.root = document.createElement("div");
    this.root.className = "page match-page";

    this.matchRoot = document.createElement("div");
    this.matchRoot.id = "match-root";
    this.root.appendChild(this.matchRoot);

    // Field wipe
    this.fieldWipe = document.createElement("div");
    this.fieldWipe.id = "field-wipe";
    this.fieldWipe.style.display = "none";
    this.matchRoot.appendChild(this.fieldWipe);

    // Board SVG
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "-420 -420 840 840");
    svg.classList.add("board-svg");
    this.boardEl = svg;
    const rotator = document.createElementNS(ns, "g");
    rotator.id = "board-rotator";
    rotator.dataset.rotation = "0";
    this.rotator = rotator;
    svg.appendChild(rotator);
    this.drawBoard(rotator);
    this.piecesLayer = document.createElementNS(ns, "g");
    rotator.appendChild(this.piecesLayer);
    this.guideLayer = document.createElementNS(ns, "g");
    rotator.appendChild(this.guideLayer);
    this.ghostLayer = document.createElementNS(ns, "g");
    rotator.appendChild(this.ghostLayer);
    this.aimGuideEl = document.createElementNS(ns, "line");
    this.aimGuideEl.id = "aim-guide";
    this.guideLayer.appendChild(this.aimGuideEl);

    const boardWrap = document.createElement("div");
    boardWrap.className = "board-wrap";
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Carrom board");
    group.id = "board";
    group.tabIndex = 0;
    group.appendChild(svg);
    boardWrap.appendChild(group);
    this.matchRoot.appendChild(boardWrap);
    this.boardGroup = group;

    // Score rail
    this.scoreRail = document.createElement("div");
    this.scoreRail.id = "score-rail";
    this.scoreRail.setAttribute("role", "region");
    this.scoreRail.setAttribute("aria-label", "Score rail");
    this.matchRoot.appendChild(this.scoreRail);

    // Controls
    const controls = document.createElement("div");
    controls.className = "aim-controls";
    this.strikerSlider = slider("Striker position", "striker-slider", -200, 200, 0.5, 0);
    this.aimSlider = slider("Aim angle", "aim-slider", -180, 180, 0.1, 0);
    this.powerSlider = slider("Power", "power-slider", 0, 100, 1, 0);
    this.strikerReadout = span("striker-readout", "Striker 0.0 mm");
    this.aimReadout = span("aim-readout", "Aim 0.0 degrees");
    this.powerReadout = span("power-readout", "Power 0%");
    this.shootButton = document.createElement("button");
    this.shootButton.id = "shoot";
    this.shootButton.textContent = "Shoot";
    this.shootButton.disabled = true;
    this.skipButton = document.createElement("button");
    this.skipButton.id = "skip-shot";
    this.skipButton.textContent = "Skip shot";
    this.skipButton.style.display = "none";
    this.placementMessage = span("placement-message", "");
    this.shotError = span("shot-error", "");
    controls.append(
      this.strikerSlider, this.strikerReadout,
      this.aimSlider, this.aimReadout,
      this.powerSlider, this.powerReadout,
      this.shootButton, this.skipButton,
      this.placementMessage, this.shotError
    );
    this.matchRoot.appendChild(controls);

    // Labels
    this.turnText = span("turn-text", "");
    this.boardLabel = span("board-label", "");
    this.breakLabel = span("break-label", "");
    const labels = document.createElement("div");
    labels.className = "match-labels";
    labels.append(this.turnText, this.boardLabel, this.breakLabel);
    this.matchRoot.prepend(labels);

    // Verdict banner
    this.verdict = document.createElement("status");
    this.verdict.id = "verdict";
    this.verdict.setAttribute("role", "status");
    this.verdictWord = span("verdict-word", "");
    this.verdictLine = span("verdict-line", "");
    this.verdict.append(this.verdictWord, this.verdictLine);
    this.verdict.style.display = "none";
    this.matchRoot.appendChild(this.verdict);

    // Announcer
    this.announcer = document.createElement("log");
    this.announcer.id = "announcer";
    this.announcer.setAttribute("role", "log");
    this.announcer.setAttribute("aria-live", "polite");
    this.matchRoot.appendChild(this.announcer);

    // Shot clock (online only)
    this.shotTimer = document.createElement("timer");
    this.shotTimer.id = "shot-timer";
    this.shotTimer.setAttribute("role", "timer");
    this.shotTimer.setAttribute("aria-label", "Shot clock");
    this.shotTimer.style.display = this.local ? "none" : "block";
    this.matchRoot.appendChild(this.shotTimer);

    // Emote bubble (online only)
    this.emoteBubble = span("emote-bubble", "");
    this.emoteBubble.style.display = "none";
    this.matchRoot.appendChild(this.emoteBubble);

    // Menu and Emotes buttons
    const buttons = document.createElement("div");
    buttons.className = "match-buttons";
    this.menuButton = document.createElement("button");
    this.menuButton.id = "menu";
    this.menuButton.textContent = "Menu";
    buttons.appendChild(this.menuButton);
    if (!this.local) {
      this.emotesButton = document.createElement("button");
      this.emotesButton.id = "emotes";
      this.emotesButton.textContent = "Emotes";
      buttons.appendChild(this.emotesButton);
    } else {
      this.emotesButton = null;
    }
    this.matchRoot.appendChild(buttons);

    this.wire();
    this.wireBoardPointer();
  }

  // -- setup --

  private drawBoard(parent: SVGGElement): void {
    const ns = "http://www.w3.org/2000/svg";
    const frame = document.createElementNS(ns, "rect");
    frame.setAttribute("x", "-410");
    frame.setAttribute("y", "-410");
    frame.setAttribute("width", "820");
    frame.setAttribute("height", "820");
    frame.setAttribute("fill", "#7a4a22");
    parent.appendChild(frame);
    const ply = document.createElementNS(ns, "rect");
    ply.setAttribute("x", "-380");
    ply.setAttribute("y", "-380");
    ply.setAttribute("width", "760");
    ply.setAttribute("height", "760");
    ply.setAttribute("fill", "#d8a35c");
    parent.appendChild(ply);
    const grain = document.createElementNS(ns, "g");
    for (let i = -6; i <= 6; i++) {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", "-370");
      line.setAttribute("y1", String(i * 55));
      line.setAttribute("x2", "370");
      line.setAttribute("y2", String(i * 55 + 8));
      line.setAttribute("stroke", "rgba(120,72,20,0.16)");
      line.setAttribute("stroke-width", "1.6");
      grain.appendChild(line);
    }
    parent.appendChild(grain);
    // pockets
    for (const [id, c] of Object.entries(POCKET_CENTERS)) {
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", String(c.x));
      circle.setAttribute("cy", String(c.y));
      circle.setAttribute("r", "22.25");
      circle.setAttribute("fill", "#2c1c0c");
      circle.dataset.pocket = id;
      const net = document.createElementNS(ns, "circle");
      net.setAttribute("cx", String(c.x));
      net.setAttribute("cy", String(c.y));
      net.setAttribute("r", "15");
      net.setAttribute("fill", "none");
      net.setAttribute("stroke", "rgba(255,255,255,0.35)");
      net.setAttribute("stroke-width", "1.4");
      parent.appendChild(circle);
      parent.appendChild(net);
    }
    // baselines on each side
    for (const y of [252.1, -252.1]) {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", "-200");
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", "200");
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke", "#14100c");
      line.setAttribute("stroke-width", "2.4");
      parent.appendChild(line);
      for (const x of [-200, 200]) {
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
        circle.setAttribute("r", "12");
        circle.setAttribute("fill", "none");
        circle.setAttribute("stroke", "#14100c");
        circle.setAttribute("stroke-width", "2");
        parent.appendChild(circle);
      }
    }
    // centre circle and arrows
    const centre = document.createElementNS(ns, "circle");
    centre.setAttribute("cx", "0");
    centre.setAttribute("cy", "0");
    centre.setAttribute("r", "80");
    centre.setAttribute("fill", "none");
    centre.setAttribute("stroke", "#a33");
    centre.setAttribute("stroke-width", "2.4");
    parent.appendChild(centre);
    for (const angle of [45, 135, 225, 315]) {
      const rad = (angle * Math.PI) / 180;
      const x = Math.cos(rad) * 140;
      const y = Math.sin(rad) * 140;
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(Math.cos(rad) * 100));
      line.setAttribute("y1", String(Math.sin(rad) * 100));
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke", "#a33");
      line.setAttribute("stroke-width", "2.4");
      parent.appendChild(line);
    }
  }

  private wire(): void {
    this.strikerSlider.addEventListener("input", () => {
      this.setOffset(Number(this.strikerSlider.value));
    });
    this.aimSlider.addEventListener("input", () => {
      this.setAim(Number(this.aimSlider.value));
    });
    this.powerSlider.addEventListener("input", () => {
      this.setPower(Number(this.powerSlider.value));
    });
    this.shootButton.addEventListener("click", () => this.shoot());
    this.skipButton.addEventListener("click", () => {
      if (this.onSkip !== null) this.onSkip();
    });
    this.menuButton.addEventListener("click", () => {
      if (this.onMenu !== null) this.onMenu();
    });
    if (this.emotesButton !== null) {
      this.emotesButton.addEventListener("click", () => this.openEmotes());
    }

    const keydown = (e: KeyboardEvent): void => {
      this.onKey(e);
    };
    document.addEventListener("keydown", keydown);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.state === null) return;
    // Skip shot works while the pieces move; everything else needs the aim phase.
    if (String(this.matchRoot.dataset.phase) === "moving") {
      if ((e.key === "k" || e.key === "K") && this.onSkip !== null) this.onSkip();
      return;
    }
    if (this.matchRoot.dataset.phase !== "aim") return;
    if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement && e.target.type !== "range")) {
        // sliders handle their own arrows; Escape still resets
      } else {
        return;
      }
    }
    if (document.querySelector("dialog[open]") !== null) return;
    const mine = this.viewerSeat !== null && this.state.turn === this.viewerSeat;
    if (!mine && !this.local) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const onBoard = target !== null && (target.id === "board" || this.boardEl.contains(target));
    const onControl =
      target !== null && (target.tagName === "BUTTON" || target.id === "board");

    switch (e.key) {
      case "ArrowLeft":
        if (onBoard) {
          e.preventDefault();
          this.moveStriker(e.shiftKey ? -0.5 : -1);
        }
        return;
      case "ArrowRight":
        if (onBoard) {
          e.preventDefault();
          this.moveStriker(e.shiftKey ? 0.5 : 1);
        }
        return;
      case "a":
      case "A":
        if (onBoard || onControl) this.setAim(this.aim - (e.shiftKey ? 0.1 : 1));
        return;
      case "d":
      case "D":
        if (onBoard || onControl) this.setAim(this.aim + (e.shiftKey ? 0.1 : 1));
        return;
      case "w":
      case "W":
        if (onBoard || onControl) this.setPower(this.power + 2);
        return;
      case "s":
      case "S":
        if (onBoard || onControl) this.setPower(this.power - 2);
        return;
      case "Escape":
        this.setAim(0);
        this.setPower(0);
        return;
      case " ":
        if (onBoard || onControl) {
          e.preventDefault();
          this.shoot();
        }
        return;
      default:
        return;
    }
  }

  private moveStriker(delta: number): void {
    this.setOffset(this.offset + delta);
  }

  private setOffset(value: number): void {
    const next = Math.max(-200, Math.min(200, Math.round(value * 2) / 2));
    if (next === this.offset) return;
    this.offset = next;
    this.strikerSlider.value = String(next);
    this.strikerSlider.setAttribute("aria-valuetext", `${next.toFixed(1)} mm`);
    this.strikerReadout.textContent = `Striker ${next.toFixed(1)} mm`;
    this.updateStriker();
  }

  private setAim(value: number): void {
    const next = Math.max(-180, Math.min(180, Math.round(value * 10) / 10));
    this.aim = next;
    this.aimSlider.value = String(next);
    this.aimSlider.setAttribute("aria-valuetext", `${next.toFixed(1)} degrees`);
    this.aimReadout.textContent = `Aim ${next.toFixed(1)} degrees`;
    this.updateStriker();
  }

  private setPower(value: number): void {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    this.power = next;
    this.powerSlider.value = String(next);
    this.powerSlider.setAttribute("aria-valuetext", `${next}%`);
    this.powerReadout.textContent = `Power ${next}%`;
    this.shootButton.disabled = next <= 0 || !this.legal;
    this.sendPreview();
  }

  /** Sends the live aim to the server, at most 15 times a second. */
  private sendPreview(): void {
    if (this.onPreview === null) return;
    if (this.local) return;
    if (this.state === null) return;
    if (this.viewerSeat === null || this.state.turn !== this.viewerSeat) return;
    const now = Date.now();
    if (now - this.lastPreviewSent < 67) return;
    this.lastPreviewSent = now;
    const { dx, dy } = aimVector(this.state.turn, this.aim);
    this.onPreview(this.offset, dx, dy, this.power / 100);
  }

  private updateStriker(): void {
    if (this.state === null) return;
    const shooter = this.state.turn;
    const pieces = this.state.pieces;
    const wasLegal = this.legal;
    this.legal = isPlacementLegal(pieces, shooter, this.offset);
    const x = offsetToBoardX(shooter, this.offset);
    const y = strikerBaselineY(shooter);
    const mirror = this.pieceMirror.get("striker");
    if (mirror !== undefined) {
      mirror.dataset.x = x.toFixed(1);
      mirror.dataset.y = y.toFixed(1);
      mirror.dataset.legal = String(this.legal);
    }
    const strikerEl = this.pieceEls.get("striker");
    if (strikerEl !== undefined) {
      strikerEl.setAttribute("transform", `translate(${x} ${y})`);
      const ring = strikerEl.querySelector<SVGCircleElement>(".danger-ring");
      if (ring !== null) ring.style.display = this.legal ? "none" : "block";
    }
    if (wasLegal && !this.legal) this.enterIllegal();
    if (!wasLegal && this.legal) this.leaveIllegal();
    this.updateGuide();
    this.shootButton.disabled = this.power <= 0 || !this.legal;
    this.sendPreview();
  }

  private enterIllegal(): void {
    this.placementMessage.textContent = "Striker overlaps a coin.";
    const strikerEl = this.pieceEls.get("striker");
    if (strikerEl !== undefined) {
      const outline = strikerEl.querySelector<SVGCircleElement>(".piece-outline");
      if (outline !== null) {
        if (prefersReducedMotion()) {
          outline.style.stroke = "#14100c";
          outline.style.strokeWidth = "6";
        } else {
          const anim = outline.animate(
            [
              { transform: "translateX(-4px)" },
              { transform: "translateX(4px)" },
              { transform: "translateX(-4px)" },
              { transform: "translateX(4px)" },
              { transform: "translateX(0px)" },
            ],
            { duration: 120, iterations: 1 }
          );
          void anim.finished;
        }
      }
    }
    if (this.announcePlacement) {
      this.announce("Striker overlaps a coin.");
    } else {
      this.announcePlacement = true;
      this.announce("Striker overlaps a coin.");
    }
  }

  private leaveIllegal(): void {
    this.placementMessage.textContent = "";
  }

  private updateGuide(): void {
    if (this.state === null) return;
    const shooter = this.state.turn;
    const guide = aimGuideFirstContact(this.state.pieces, shooter, this.offset, this.aim);
    this.aimGuideEl.dataset.firstContact = guide.firstContact;
    const x = offsetToBoardX(shooter, this.offset);
    const y = strikerBaselineY(shooter);
    this.aimGuideEl.setAttribute("x1", String(x));
    this.aimGuideEl.setAttribute("y1", String(y));
    this.aimGuideEl.setAttribute("x2", String(guide.x));
    this.aimGuideEl.setAttribute("y2", String(guide.y));
  }

  private shoot(): void {
    if (this.state === null || this.matchRoot.dataset.phase !== "aim") return;
    if (this.power <= 0 || !this.legal) return;
    if (this.viewerSeat === null && !this.local) return;
    if (!this.local && this.state.turn !== this.viewerSeat) return;
    const shooter = this.state.turn;
    const { dx, dy } = aimVector(shooter, this.aim);
    this.matchRoot.dataset.phase = "refereeing";
    this.disableControls(true);
    if (this.onShoot !== null) {
      this.onShoot({ x: this.offset, dx, dy, p: Math.round((this.power / 100) * 1000) / 1000 });
    }
  }

  private disableControls(disabled: boolean): void {
    for (const control of [this.strikerSlider, this.aimSlider, this.powerSlider, this.shootButton]) {
      control.disabled = disabled;
    }
  }

  // -- board state application --

  setState(state: MatchState, viewerSeat: Seat | null): void {
    const previous = this.state;
    this.state = state;
    this.viewerSeat = viewerSeat;
    if (state.status === "active" && String(this.matchRoot.dataset.phase) !== "moving") {
      this.matchRoot.dataset.phase = "aim";
    }
    if (state.status === "waiting") this.matchRoot.dataset.phase = "waiting";
    if (state.status === "completed" || state.status === "forfeit" || state.status === "abandoned") {
      this.matchRoot.dataset.phase = "match-over";
    }
    this.matchRoot.dataset.board = String(state.board);
    this.matchRoot.dataset.shotSeq = String(state.shotSeq);
    this.matchRoot.dataset.opponent =
      state.seats.find((s) => s.seat !== state.turn)?.name ?? "";
    this.renderSeats(state);
    this.renderPieces(state);
    this.boardLabel.textContent = this.boardLabelText(state);
    this.breakLabel.textContent =
      state.breakAttempt === null ? "" : `Break attempt ${state.breakAttempt} of 3`;
    this.updateGuide();
    this.updateStrikerForState(state);
    this.updateTurn(state, previous);
    if (previous === null || previous.turn === state.turn) {
      this.matchRoot.dataset.turn = String(state.turn);
      this.matchRoot.dataset.field = state.turn === 0 ? "tomato" : "cobalt";
      this.matchRoot.dataset.opponent =
        state.seats.find((s) => s.seat !== state.turn)?.name ?? "";
    }
    this.startShotClock(state);
  }

  private boardLabelText(state: MatchState): string {
    if (state.format === "quick") return "Board 1 of 1";
    if (state.board === 9) return "Extra board";
    return `Board ${state.board} of 8`;
  }

  private updateTurn(state: MatchState, previous: MatchState | null): void {
    const mine = this.local || (this.viewerSeat !== null && state.turn === this.viewerSeat);
    const seatName = state.seats.find((s) => s.seat === state.turn)?.name ?? "";
    if (this.local) {
      this.turnText.textContent = `${seatName}'s turn`;
    } else {
      this.turnText.textContent = mine ? "Your turn" : `${seatName}'s turn`;
    }
    const field = state.turn === 0 ? "tomato" : "cobalt";
    if (previous !== null && previous.turn !== state.turn) {
      if (prefersReducedMotion()) {
        this.applyField(field);
        this.announceTurnLine(state);
        this.turnBoardIfNeeded(state);
        this.resetAim();
      } else {
        this.wipe(field, state);
      }
    } else if (previous === null) {
      this.applyField(field);
      this.turnBoardIfNeeded(state);
    }
    const canAim = mine && state.status === "active";
    this.disableControls(!canAim);
    if (canAim) this.shootButton.disabled = this.power <= 0 || !this.legal;
  }

  private applyField(field: string): void {
    this.matchRoot.classList.toggle("field-tomato", field === "tomato");
    this.matchRoot.classList.toggle("field-cobalt", field === "cobalt");
  }

  private announceTurnLine(state: MatchState): void {
    const seatName = state.seats.find((s) => s.seat === state.turn)?.name ?? "";
    const mine = this.local || (this.viewerSeat !== null && state.turn === this.viewerSeat);
    this.announce(this.local ? `${seatName}'s turn` : mine ? "Your turn" : `${seatName}'s turn`);
  }

  /** The field wipe: the incoming player's colour crosses the viewport. */
  private wipe(field: string, state: MatchState): void {
    const incoming = state.turn;
    const from: WipeDir = incoming === this.viewerSeat ? "bottom" : "top";
    const wipe = this.fieldWipe;
    wipe.dataset.from = from;
    wipe.style.setProperty("--wipe-colour", field === "tomato" ? "#e04a24" : "#1e3fd8");
    wipe.style.display = "block";
    const anim = wipe.animate(
      from === "bottom"
        ? [
            { transform: "translateY(100%)" },
            { transform: "translateY(0%)" },
          ]
        : [
            { transform: "translateY(-100%)" },
            { transform: "translateY(0%)" },
          ],
      { duration: 520, easing: "ease-in-out", fill: "forwards" }
    );
    anim.addEventListener("finish", () => {
      wipe.style.display = "none";
      this.matchRoot.dataset.turn = String(state.turn);
      this.matchRoot.dataset.field = field;
      this.matchRoot.dataset.opponent =
        state.seats.find((s) => s.seat !== state.turn)?.name ?? "";
      this.applyField(field);
      this.announceTurnLine(state);
      this.turnBoardIfNeeded(state);
      this.resetAim();
    });
  }

  private turnBoardIfNeeded(state: MatchState): void {
    if (!this.local || !this.turnSwitch) return;
    const target: 0 | 180 = this.viewerSeatOfShooter(state);
    if (this.rotation === target) return;
    this.rotation = target;
    if (prefersReducedMotion()) {
      this.rotator.setAttribute("transform", `rotate(${target})`);
      this.rotator.dataset.rotation = String(target);
    } else {
      const anim = this.rotator.animate(
        [{ transform: `rotate(${target - 180}deg)` }, { transform: `rotate(${target}deg)` }],
        { duration: 500, easing: "ease-in-out", fill: "forwards" }
      );
      anim.addEventListener("finish", () => {
        this.rotator.setAttribute("transform", `rotate(${target})`);
        this.rotator.dataset.rotation = String(target);
      });
    }
    this.rotator.dataset.rotation = String(target);
  }

  /** Pass-and-play: the board faces the shooter. */
  private viewerSeatOfShooter(state: MatchState): 0 | 180 {
    return state.turn === 0 ? 0 : 180;
  }

  setTurnSwitch(on: boolean): void {
    this.turnSwitch = on;
    if (!on) {
      this.rotation = 0;
      this.rotator.setAttribute("transform", "rotate(0)");
      this.rotator.dataset.rotation = "0";
    }
  }

  private updateStrikerForState(state: MatchState): void {
    const striker = state.pieces.find((p) => p.id === "striker");
    if (striker === undefined) return;
    const shooter = state.turn;
    this.offset = Math.max(-200, Math.min(200, boardXToOffset(shooter, striker.x)));
    this.strikerSlider.value = String(this.offset);
    this.strikerSlider.setAttribute("aria-valuetext", `${this.offset.toFixed(1)} mm`);
    this.strikerReadout.textContent = `Striker ${this.offset.toFixed(1)} mm`;
  }

  /** Resets the aim for a new turn: the striker sits at the baseline centre. */
  resetAim(): void {
    this.setAim(0);
    this.setPower(0);
    this.updateStriker();
  }

  private renderSeats(state: MatchState): void {
    const rail = this.scoreRail;
    rail.textContent = "";
    for (const seat of state.seats) {
      const cell = document.createElement("div");
      cell.className = "seat-cell";
      cell.append(
        span(`name-${seat.seat}`, seat.name),
        span(`score-${seat.seat}`, String(seat.score)),
        span(`coins-left-${seat.seat}`, `${seat.coinsLeft} ${seat.coinsLeft === 1 ? "coin" : "coins"} left`),
        span(`dues-${seat.seat}`, `Dues owed: ${seat.dues}`)
      );
      rail.appendChild(cell);
    }
    const queenStatus = state.queen.state === "pending"
      ? `Awaiting cover by ${state.seats.find((s) => s.seat === state.queen.seat)?.name ?? ""}`
      : state.queen.state === "covered"
        ? `Covered by ${state.seats.find((s) => s.seat === state.queen.seat)?.name ?? ""}`
        : "On the board";
    rail.appendChild(span("queen-status", queenStatus));
  }

  private renderPieces(state: MatchState): void {
    const ns = "http://www.w3.org/2000/svg";
    const seen = new Set<string>();
    for (const piece of state.pieces) {
      seen.add(piece.id);
      let holder = this.pieceEls.get(piece.id);
      if (holder === undefined) {
        holder = document.createElementNS(ns, "g");
        holder.dataset.pieceId = piece.id;
        if (piece.id === "striker") {
          holder.appendChild(this.strikerShape());
        } else if (piece.id === "queen") {
          holder.appendChild(coinShape("#d33", "#f66"));
        } else {
          const white = piece.id.startsWith("w");
          holder.appendChild(coinShape(white ? "#f5f2ea" : "#1c1a17", white ? "#fff" : "#333"));
        }
        this.piecesLayer.appendChild(holder);
        this.pieceEls.set(piece.id, holder);
        const mirror = document.createElement("div");
        mirror.id = `piece-${piece.id}`;
        mirror.className = "piece-mirror";
        mirror.dataset.id = piece.id;
        this.boardGroup.appendChild(mirror);
        this.pieceMirror.set(piece.id, mirror);
      }
      const mirror = this.pieceMirror.get(piece.id);
      if (mirror !== undefined) {
        mirror.dataset.x = piece.state === "board" ? piece.x.toFixed(1) : "";
        mirror.dataset.y = piece.state === "board" ? piece.y.toFixed(1) : "";
        mirror.dataset.state = piece.state;
        mirror.dataset.pocketedBy = piece.pocketedBy === null ? "" : String(piece.pocketedBy);
        if (piece.id === "striker") {
          mirror.dataset.legal = String(this.legal);
          mirror.dataset.skin =
            state.seats.find((s) => s.seat === state.turn)?.strikerSkin ?? "striker-ply";
        }
      }
      if (piece.state === "pocketed") {
        holder.style.display = "none";
      } else {
        holder.style.display = "block";
        holder.setAttribute("transform", `translate(${piece.x} ${piece.y})`);
      }
    }
    for (const [id, holder] of this.pieceEls) {
      if (!seen.has(id)) holder.style.display = "none";
    }
  }

  private strikerShape(): SVGGElement {
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    const danger = document.createElementNS(ns, "circle");
    danger.setAttribute("r", "26");
    danger.setAttribute("fill", "none");
    danger.setAttribute("stroke", "#14100c");
    danger.setAttribute("stroke-width", "5");
    danger.setAttribute("class", "danger-ring");
    danger.style.display = "none";
    g.appendChild(danger);
    const outline = document.createElementNS(ns, "circle");
    outline.setAttribute("r", String(STRIKER_RADIUS));
    outline.setAttribute("fill", "#f7f2e6");
    outline.setAttribute("stroke", "#14100c");
    outline.setAttribute("stroke-width", "2");
    outline.setAttribute("class", "piece-outline");
    g.appendChild(outline);
    const ring = document.createElementNS(ns, "circle");
    ring.setAttribute("r", "13");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "#1e3fd8");
    ring.setAttribute("stroke-width", "5");
    ring.setAttribute("class", "striker-skin-ring");
    g.appendChild(ring);
    return g;
  }

  // -- pointer and touch --

  private wireBoardPointer(): void {
    const board = this.boardGroup;
    if (board === null) return;
    let dragging: "striker" | "pull" | null = null;
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let scale = 1;

    const boardPoint = (e: PointerEvent): { x: number; y: number } => {
      const rect = this.boardEl.getBoundingClientRect();
      scale = rect.width / 840;
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      return { x: px / scale, y: py / scale };
    };

    board.addEventListener("pointerdown", (e) => {
      if (this.state === null || this.matchRoot.dataset.phase !== "aim") return;
      if (!(this.local || (this.viewerSeat !== null && this.state.turn === this.viewerSeat))) return;
      const p = boardPoint(e);
      const shooter = this.state.turn;
      const sx = offsetToBoardX(shooter, this.offset);
      const sy = strikerBaselineY(shooter);
      const dist = Math.hypot(p.x - sx, p.y - sy);
      if (dist <= STRIKER_RADIUS * 1.4) {
        dragging = "striker";
        startX = p.x;
        startOffset = this.offset;
      } else {
        dragging = "pull";
        startX = p.x;
        startY = p.y;
      }
      board.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    board.addEventListener("pointermove", (e) => {
      if (dragging === null) return;
      const p = boardPoint(e);
      if (dragging === "striker") {
        const deltaOffset = p.x - startX;
        this.setOffset(startOffset + deltaOffset);
        return;
      }
      // pull-back: aim along the pull, power from the pull length
      const pullX = startX - p.x;
      const pullY = startY - p.y;
      const pullLength = Math.hypot(pullX, pullY);
      const maxPull = (840 * 0.4);
      const raw = Math.min(1, pullLength / maxPull);
      const powerPct = Math.round(raw * raw * 100);
      const angle = this.pullAngle(pullX, pullY);
      this.setPower(powerPct);
      this.setAim(angle);
    });

    board.addEventListener("pointerup", (e) => {
      if (dragging === null) return;
      const p = boardPoint(e);
      if (dragging === "pull") {
        const pullX = startX - p.x;
        const pullY = startY - p.y;
        const dist = Math.hypot(p.x - startX, p.y - startY);
        if (dist * scale <= 8) {
          this.setPower(0);
        } else if (this.power > 0 && this.legal) {
          this.shoot();
        }
      }
      dragging = null;
    });

    board.addEventListener("pointercancel", () => {
      dragging = null;
    });
  }

  /** The aim angle of a pull as the shooter sees it. */
  private pullAngle(pullX: number, pullY: number): number {
    if (this.state === null) return 0;
    const shooter = this.state.turn;
    // pull vector points from press toward release inverted; aim opposite the drag
    const aimDx = pullX;
    const aimDy = pullY;
    let deg = (Math.atan2(aimDx, -aimDy) * 180) / Math.PI;
    if (shooter === 1) deg = -deg;
    deg = ((deg + 540) % 360) - 180;
    return Math.round(deg * 10) / 10;
  }

  // -- verdicts and motion --

  showVerdict(word: string, line: string): void {
    this.verdictWord.textContent = word;
    this.verdictLine.textContent = line;
    this.verdict.style.display = "block";
    this.announce(line);
    if (this.verdictTimer !== null) window.clearTimeout(this.verdictTimer);
    if (prefersReducedMotion()) {
      this.verdict.classList.add("no-motion");
    } else {
      this.verdict.classList.remove("no-motion");
      this.verdict.animate(
        [
          { transform: "translateY(-30px)", opacity: "0" },
          { transform: "translateY(0px)", opacity: "1" },
        ],
        { duration: 200, easing: "ease-out", fill: "forwards" }
      );
      this.verdictWord.animate(
        [
          { transform: "scale(0.4)", opacity: "0.4" },
          { transform: "scale(1)", opacity: "1" },
        ],
        { duration: 250, easing: "ease-out", fill: "forwards" }
      );
    }
    this.verdictTimer = window.setTimeout(() => {
      const hide = this.verdict.animate(
        [
          { transform: "translateY(0)", opacity: "1" },
          { transform: "translateY(-30px)", opacity: "0" },
        ],
        { duration: 150, easing: "ease-in", fill: "forwards" }
      );
      hide.addEventListener("finish", () => {
        this.verdict.style.display = "none";
      });
    }, this.bannerMs);
  }

  /** Plays the server's frames, then applies the final state. */
  playShot(
    result: ShotResult,
    onDone: () => void
  ): void {
    this.matchRoot.dataset.phase = "moving";
    const applyFinal = () => {
      this.applyFinalPositions(result);
      // The pieces have reached their final server positions; the pages then
      // settle back to aim (or a finished phase) from their own state updates.
      if (String(this.matchRoot.dataset.phase) === "moving") {
        this.matchRoot.dataset.phase = result.match.status === "active" ? "aim" : "match-over";
      }
      this.setStateFromServer(result.match, this.viewerSeat);
      onDone();
    };
    if (prefersReducedMotion() || result.frames.length <= 1) {
      window.setTimeout(applyFinal, result.frames.length > 1 ? 320 : 0);
      return;
    }
    const total = result.frames[result.frames.length - 1].t;
    const speed = Math.max(1, total / 1.2);
    let index = 0;
    const step = () => {
      if (index >= result.frames.length) {
        applyFinal();
        return;
      }
      const frame = result.frames[index];
      for (const piece of frame.pieces) {
        const holder = this.pieceEls.get(piece.id);
        if (holder !== undefined) holder.setAttribute("transform", `translate(${piece.x} ${piece.y})`);
      }
      index += 1;
      window.setTimeout(step, (1000 / 60) / speed);
    };
    step();
  }

  skipPlayback(): void {
    // the onSkip handler jumps the current playback; handled by pages
  }

  private applyFinalPositions(result: ShotResult): void {
    for (const piece of result.final) {
      const mirror = this.pieceMirror.get(piece.id);
      if (mirror !== undefined) {
        mirror.dataset.x = piece.x === null ? "" : piece.x.toFixed(1);
        mirror.dataset.y = piece.y === null ? "" : piece.y.toFixed(1);
        mirror.dataset.state = piece.state;
      }
      const holder = this.pieceEls.get(piece.id);
      if (holder !== undefined) {
        if (piece.state === "pocketed" || piece.x === null) {
          holder.style.display = "none";
        } else {
          holder.style.display = "block";
          holder.setAttribute("transform", `translate(${piece.x} ${piece.y})`);
        }
      }
    }
  }

  setStateFromServer(state: MatchState, viewerSeat: Seat | null): void {
    this.setState(state, viewerSeat);
  }

  // -- shot clock --

  private startShotClock(state: MatchState): void {
    if (this.local) return;
    if (this.shotClockTimer !== null) {
      window.clearInterval(this.shotClockTimer);
      this.shotClockTimer = null;
    }
    if (state.turnRemainingMs === null || state.status !== "active") {
      this.shotTimer.textContent = "";
      return;
    }
    this.shotDeadline = Date.now() + state.turnRemainingMs;
    const tick = () => {
      if (this.shotDeadline === null) {
        this.shotTimer.textContent = "";
        return;
      }
      const remaining = Math.max(0, this.shotDeadline - Date.now());
      this.shotTimer.textContent = clockTextOf(remaining);
      if (remaining <= 0 && this.shotClockTimer !== null) {
        window.clearInterval(this.shotClockTimer);
        this.shotClockTimer = null;
      }
    };
    tick();
    this.shotClockTimer = window.setInterval(tick, 250);
  }

  // -- announcer and emotes --

  announce(text: string): void {
    const line = document.createElement("div");
    line.textContent = text;
    this.announcer.appendChild(line);
    while (this.announcer.childElementCount > 30) {
      this.announcer.firstElementChild?.remove();
    }
  }

  showEmote(seat: Seat, emote: string): void {
    const label = emoteLabel(emote);
    const name = this.state?.seats.find((s) => s.seat === seat)?.name ?? "Player";
    this.emoteBubble.textContent = `${name}: ${label}`;
    this.emoteBubble.style.display = "block";
    this.announce(`${name}: ${label}`);
    window.setTimeout(() => {
      this.emoteBubble.style.display = "none";
    }, 4000);
  }

  private openEmotes(): void {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.className = "emote-menu";
    for (const emote of EMOTE_LIST) {
      const item = document.createElement("button");
      item.setAttribute("role", "menuitem");
      item.textContent = emoteLabel(emote);
      item.addEventListener("click", () => {
        menu.remove();
        if (this.onEmote !== null) this.onEmote(emote);
      });
      menu.appendChild(item);
    }
    const anchor = this.emotesButton;
    if (anchor === null) return;
    menu.style.position = "absolute";
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.left = `${rect.left}px`;
    document.body.appendChild(menu);
    const first = menu.querySelector<HTMLElement>("button");
    if (first !== null) first.focus();
    const close = (e: Event): void => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", close);
      }
    };
    document.addEventListener("click", close);
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        menu.remove();
        anchor.focus();
      }
    });
  }

  setGhost(preview: { seat: Seat; x: number; dx: number; dy: number; p: number }): void {
    this.ghostPreview = preview;
    if (this.state === null) return;
    const x = offsetToBoardX(preview.seat, preview.x);
    const y = strikerBaselineY(preview.seat);
    let ghost = this.ghostLayer.querySelector<SVGGElement>("#ghost-striker");
    if (ghost === null) {
      const ns = "http://www.w3.org/2000/svg";
      ghost = document.createElementNS(ns, "g");
      ghost.id = "ghost-striker";
      ghost.setAttribute("opacity", "0.4");
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("r", String(STRIKER_RADIUS));
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", "#14100c");
      circle.setAttribute("stroke-width", "2");
      ghost.appendChild(circle);
      const aimLine = document.createElementNS(ns, "line");
      aimLine.id = "ghost-aim";
      ghost.appendChild(aimLine);
      this.ghostLayer.appendChild(ghost);
    }
    ghost.setAttribute("transform", `translate(${x} ${y})`);
    ghost.dataset.x = x.toFixed(1);
    ghost.dataset.y = y.toFixed(1);
    const aimLine = ghost.querySelector<SVGLineElement>("#ghost-aim");
    if (aimLine !== null) {
      const len = 220;
      aimLine.setAttribute("x1", "0");
      aimLine.setAttribute("y1", "0");
      aimLine.setAttribute("x2", String(preview.dx * len));
      aimLine.setAttribute("y2", String(preview.dy * len));
    }
  }

  sendPreviewThrottled(x: number, dx: number, dy: number, p: number): void {
    // pages decide how to send; this only holds the last value
  }
}

const EMOTE_LIST = ["nice-shot", "well-played", "oops", "thinking", "good-game", "hello"];

export function emoteLabel(emote: string): string {
  const labels: Record<string, string> = {
    "nice-shot": "Nice shot",
    "well-played": "Well played",
    oops: "Oops",
    thinking: "Thinking",
    "good-game": "Good game",
    hello: "Hello",
  };
  return labels[emote] ?? emote;
}

function clockTextOf(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function slider(
  label: string, id: string, min: number, max: number, step: number, value: number
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute("aria-label", label);
  return input;
}

function span(id: string, text: string): HTMLElement {
  const s = document.createElement("span");
  s.id = id;
  s.textContent = text;
  return s;
}

function coinShape(fill: string, stroke: string): SVGGElement {
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  const circle = document.createElementNS(ns, "circle");
  circle.setAttribute("r", String(COIN_RADIUS));
  circle.setAttribute("fill", fill);
  circle.setAttribute("stroke", stroke);
  circle.setAttribute("stroke-width", "1.4");
  g.appendChild(circle);
  const inner = document.createElementNS(ns, "circle");
  inner.setAttribute("r", "9");
  inner.setAttribute("fill", "none");
  inner.setAttribute("stroke", "rgba(20,16,12,0.4)");
  inner.setAttribute("stroke-width", "1.4");
  g.appendChild(inner);
  return g;
}
