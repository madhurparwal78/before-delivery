import { ApiFail, del, get, post } from "../api";
import { app, pageStatus } from "../app";
import { formatClock, h } from "../dom";
import { icon } from "../icons";
import { go } from "../router";
import type { Mount } from "../router";
import { connect, reconnectToken } from "../socket";
import type { Message } from "../socket";
import { deniedPage, topBar } from "../ui/shell";

interface RoomView {
  code: string;
  format: string;
  status: "open" | "full" | "closed";
  host: { id: string; name: string };
  guest: { id: string; name: string } | null;
  expiresInMs: number | null;
  matchId: string;
}

interface LobbySeat {
  seat: number;
  playerId: string | null;
  name: string | null;
  ready: boolean;
}

interface LobbyMatch {
  id: string;
  status: string;
  seats: LobbySeat[];
  toss: string | null;
}

const ENTER_MATCH_MS = 2000;

const room: Mount = async ({ root, params }) => {
  const code = (params[0] ?? "").toUpperCase();
  let view: RoomView;
  try {
    view = await get<RoomView>(`/api/rooms/${code}`);
  } catch (error) {
    root.replaceChildren(deniedPage(error instanceof ApiFail && error.status === 404 ? "Room not found" : "Online play is unavailable right now."));
    return undefined;
  }
  const me = app.me;
  if (!me) return undefined;
  if (view.status === "closed") {
    root.replaceChildren(deniedPage("This room has closed"));
    return undefined;
  }
  if (view.host.id !== me.id && view.guest?.id !== me.id) {
    go(`/join/${code}`, true);
    return undefined;
  }
  const host = view.host.id === me.id;
  const mySeat = host ? 0 : 1;
  const publicUrl = document.querySelector<HTMLMetaElement>('meta[name="public-url"]')!.content;
  const link = `${publicUrl}/join/${code}`;
  let expiresAt = view.expiresInMs === null ? null : performance.now() + view.expiresInMs;
  let match: LobbyMatch | null = null;
  let entering = false;

  const expiry = h("p", { id: "room-expiry", class: "expiry" });
  const toss = h("p", { id: "toss-result", class: "toss", role: "status" });
  const seatCards = [0, 1].map((seat) => {
    const name = h("span", { class: "seat-name" });
    const note = h("span", { class: "seat-note" });
    const ready = h("button", { type: "button", class: "btn btn-ink" }, "Ready");
    ready.addEventListener("click", () => {
      ready.disabled = true;
      ready.textContent = "Waiting...";
      sendReady();
    });
    return { name, note, ready, card: h("li", { class: "seat-card" }, h("span", { class: "seat-label" }, seat === 0 ? "Host" : "Guest"), name, note, ready) };
  });

  const socket = connect(`/ws?match=${view.matchId}&token=${reconnectToken()}`, (message: Message) => {
    if (message.type === "roomStatus") apply(message as unknown as RoomView, null);
    if (message.type === "state") apply(null, message.match as LobbyMatch);
  });
  const sendReady = (): void => {
    void post(`/api/matches/${view.matchId}/ready`).catch(() => {
      for (const card of seatCards) card.ready.textContent = "Ready";
      refresh();
    });
  };

  const refresh = (): void => {
    const names = [view.host.name, view.guest?.name ?? null];
    seatCards.forEach((card, seat) => {
      const ready = match?.seats[seat]?.ready ?? false;
      card.name.textContent = names[seat] ?? "";
      card.note.textContent = names[seat] ? (ready ? "Ready" : "Not ready") : "Waiting for opponent...";
      card.ready.disabled = seat !== mySeat || !names[seat] || ready || (seat === mySeat && card.ready.textContent === "Waiting...");
      if (ready && seat === mySeat) card.ready.textContent = "Waiting...";
    });
    cancel.hidden = !host || match?.status === "active";
    const open = view.status === "open";
    expiry.hidden = !open;
    if (view.status === "closed") {
      root.replaceChildren(deniedPage("This room has closed"));
    }
  };

  const apply = (nextRoom: RoomView | null, nextMatch: LobbyMatch | null): void => {
    if (nextRoom) {
      view = nextRoom;
      expiresAt = view.expiresInMs === null ? null : performance.now() + view.expiresInMs;
    }
    if (nextMatch) match = nextMatch;
    refresh();
    if (match?.status === "active" && !entering) {
      entering = true;
      toss.textContent = match.toss ?? "";
      window.setTimeout(() => go(`/match/${view.matchId}`), ENTER_MATCH_MS);
    }
  };

  const tick = (): void => {
    if (view.status !== "open" || expiresAt === null) return;
    expiry.textContent = `Closes in ${formatClock(expiresAt - performance.now())}`;
  };

  const copy = h("button", { type: "button", class: "btn" }, icon("copy", 20), h("span", {}, "Copy link"));
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const area = h("textarea", { class: "sr-only", "aria-hidden": "true" });
      area.value = link;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    pageStatus("Link copied");
  });
  const cancel = h("button", { type: "button", class: "btn" }, "Cancel room");
  cancel.addEventListener("click", async () => {
    cancel.disabled = true;
    try {
      await del(`/api/rooms/${code}`);
      go("/");
    } catch {
      cancel.disabled = false;
    }
  });

  root.replaceChildren(
    h(
      "div",
      { class: "working room" },
      topBar(true),
      h(
        "div",
        { class: "working-body" },
        h("h1", { class: "page-title", tabindex: -1 }, `Room ${code}`),
        h("p", { class: "giant-code", "aria-hidden": "true" }, code),
        h("p", { class: "meta" }, "Code ", h("strong", { id: "room-code" }, code), ` · ${view.format === "classic" ? "Classic" : "Quick"}`),
        h("p", { class: "meta" }, "Share this link with one friend: ", h("span", { id: "room-link" }, link)),
        h("div", { class: "actions" }, copy, cancel),
        expiry,
        h("ul", { class: "seats" }, ...seatCards.map((card) => card.card)),
        toss,
      ),
    ),
  );
  apply(null, null);
  void get<LobbyMatch>(`/api/matches/${view.matchId}`).then((m) => apply(null, m));
  tick();
  const timer = window.setInterval(tick, 1000);
  return () => {
    window.clearInterval(timer);
    socket.close();
  };
};

export default room;
