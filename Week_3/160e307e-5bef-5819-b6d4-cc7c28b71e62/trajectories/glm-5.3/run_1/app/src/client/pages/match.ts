import { api, jsonFetch, mountOutageBanner, loadingEl, el, clockText, type Me } from "../lib/app.js";
import { Modal, PersistentModal } from "../lib/modal.js";
import { socket, type ServerMessage } from "../lib/socket.js";
import { MatchView, type MatchState, type ShotResult } from "../lib/match-view.js";
import type { Seat } from "../../shared/rules.js";

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  const matchId = window.location.pathname.split("/").pop() ?? "";
  root.appendChild(loadingEl());
  let me: Me | null = null;
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  api.invalidate();
  const { status, body } = await jsonFetch<MatchState>(`/api/matches/${matchId}`);
  if (status !== 200) {
    root.textContent = "";
    const page = el("div", { class: "page" });
    page.append(el("h1", {}, "Match not found"), el("a", { class: "btn", href: "/" }, "Home"));
    root.appendChild(page);
    return;
  }

  const match = body;
  const viewerSeat: Seat | null = match.viewerSeat ?? null;
  const config = await api.config();

  let current = match;
  let lastShotSeq = match.shotSeq;
  let skipRequested = false;

  const view = new MatchView({
    local: false,
    bannerMs: config.verdictBannerMs,
    onShoot: (intent) => {
      void (async () => {
        const res = await jsonFetch<ShotResult & { error?: string }>(`/api/matches/${matchId}/shots`, {
          method: "POST",
          body: JSON.stringify({
            shotSeq: lastShotSeq + 1,
            x: intent.x,
            dx: intent.dx,
            dy: intent.dy,
            p: intent.p,
            modelVersion: "dc-model-1",
          }),
        });
        if (res.status === 200) {
          lastShotSeq = res.body.shotSeq;
          handleShotResult(res.body);
          return;
        }
        const messages: Record<string, string> = {
          NOT_YOUR_TURN: "It's not your turn.",
          TURN_EXPIRED: "Time ran out. The turn has passed.",
          ILLEGAL_PLACEMENT: "Striker overlaps a coin.",
          INVALID_INTENT: "That shot isn't valid. Aim again.",
          RATE_LIMITED: "Too many moves. Wait a moment.",
          CLIENT_OUTDATED: "A new version is available. Reload to keep playing.",
          STALE_SEQ: "That shot isn't valid. Aim again.",
        };
        const message = messages[res.body.error ?? ""] ?? "That shot isn't valid. Aim again.";
        showShotError(message);
        view.matchRoot.dataset.phase = "aim";
        current = res.body as unknown as MatchState;
        view.setStateFromServer(current, viewerSeat);
      })();
    },
    onSkip: () => {
      skipRequested = true;
    },
    onMenu: () => openMenu(),
    onEmote: (emote) => {
      void jsonFetch(`/api/matches/${matchId}/emotes`, {
        method: "POST",
        body: JSON.stringify({ emote }),
      });
    },
    onPreview: (x, dx, dy, p) => {
      socket.send({ type: "aim", x, dx, dy, p });
    },
  });
  root.textContent = "";
  root.appendChild(view.root);
  view.setStateFromServer(current, viewerSeat);
  const tossSeat = current.turn;
  const tossName = current.seats.find((s) => s.seat === tossSeat)?.name ?? "";
  view.announce(`${tossName} won the toss and breaks with white.`);

  socket.connect(matchId, {
    onMessage: (msg: ServerMessage) => {
      switch (msg.type) {
        case "state": {
          const state = msg as unknown as MatchState;
          current = state;
          lastShotSeq = state.shotSeq;
          if (state.status === "completed" || state.status === "forfeit" || state.status === "abandoned") {
            handleMatchEnd(state);
            return;
          }
          view.setStateFromServer(state, viewerSeat);
          if (viewerSeat !== null) {
            const opponent = state.seats.find((s) => s.seat !== viewerSeat);
            if (opponent !== undefined && !opponent.connected) {
              showReconnectOverlay(config.reconnectSeconds * 1000);
            } else {
              hideReconnectOverlay();
            }
          }
          return;
        }
        case "shotResult": {
          const result = msg as unknown as ShotResult & { verdict?: { word: string; line: string }; timeout?: boolean; seat?: Seat };
          if (result.timeout === true) {
            view.showVerdict(result.verdict?.word ?? "TIME UP", result.verdict?.line ?? "Time's up. The turn passes.");
            const state = (msg as unknown as { match: MatchState }).match;
            if (state !== undefined) {
              current = state;
              view.setStateFromServer(state, viewerSeat);
            }
            return;
          }
          if (result.verdict !== undefined && result.frames === undefined) {
            // timeout push
            view.showVerdict(result.verdict.word, result.verdict.line);
            return;
          }
          const shot = msg as unknown as ShotResult;
          lastShotSeq = shot.shotSeq;
          handleShotResult(shot);
          return;
        }
        case "preview": {
          const preview = msg as unknown as { seat: Seat; x: number; dx: number; dy: number; p: number };
          view.setGhost(preview);
          return;
        }
        case "emote": {
          const emote = msg as unknown as { seat: Seat; emote: string };
          view.showEmote(emote.seat, emote.emote);
          return;
        }
        case "opponentStatus": {
          const status2 = msg as unknown as { connected: boolean; reconnectRemainingMs: number };
          if (!status2.connected) {
            showReconnectOverlay(status2.reconnectRemainingMs);
          } else {
            hideReconnectOverlay();
          }
          return;
        }
        case "rematchStatus": {
          const status2 = msg as unknown as { status: string; matchId: string | null };
          handleRematch(status2.status, status2.matchId);
          return;
        }
        case "roomStatus": {
          return;
        }
        default:
          return;
      }
    },
  });

  let shotInProgress = false;
  let queuedResult: ShotResult | null = null;

  function handleShotResult(shot: ShotResult): void {
    if (shotInProgress) {
      queuedResult = shot;
      return;
    }
    shotInProgress = true;
    skipRequested = false;
    current = shot.match;
    view.playShot(shot, () => {
      shotInProgress = false;
      lastShotSeq = shot.shotSeq;
      view.showVerdict(shot.verdict.word, shot.verdict.line);
      const winnerName =
        shot.match.seats.find((s) => s.seat === shot.boardEnd?.winnerSeat)?.name ?? "";
      if (shot.boardEnd !== null && shot.matchOver) {
        // The board that ends the match: straight to Match over with the points line.
        view.announce(`${winnerName} wins board ${Math.max(1, shot.match.board - 1)}. ${shot.boardEnd.pointsLine}`);
        view.matchRoot.dataset.phase = "match-over";
        showMatchOverFromShot(shot);
        return;
      }
      if (shot.boardEnd !== null) {
        // A board ends and the match goes on: the Board over sheet names the winner.
        const boardNumber = Math.max(1, shot.match.board - 1);
        view.announce(`${winnerName} wins board ${boardNumber}. ${shot.boardEnd.pointsLine}`);
        view.matchRoot.dataset.phase = "board-over";
        showBoardOver(shot);
        return;
      }
      view.matchRoot.dataset.phase = shot.match.status === "active" ? "aim" : view.matchRoot.dataset.phase;
      const next = queuedResult;
      queuedResult = null;
      if (next !== null) {
        window.setTimeout(() => handleShotResult(next), 2200);
      }
    });
  }

  /** Match over from a shot that won the board: the dialog carries the points line. */
  function showMatchOverFromShot(shot: ShotResult): void {
    const state = shot.match;
    const boardEnd = shot.boardEnd;
    const winnerSeat = state.winnerSeat;
    const viewerWon = viewerSeat !== null && viewerSeat === winnerSeat;
    const heading = viewerSeat === null
      ? `${state.seats.find((s) => s.seat === winnerSeat)?.name ?? ""} wins`
      : viewerWon ? "You won" : "You lost";
    const yourScore = viewerSeat === null ? state.seats[0].score : state.seats[viewerSeat]?.score ?? 0;
    const theirScore = viewerSeat === null ? state.seats[1].score : state.seats[1 - (viewerSeat ?? 0)]?.score ?? 0;
    view.announce(`Match over. Final score ${yourScore}-${theirScore}.`);
    const modal = new PersistentModal("Match over", () => {
      const body = el("div", { class: "form match-over" });
      const h2 = el("h2", { class: "display", style: "font-size:36px" }, heading);
      const finalScore = el("p", { id: "final-score" }, `Final score ${yourScore}-${theirScore}`);
      const points = el("p", { id: "board-points" }, boardEnd?.pointsLine ?? "");
      const ratingChange = el("p", { id: "rating-change" }, "");
      const chalk = el("p", { id: "chalk-earned" }, "+20 chalk");
      const home = el("a", { class: "btn btn-primary", href: "/" }, "Home");
      body.append(h2, finalScore, points, ratingChange, chalk, home);
      if (state.mode !== "ranked") ratingChange.style.display = "none";
      void (async () => {
        const hist = await jsonFetch<{ matches: { matchId: string; ratingDelta: number | null }[] }>(
          `/api/players/${me?.id ?? ""}/history`
        );
        const row = hist.body.matches.find((m) => m.matchId === matchId);
        if (row !== undefined && row.ratingDelta !== null) {
          const me2 = await api.me();
          ratingChange.textContent = `Rating ${Math.round(me2.rating)} (${row.ratingDelta >= 0 ? "+" : ""}${Math.round(row.ratingDelta)})`;
        } else {
          ratingChange.style.display = "none";
        }
      })();
      return body;
    });
    modal.open();
  }

  /** The Board over sheet: names the winner, explains the points, next board. */
  function showBoardOver(shot: ShotResult): void {
    const boardEnd = shot.boardEnd;
    if (boardEnd === null) return;
    const winnerName = shot.match.seats.find((s) => s.seat === boardEnd.winnerSeat)?.name ?? "";
    // The board that just ended is one below the board the server set up next.
    const boardNumber = Math.max(1, shot.match.board - 1);
    const dialog = new Modal("Board over", (_dialog, close) => {
      const body = el("div", { class: "form" });
      const h2 = el("h2", { class: "display", style: "font-size:32px" }, `${winnerName} wins board ${boardNumber}`);
      const points = el("p", { id: "board-points" }, boardEnd.pointsLine);
      const next = el("button", { class: "btn btn-primary" }, "Next board");
      next.addEventListener("click", () => {
        close(false);
        // The server has already set up the next board; refetch and aim.
        void (async () => {
          const res = await jsonFetch<MatchState>(`/api/matches/${matchId}`);
          if (res.status === 200) {
            current = res.body;
            lastShotSeq = res.body.shotSeq;
            view.matchRoot.dataset.phase = "aim";
            view.setStateFromServer(res.body, viewerSeat);
          }
        })();
      });
      body.append(h2, points, next);
      return body;
    }, document.getElementById("board"));
    dialog.open();
  }

  function showShotError(message: string): void {
    const errorEl = document.getElementById("shot-error");
    if (errorEl !== null) errorEl.textContent = message;
    view.announce(message);
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
        const rules = new Modal("Rules", (_d, c2) => {
          const rulesBody = el("div", { class: "form" });
          const h2 = el("h2", {}, "Rules");
          const list = el("ul", { class: "rules-list" });
          for (const line of [
            "Pocket your own coins. The queen must be covered by your next pocket.",
            "Pocket the striker and you owe a due coin.",
            "A board ends when a player clears their coins: 1 point per opponent coin left, 3 for a covered queen.",
            "Classic plays to 25 points or 8 boards.",
          ]) {
            list.appendChild(el("li", {}, line));
          }
          const closeRules = el("button", { class: "btn" }, "Close");
          closeRules.setAttribute("aria-label", "Close");
          closeRules.addEventListener("click", () => c2(false));
          rulesBody.append(h2, list, closeRules);
          return rulesBody;
        }, document.getElementById("menu"));
        rules.open();
      });
      resignButton.addEventListener("click", () => {
        close(false);
        const resign = new Modal("Resign this match?", (_d, c2) => {
          const resignBody = el("div", { class: "form" });
          const h2 = el("h2", {}, "Resign this match?");
          const confirm = el("button", { class: "btn btn-primary" }, "Resign");
          const keep = el("button", { class: "btn" }, "Keep playing");
          confirm.addEventListener("click", async () => {
            c2(true);
            await jsonFetch(`/api/matches/${matchId}/resign`, { method: "POST" });
          });
          keep.addEventListener("click", () => c2(false));
          resignBody.append(h2, confirm, keep);
          return resignBody;
        }, document.getElementById("menu"));
        resign.open();
      });
      closeButton.addEventListener("click", () => close(false));
      body.append(rulesButton, resignButton, closeButton);
      return body;
    }, document.getElementById("menu"));
    dialog.open();
  }

  let reconnectOverlay: HTMLElement | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAnnounced = false;

  function showReconnectOverlay(remainingMs: number): void {
    if (reconnectOverlay === null) {
      reconnectOverlay = el("div", { id: "reconnect-overlay" });
      document.body.appendChild(reconnectOverlay);
    }
    const opponent = current.seats.find((s) => s.seat !== viewerSeat);
    const name = opponent?.name ?? "Opponent";
    let remaining = remainingMs;
    const update = () => {
      if (reconnectOverlay === null) return;
      reconnectOverlay.textContent = `${name} is reconnecting... ${clockText(remaining)}`;
      remaining = Math.max(0, remaining - 1000);
    };
    update();
    if (!reconnectAnnounced) {
      reconnectAnnounced = true;
      view.announce(`${name} is reconnecting... ${clockText(remainingMs)}`);
    }
    if (reconnectTimer !== null) window.clearInterval(reconnectTimer);
    reconnectTimer = window.setInterval(update, 1000);
    reconnectOverlay.style.display = "flex";
  }

  function hideReconnectOverlay(): void {
    if (reconnectOverlay !== null) reconnectOverlay.style.display = "none";
    if (reconnectTimer !== null) {
      window.clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // own-page reconnect status
  socket2();

  function socket2(): void {
    // handled by the socket's own reconnect; page shows its own status when offline
    window.setInterval(() => {
      const banner = document.getElementById("page-status");
      if (banner === null) return;
    }, 2000);
  }

  let matchOverShown = false;

  function handleMatchEnd(state: MatchState): void {
    if (matchOverShown) return;
    matchOverShown = true;
    view.matchRoot.dataset.phase = "match-over";
    view.setStateFromServer(state, viewerSeat);
    const winnerSeat = state.winnerSeat;
    const viewerWon = viewerSeat !== null && viewerSeat === winnerSeat;
    const heading = viewerSeat === null
      ? `${state.seats.find((s) => s.seat === winnerSeat)?.name ?? ""} wins`
      : viewerWon
        ? "You won"
        : "You lost";
    const yourScore = viewerSeat === null ? state.seats[0].score : state.seats[viewerSeat].score;
    const theirScore = viewerSeat === null ? state.seats[1].score : state.seats[1 - viewerSeat].score;
    view.announce(`Match over. Final score ${yourScore}-${theirScore}.`);
    const endReasonLine =
      state.endReason === "left"
        ? `${state.seats.find((s) => s.seat !== winnerSeat)?.name ?? ""} forfeited: left the match`
        : state.endReason === "timeouts"
          ? `${state.seats.find((s) => s.seat !== winnerSeat)?.name ?? ""} forfeited: 3 timeouts in a row`
          : state.endReason === "resigned"
            ? `${state.seats.find((s) => s.seat !== winnerSeat)?.name ?? ""} resigned`
            : "";
    const modal = new PersistentModal("Match over", () => {
      const body = el("div", { class: "form match-over" });
      const h2 = el("h2", { class: "display", style: "font-size:36px" }, heading);
      const finalScore = el("p", { id: "final-score" }, `Final score ${yourScore}-${theirScore}`);
      const endLine = el("p", { id: "end-reason" }, endReasonLine);
      if (endReasonLine === "") endLine.style.display = "none";
      const points = el("p", { id: "board-points" }, "");
      const ratingChange = el("p", { id: "rating-change" }, "");
      const chalk = el("p", { id: "chalk-earned" }, "+20 chalk");
      const rematch = el("button", { class: "btn" }, "Rematch");
      const accept = el("button", { class: "btn" }, "Accept rematch");
      accept.style.display = "none";
      const home = el("a", { class: "btn btn-primary", href: "/" }, "Home");
      body.append(h2, finalScore, endLine, points, ratingChange, chalk, rematch, accept, home);
      if (state.roomCode === null) {
        rematch.style.display = "none";
        accept.style.display = "none";
      }
      if (state.mode !== "ranked") ratingChange.style.display = "none";

      rematch.addEventListener("click", async () => {
        rematch.textContent = "Rematch offered";
        const res = await jsonFetch<{ status: string; matchId: string | null }>(
          `/api/matches/${matchId}/rematch`,
          { method: "POST", body: JSON.stringify({ accept: true }) }
        );
        if (res.status === 200 && res.body.status === "accepted" && res.body.matchId !== null) {
          window.location.href = `/match/${res.body.matchId}`;
        }
      });
      accept.addEventListener("click", async () => {
        const res = await jsonFetch<{ status: string; matchId: string | null }>(
          `/api/matches/${matchId}/rematch`,
          { method: "POST", body: JSON.stringify({ accept: true }) }
        );
        if (res.status === 200 && res.body.status === "accepted" && res.body.matchId !== null) {
          window.location.href = `/match/${res.body.matchId}`;
        }
      });
      void (async () => {
        const hist = await jsonFetch<{
          matches: {
            matchId: string;
            ratingDelta: number | null;
          }[];
        }>(`/api/players/${me?.id ?? ""}/history`);
        const row = hist.body.matches.find((m) => m.matchId === matchId);
        if (row !== undefined && row.ratingDelta !== null) {
          const me2 = await api.me();
          ratingChange.textContent = `Rating ${Math.round(me2.rating)} (${row.ratingDelta >= 0 ? "+" : ""}${Math.round(row.ratingDelta)})`;
        } else {
          ratingChange.style.display = "none";
        }
      })();
      return body;
    });
    modal.open();
    void (async () => {
      const res = await jsonFetch<{ rematch_offer_seat: number | null; status: string }>(
        `/api/matches/${matchId}`
      );
      if (res.status === 200 && res.body.rematch_offer_seat !== null) {
        const offerSeat = res.body.rematch_offer_seat;
        if (viewerSeat !== null && offerSeat !== viewerSeat) {
          const acceptButton = document.querySelector<HTMLElement>("#accept");
          const rematchButton = document.querySelector<HTMLElement>("button");
          if (acceptButton !== null) acceptButton.style.display = "inline-flex";
          if (rematchButton !== null) rematchButton.style.display = "none";
          const offerName = current.seats.find((s) => s.seat === offerSeat)?.name ?? "";
          view.announce(`${offerName} wants a rematch.`);
        }
      }
    })();
  }

  function handleRematch(status: string, matchId: string | null): void {
    if (status === "accepted" && matchId !== null) {
      window.location.href = `/match/${matchId}`;
      return;
    }
    if (status === "offered") {
      const accept = document.getElementById("accept");
      if (accept !== null) accept.style.display = "inline-flex";
      const rematchButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent === "Rematch");
      if (rematchButton !== undefined) rematchButton.style.display = "none";
    }
    if (status === "expired" || status === "declined") {
      view.announce("Rematch offer expired.");
    }
  }

}

void main();
