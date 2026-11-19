import { Copy } from "lucide";
import { LANES, type Lane } from "../../shared/model";
import { errorCode, get, send } from "../api";
import { h, icon } from "../dom";
import { fmtSpeed, type Units } from "../format";
import { live } from "../live";
import { navigate, type PageContext } from "../router";
import { me } from "../session";
import { renderShell } from "../shell";
import { DRIVING_KEYS, inputFrom, laneAfter } from "../race/keys";
import { createRaceView, laneCentre, type RaceView } from "../race/view";
import type { Lobby } from "../types";
import { desktopNotice } from "./race";

const FULL = "This lobby is full.";
const STARTED = "This lobby has already started.";
const laneOffset = (lane: Lane) => laneCentre(LANES.indexOf(lane));

function statusCopy(lobby: Lobby): string {
  if (lobby.state === "open") return "Waiting for players";
  if (lobby.state === "countdown") return `Starting in ${lobby.countdown}`;
  if (lobby.state === "racing") return lobby.graceSecondsLeft === null ? "Racing" : `Finish grace: ${lobby.graceSecondsLeft} s`;
  return "Finished";
}

function newLobbyPage(main: HTMLElement, chosen: string | null): void {
  const ai = h("select", { id: "ai-drivers", "aria-label": "AI drivers" },
    ...["0", "1", "2"].map((n) => h("option", { value: n, selected: n === chosen }, n)));
  const create = h("button", { type: "button", class: "primary" }, "Create private lobby");
  const failure = h("p", { class: "dialog-error", role: "alert" });
  create.addEventListener("click", async () => {
    create.disabled = true;
    // The address records the choice while the lobby is created, then becomes the lobby's own.
    history.replaceState(null, "", `/lobby/new?ai=${ai.value}`);
    const result = await send<{ lobbyId: string }>("POST", "/v1/lobbies", { aiCount: Number(ai.value) }).catch(() => null);
    create.disabled = false;
    if (result?.status === 201) navigate(`/lobby/${result.data.lobbyId}`, { replace: true });
    else failure.textContent = "The lobby could not be created. Try again.";
  });
  main.append(
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Private race"), h("h1", null, "Online lobby"))),
    h("div", { class: "cell", style: "max-width:560px" },
      h("p", null, "Race one friend on Saltflat Ring. Fill the grid with up to two Rookie AI drivers, then send the invite link."),
      h("div", { class: "field" }, h("label", { class: "label", for: "ai-drivers" }, "AI drivers"), ai),
      h("div", { style: "margin-top:12px" }, create), failure));
}

