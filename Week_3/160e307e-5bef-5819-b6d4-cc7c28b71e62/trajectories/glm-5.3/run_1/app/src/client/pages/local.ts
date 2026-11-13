import { api, mountOutageBanner, loadingEl, el, type Me } from "../lib/app.js";
import { Modal, PersistentModal } from "../lib/modal.js";
import {
  MatchView, type MatchState, type ShotResult,
} from "../lib/match-view.js";
import {
  simulate,
  strikeBodies,
  ruleShot,
  matchOverCheck,
  extraBoardNeeded,
  nextBoard,
  intentValid,
  isPlacementLegal,
  mm,
  openingBoardPieces,
  type BoardState,
  type Seat,
  type Format,
  type Ruling,
} from "../../shared/rules.js";

interface PendingLocalMatch {
  body: string;
}

const PENDING_KEY = "dc_pending_local_matches";

function pendingMatches(): PendingLocalMatch[] {
  try {
    return JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "[]") as PendingLocalMatch[];
  } catch {
    return [];
  }
}

function savePending(list: PendingLocalMatch[]): void {
  window.localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

interface LocalSetup {
  format: Format;
  players: [string, string];
  turnSwitch: boolean;
}

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  root.appendChild(loadingEl());
  let me: Me | null = null;
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  api.invalidate();
  root.textContent = "";

  // Resend any saved-on-device matches.
  void resendPending();

  const saved = readSetup();
  if (saved === null) {
    renderSetup(root, me);
    return;
  }
  renderMatch(root, me, saved);
}

function readSetup(): LocalSetup | null {
  try {
    const raw = window.sessionStorage.getItem("dc_local_setup");
    if (raw === null) return null;
    return JSON.parse(raw) as LocalSetup;
  } catch {
    return null;
  }
}

function writeSetup(setup: LocalSetup | null): void {
  if (setup === null) window.sessionStorage.removeItem("dc_local_setup");
  else window.sessionStorage.setItem("dc_local_setup", JSON.stringify(setup));
}

async function resendPending(): Promise<void> {
  const list = pendingMatches();
  if (list.length === 0) return;
  const remaining: PendingLocalMatch[] = [];
  for (const item of list) {
    try {
      const res = await fetch("/api/local-matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: item.body,
      });
      if (res.status !== 201) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  savePending(remaining);
}

// ---------------------------------------------------------------------------
// Setup form.
// ---------------------------------------------------------------------------

function renderSetup(root: HTMLElement, _me: Me | null): void {
  const page = el("div", { class: "page" });
  const h1 = el("h1", { class: "display", style: "font-size: 40px" }, "Pass and play");
  const form = el("div", { class: "form" });

  const formatGroup = el("div", { class: "radio-group", role: "radiogroup", "aria-label": "Format" });
  const quick = radio("format", "Quick", "quick", true);
  const classic = radio("format", "Classic", "classic", false);
  formatGroup.append(quick.input, quick.label, classic.input, classic.label);

  const p1Label = el("label", { for: "player1" }, "Player 1 name");
  const p1 = document.createElement("input");
  p1.type = "text";
  p1.id = "player1";
  p1.value = "Player 1";
  p1.setAttribute("aria-label", "Player 1 name");

  const p2Label = el("label", { for: "player2" }, "Player 2 name");
  const p2 = document.createElement("input");
  p2.type = "text";
  p2.id = "player2";
  p2.value = "Player 2";
  p2.setAttribute("aria-label", "Player 2 name");

  const switchLabel = el("label", { for: "turn-switch" }, "Turn the board each turn");
  const turnSwitch = document.createElement("input");
  turnSwitch.type = "checkbox";
  turnSwitch.id = "turn-switch";
  turnSwitch.setAttribute("role", "switch");
  turnSwitch.setAttribute("aria-label", "Turn the board each turn");
  turnSwitch.checked = true;

  const start = el("button", { class: "btn btn-primary" }, "Start");

  form.append(h1, formatGroup, p1Label, p1, p2Label, p2, switchLabel, turnSwitch, start);
  page.appendChild(form);
  root.appendChild(page);

  const go = () => {
    const setup: LocalSetup = {
      format: classic.input.checked ? "classic" : "quick",
      players: [p1.value.trim() === "" ? "Player 1" : p1.value.trim(), p2.value.trim() === "" ? "Player 2" : p2.value.trim()],
      turnSwitch: turnSwitch.checked,
    };
    writeSetup(setup);
    window.location.reload();
  };

  start.addEventListener("click", go);
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.activeElement !== turnSwitch) {
      e.preventDefault();
      go();
    }
  });
  turnSwitch.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      turnSwitch.checked = !turnSwitch.checked;
      turnSwitch.dispatchEvent(new Event("change"));
    }
  });
}