export async function lobbyPage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Online lobby";
  const main = renderShell(true, ["Invite", "Grid", "Race"]);
  const lobbyId = ctx.url.pathname.split("/").pop()!;
  if (lobbyId === "new") {
    newLobbyPage(main, ctx.url.searchParams.get("ai"));
    return;
  }
  const player = me()!;
  const units: Units = player.units;
  const status = h("p", { role: "status", "aria-label": "Lobby status", class: "status-line" });
  const message = h("p", { class: "dialog-error" });
  const players = h("ul", { class: "players", "aria-label": "Players" });
  const positions = h("ul", { class: "positions", "aria-label": "Positions" });
  const invite = h("input", { type: "text", id: "invite-link", readonly: true, "aria-label": "Invite link", value: `${location.origin}/lobby/${lobbyId}` });
  const copied = h("span", { class: "label" });
  const copy = h("button", { type: "button" }, icon(Copy, 16), "Copy invite link");
  const ready = h("button", { type: "button", class: "primary" }, "Ready");
  const join = h("button", { type: "button", class: "primary" }, "Join lobby");
  const memberArea = h("div", { class: "lobby-grid" });
  const raceArea = h("div");
  const hud = h("section", { class: "hud", role: "region", "aria-label": "Race HUD", tabindex: "0" });
  let view: RaceView | null = null;
  let lobby: Lobby | null = null;
  let member = false;
  let requestedLane = 1;
  const held = new Set<string>();

  main.append(
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Private race"), h("h1", null, "Online lobby"))),
    status, message, memberArea, raceArea);

  copy.addEventListener("click", () => {
    invite.select();
    void navigator.clipboard?.writeText(invite.value).then(() => { copied.textContent = "Invite link copied."; }, () => undefined);
  });

  function renderMember(): void {
    memberArea.replaceChildren(
      h("section", { class: "cell", "aria-label": "Invite" },
        h("div", { class: "cell-head" }, h("h2", null, "01 Invite")),
        h("div", { class: "field" }, h("label", { class: "label", for: "invite-link" }, "Invite link"), h("div", { class: "invite" }, invite, copy)), copied),
      h("section", { class: "cell", "aria-label": "Grid" },
        h("div", { class: "cell-head" }, h("h2", null, "02 Grid")), players, h("div", { style: "margin-top:12px" }, ready)));
  }

  function paint(next: Lobby): void {
    lobby = next;
    status.textContent = statusCopy(next);
    players.replaceChildren(...next.players.map((p) => h("li", null,
      h("span", null, p.name, p.playerId === player.playerId ? " (you)" : ""),
      h("span", { class: "mono" }, p.connection === "reconnecting" ? "Reconnecting" : p.ready ? "Ready" : "Not ready"))));
    const self = next.players.find((p) => p.playerId === player.playerId);
    ready.textContent = self?.ready ? "Not ready" : "Ready";
    ready.disabled = next.state === "racing" || next.state === "finished";
    if (next.state !== "racing" && next.state !== "finished") return;
    if (window.innerWidth < 1024) {
      if (!raceArea.childElementCount) desktopNotice(raceArea);
      return;
    }
    if (!view) {
      view = createRaceView("saltflat-ring", "online");
      raceArea.replaceChildren(h("div", { class: "lobby-race" },
        h("div", { class: "race-view" }, view.canvas),
        h("div", null, hud, h("h2", { style: "margin-top:12px" }, "Positions"), positions)));
    }
    const entries = [
      ...next.players.map((p) => ({ name: p.name, position: p.position ?? 0, dnf: p.dnf })),
      ...next.ai.map((a) => ({ name: a.name, position: a.position ?? 0, dnf: false })),
    ].sort((a, b) => a.position - b.position);
    positions.replaceChildren(...entries.map((e) => h("li", null, h("span", null, `${e.position}. ${e.name}`), e.dnf ? h("span", null, "DNF") : null)));
    const others = next.players.filter((p) => p.playerId !== player.playerId);
    if (self) {
      view.draw({
        player: { carId: "kestrel-hatch", distance: self.distanceM, offset: laneOffset(self.lane) },
        others: [...others.map((p) => ({ carId: "kestrel-hatch", distance: p.distanceM, offset: laneOffset(p.lane) })),
          ...next.ai.map((a) => ({ carId: "kestrel-hatch", distance: a.distanceM, offset: laneOffset(a.lane) }))],
        ghost: null,
      });
      hud.replaceChildren(
        h("p", { class: "hud-line" }, `Lap ${self.lap ?? 1}/1`),
        h("p", { class: "hud-line" }, `Position ${self.position ?? 1}/${entries.length}`),
        h("p", { class: "hud-line" }, fmtSpeed(self.speedMps, units)));
    }
  }

  const sendKeys = () => {
    if (lobby?.state !== "racing") return;
    live.send({ type: "keys", lobbyId, ...inputFrom(held, requestedLane) });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (lobby?.state !== "racing" || !member || !DRIVING_KEYS.has(event.key)) return;
    event.preventDefault();
    held.add(event.key);
    if (!event.repeat) requestedLane = laneAfter(requestedLane, event.key);
    sendKeys();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (!held.delete(event.key)) return;
    sendKeys();
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  function becomeMember(next: Lobby): void {
    member = true;
    renderMember();
    paint(next);
  }

  ready.addEventListener("click", async () => {
    const self = lobby?.players.find((p) => p.playerId === player.playerId);
    const result = await send<Lobby>("POST", `/v1/lobbies/${lobbyId}/ready`, { ready: !self?.ready }).catch(() => null);
    if (result?.status === 200) paint(result.data);
  });
  join.addEventListener("click", async () => {
    const result = await send<Lobby>("POST", `/v1/lobbies/${lobbyId}/join`, {}).catch(() => null);
    if (!result) return;
    if (result.status === 200) {
      join.remove();
      message.textContent = "";
      live.send({ type: "lobby", lobbyId });
      becomeMember(result.data);
    } else {
      message.textContent = errorCode(result) === "LOBBY_FULL" ? FULL : errorCode(result) === "LOBBY_CLOSED" ? STARTED : "The lobby could not be joined.";
    }
  });

  const stopPush = live.listen((push) => {
    if (push.type === "lobby" && push.lobbyId === lobbyId && member) paint(push);
  });
  const stopOpen = live.onOpen(() => { if (member) live.send({ type: "lobby", lobbyId }); });
  ctx.signal.addEventListener("abort", () => {
    stopPush();
    stopOpen();
    view?.dispose();
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
  });

  const result = await get<Lobby>(`/v1/lobbies/${lobbyId}`, ctx.signal).catch(() => null);
  if (!result || ctx.signal.aborted) return;
  if (result.status !== 200) {
    message.textContent = "This lobby does not exist.";
    return;
  }
  if (result.data.players.some((p) => p.playerId === player.playerId)) {
    live.send({ type: "lobby", lobbyId });
    becomeMember(result.data);
  } else if (result.data.state === "open") {
    status.textContent = statusCopy(result.data);
    main.insertBefore(h("div", { class: "cell", style: "max-width:560px" },
      h("p", null, "You've been invited to a private race on Saltflat Ring."), join), memberArea);
    join.focus();
  } else {
    message.textContent = STARTED;
  }
}