function radio(
  name: string, labelText: string, value: string, checked: boolean
): { input: HTMLInputElement; label: HTMLLabelElement } {
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.id = `${name}-${value}`;
  input.value = value;
  input.checked = checked;
  input.setAttribute("aria-label", labelText);
  const label = el("label", { for: input.id }, labelText);
  return { input, label };
}

// ---------------------------------------------------------------------------
// The match itself, ruled locally with the shared model.
// ---------------------------------------------------------------------------

function renderMatch(root: HTMLElement, me: Me | null, setup: LocalSetup): void {
  let state: BoardState = {
    pieces: openingBoardPieces(0),
    turn: 0,
    scores: [0, 0],
    dues: [0, 0],
    timeouts: [0, 0],
    queen: { state: "board", seat: null },
    breakAttempt: 1,
    boardNumber: 1,
    format: setup.format,
    whiteSeat: 0,
  };
  const shots: { seat: Seat; x: number; dx: number; dy: number; p: number }[] = [];
  let resignedSeat: Seat | null = null;
  let skippedFrames = false;
  let finished = false;

  const view = new MatchView({
    local: true,
    bannerMs: 2000,
    onShoot: (intent) => {
      // The shared model rules the shot on the device.
      const shooter = state.turn;
      if (!intentValid(intent)) return;
      if (!isPlacementLegal(state.pieces, shooter, intent.x)) return;
      const bodies = strikeBodies(state.pieces, shooter, intent.x, intent.dx, intent.dy, intent.p);
      const sim = simulate(bodies, true);
      const moved = state.pieces.map((piece) => {
        const final = sim.final.find((f) => f.id === piece.id);
        if (final === undefined) return piece;
        return { ...piece, x: final.x ?? piece.x, y: final.y ?? piece.y, state: final.state };
      });
      const ruling = ruleShot({ ...state, pieces: moved }, sim.events);
      shots.push({ seat: shooter, ...intent });
      const result: ShotResult = {
        shotSeq: shots.length,
        seat: shooter,
        events: {
          firstContact: sim.events.firstContact === "cushion" ? "cushion" : sim.events.firstContact,
          pocketed: sim.events.pocketed.map((p) => ({ id: p.id, pocket: p.pocket })),
          strikerPocketed: sim.events.strikerPocketed,
        },
        verdict: { word: ruling.word, line: ruling.line },
        frames: sim.frames.map((f) => ({
          t: f.t,
          pieces: f.pieces.map((p) => ({ id: p.id, x: p.x, y: p.y })),
        })),
        final: [],
        match: viewState(ruling),
        boardEnd: ruling.boardEnd,
        matchOver: ruling.matchOver,
      };
      skippedFrames = false;
      view.playShot(result, () => {
        applyRuling(ruling);
      });
    },
    onSkip: () => {
      skippedFrames = true;
    },
    onMenu: () => openMenu(),
  });
  view.setTurnSwitch(setup.turnSwitch);
  root.appendChild(view.root);
  view.setState(viewStateFromRules(state, setup), 0);
  view.announce(`${setup.players[0]} won the toss and breaks with white.`);

  function applyRuling(ruling: Ruling): void {
    const boardEnd = ruling.boardEnd;
    if (boardEnd !== null && ruling.matchOver) {
      // the board that ends the match
      const scores = [...state.scores] as [number, number];
      scores[boardEnd.winnerSeat] += boardEnd.points;
      finished = true;
      view.showVerdict(ruling.word, ruling.line);
      window.setTimeout(() => {
        showMatchOver(boardEnd.winnerSeat, scores, "played", boardEnd.pointsLine);
      }, 1600);
      return;
    }
    if (boardEnd !== null) {
      const nb = nextBoard(state, boardEnd, state.boardNumber + 1);
      if (extraBoardNeeded(state, boardEnd)) nb.boardNumber = 9;
      state = nb;
      view.showVerdict(ruling.word, ruling.line);
      window.setTimeout(() => {
        view.setState(viewStateFromRules(state, setup), 0);
        view.announce(`${setup.players[boardEnd.winnerSeat]} wins board ${state.boardNumber - 1}. ${boardEnd.pointsLine}`);
      }, 1200);
      return;
    }
    state = {
      ...state,
      pieces: ruling.pieces,
      turn: ruling.turn,
      dues: ruling.dues,
      queen: ruling.queen,
      breakAttempt: ruling.breakAttempt,
    };
    view.showVerdict(ruling.word, ruling.line);
    view.setState(viewStateFromRules(state, setup), 0);
    }

  function viewState(ruling: Ruling): MatchState {
    const pieces = ruling.pieces.map((p) => ({
      ...p,
      x: p.state === "board" ? mm(p.x) : p.x,
      y: p.state === "board" ? mm(p.y) : p.y,
    }));
    return {
      id: "local",
      mode: "private",
      format: setup.format,
      status: "active",
      board: state.boardNumber,
      turn: ruling.turn,
      phase: "aim",
      shotSeq: shots.length,
      breakAttempt: ruling.breakAttempt,
      seats: [
        {
          seat: 0,
          playerId: "local-0",
          name: setup.players[0],
          avatar: 1,
          color: state.whiteSeat === 0 ? "white" : "black",
          score: state.scores[0],
          coinsLeft: pieces.filter((p) => p.id.startsWith("w") && p.state === "board").length,
          dues: ruling.dues[0],
          timeouts: 0,
          connected: true,
          ready: true,
          strikerSkin: "striker-ply",
        },
        {
          seat: 1,
          playerId: "local-1",
          name: setup.players[1],
          avatar: 2,
          color: state.whiteSeat === 1 ? "white" : "black",
          score: state.scores[1],
          coinsLeft: pieces.filter((p) => p.id.startsWith("b") && p.state === "board").length,
          dues: ruling.dues[1],
          timeouts: 0,
          connected: true,
          ready: true,
          strikerSkin: "striker-ply",
        },
      ],
      queen: ruling.queen,
      pieces,
      turnRemainingMs: null,
      winnerSeat: null,
      endReason: null,
      roomCode: null,
      viewerSeat: null,
    };
  }

  function viewStateFromRules(s: BoardState, setup2: LocalSetup): MatchState {
    const pieces = s.pieces.map((p) => ({
      ...p,
      x: p.state === "board" ? mm(p.x) : p.x,
      y: p.state === "board" ? mm(p.y) : p.y,
    }));
    const whiteCoins = pieces.filter((p) => p.id.startsWith("w") && p.state === "board").length;
    const blackCoins = pieces.filter((p) => p.id.startsWith("b") && p.state === "board").length;
    return {
      id: "local",
      mode: "private",
      format: setup2.format,
      status: "active",
      board: s.boardNumber,
      turn: s.turn,
      phase: "aim",
      shotSeq: shots.length,
      breakAttempt: s.breakAttempt,
      seats: [
        {
          seat: 0,
          playerId: "local-0",
          name: setup2.players[0],
          avatar: 1,
          color: s.whiteSeat === 0 ? "white" : "black",
          score: s.scores[0],
          coinsLeft: s.whiteSeat === 0 ? whiteCoins : blackCoins,
          dues: s.dues[0],
          timeouts: 0,
          connected: true,
          ready: true,
          strikerSkin: "striker-ply",
        },
        {
          seat: 1,
          playerId: "local-1",
          name: setup2.players[1],
          avatar: 2,
          color: s.whiteSeat === 1 ? "white" : "black",
          score: s.scores[1],
          coinsLeft: s.whiteSeat === 1 ? whiteCoins : blackCoins,
          dues: s.dues[1],
          timeouts: 0,
          connected: true,
          ready: true,
          strikerSkin: "striker-ply",
        },
      ],
      queen: s.queen,
      pieces,
      turnRemainingMs: null,
      winnerSeat: null,
      endReason: null,
      roomCode: null,
      viewerSeat: null,
    };
  }

  function openMenu(): void {
    const dialog = new Modal("Menu", (_dialog, close) => {
      const body = el("div", { class: "form" });
      const rulesButton = el("button", { class: "btn" }, "Rules");
      const resignButton = el("button", { class: "btn" }, "Resign");
      const closeButton = el("button", { class: "btn" }, "Close");
      closeButton.setAttribute("aria-label", "Close");
      rulesButton.addEventListener("click", () => {
        close(false);
        openRules();
      });
      resignButton.addEventListener("click", () => {
        close(false);
        openResign();
      });
      closeButton.addEventListener("click", () => close(false));
      body.append(rulesButton, resignButton, closeButton);
      return body;
    }, document.getElementById("menu"));
    dialog.open();
  }

  function openRules(): void {
    const dialog = new Modal("Rules", (_dialog, close) => {
      const body = el("div", { class: "form" });
      const h2 = el("h2", {}, "Rules");
      const rules = el("ul", { class: "rules-list" });
      for (const line of [
        "Pocket your own coins. The queen must be covered by your next pocket.",
        "Pocket the striker and you owe a due coin.",
        "A board ends when a player clears their coins: 1 point per opponent coin left, 3 for a covered queen.",
        "Classic plays to 25 points or 8 boards.",
      ]) {
        rules.appendChild(el("li", {}, line));
      }
      const closeButton = el("button", { class: "btn" }, "Close");
      closeButton.setAttribute("aria-label", "Close");
      closeButton.addEventListener("click", () => close(false));
      body.append(h2, rules, closeButton);
      return body;
    }, document.getElementById("menu"));
    dialog.open();
  }

  function openResign(): void {
    const dialog = new Modal("Resign this match?", (_dialog, close) => {
      const body = el("div", { class: "form" });
      const h2 = el("h2", {}, "Resign this match?");
      const resignButton = el("button", { class: "btn btn-primary" }, "Resign");
      const keepButton = el("button", { class: "btn" }, "Keep playing");
      resignButton.addEventListener("click", () => {
        close(true);
        resignedSeat = state.turn;
        finished = true;
        const winner = (1 - state.turn) as Seat;
        showMatchOver(winner, state.scores, "resigned", null);
      });
      keepButton.addEventListener("click", () => close(false));
      body.append(h2, resignButton, keepButton);
      return body;
    }, document.getElementById("menu"));
    dialog.open();
  }

  function showMatchOver(
    winnerSeat: Seat,
    scores: [number, number],
    endReason: "played" | "resigned",
    pointsLine: string | null
  ): void {
    const winnerName = setup.players[winnerSeat];
    view.announce(`Match over. Final score ${scores[0]}-${scores[1]}.`);
    const modal = new PersistentModal("Match over", () => {
      const body = el("div", { class: "form match-over" });
      const h2 = el("h2", { class: "display", style: "font-size:36px" }, `${winnerName} wins`);
      const finalScore = el("p", { id: "final-score" }, `Final score ${scores[0]}-${scores[1]}`);
      const endLine = el("p", { id: "end-reason" },
        endReason === "resigned" ? `${setup.players[resignedSeat ?? state.turn]} resigned` : "");
      const points = el("p", { id: "board-points" }, pointsLine ?? "");
      if (pointsLine === null) points.style.display = "none";
      const chalk = el("p", { id: "chalk-earned" }, "+10 chalk");
      const saveStatus = el("p", { id: "save-status" }, "Saving...");
      const home = el("a", { class: "btn btn-primary", href: "/" }, "Home");
      const newMatch = el("button", { class: "btn" }, "New match");
      body.append(h2, finalScore, endLine, points, chalk, saveStatus, home, newMatch);
      newMatch.addEventListener("click", () => {
        writeSetup(null);
        window.location.reload();
      });
      void (async () => {
        const idempotencyKey = `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const payload = {
          format: setup.format,
          players: [{ name: setup.players[0] }, { name: setup.players[1] }],
          shots,
          resignedSeat,
          claimed: { winnerSeat, scores },
          modelVersion: "dc-model-1",
          idempotencyKey,
        };
        const bodyJson = JSON.stringify(payload);
        try {
          const res = await fetch("/api/local-matches", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: bodyJson,
          });
          if (res.status === 201) {
            saveStatus.textContent = "Saved to your history.";
          } else {
            saveStatus.textContent = "Saved on this device. It will be added to your history when online.";
            savePending([...pendingMatches(), { body: bodyJson }]);
          }
        } catch {
          saveStatus.textContent = "Saved on this device. It will be added to your history when online.";
          savePending([...pendingMatches(), { body: bodyJson }]);
        }
      })();
      return body;
    });
    modal.open();
  }

  // resend saved matches every 30 seconds
  window.setInterval(() => void resendPending(), 30000);
}

void main();
