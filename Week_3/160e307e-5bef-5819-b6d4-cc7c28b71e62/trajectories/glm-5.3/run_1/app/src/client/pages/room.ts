import { api, jsonFetch, mountOutageBanner, loadingEl, el, clockText, type Me } from "../lib/app.js";
import { socket, type ServerMessage } from "../lib/socket.js";

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  const code = window.location.pathname.split("/").pop() ?? "";
  root.appendChild(loadingEl());
  let me: Me | null = null;
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  api.invalidate();
  root.textContent = "";

  const room = await jsonFetch<{
    code: string;
    format: string;
    status: string;
    host: { id: string; name: string };
    guest: { id: string; name: string } | null;
    expiresInMs: number | null;
    matchId: string;
  }>(`/api/rooms/${code}`);
  if (room.status === 404 || room.status === 503) {
    renderClosed(root, "Room not found");
    return;
  }
  render(root, me, code.toUpperCase(), room.body);
}

function renderClosed(root: HTMLElement, message: string): void {
  const page = el("div", { class: "page" });
  page.append(el("h1", {}, message), el("a", { class: "btn", href: "/" }, "Home"));
  root.appendChild(page);
}

function render(
  root: HTMLElement,
  me: Me | null,
  code: string,
  room: {
    code: string;
    format: string;
    status: string;
    host: { id: string; name: string };
    guest: { id: string; name: string } | null;
    expiresInMs: number | null;
    matchId: string;
  }
): void {
  const page = el("div", { class: "page" });
  const heading = el("h1", {}, `Room ${code}`);
  const codeEl = el("div", { class: "code-display", id: "room-code" }, code);
  const link = el("a", { id: "room-link", href: `/join/${code}` }, `${window.location.origin}/join/${code}`);
  const copy = el("button", { class: "btn" }, "Copy link");
  const expiry = el("p", { id: "room-expiry" }, "Closes in 10:00");
  const seats = el("div", { class: "room-seats" });
  const toss = el("p", { id: "toss-result" }, "");
  const cancel = el("button", { class: "btn" }, "Cancel room");
  const home = el("a", { class: "btn", href: "/" }, "Home");

  const isHost = me !== null && me.id === room.host.id;
  const isGuest = me !== null && room.guest !== null && me.id === room.guest.id;

  const hostCell = el("div", { class: "room-seat" });
  hostCell.append(el("span", {}, room.host.name));
  const hostReady = el("button", { class: "btn" }, "Ready");
  hostReady.disabled = !isHost;
  hostCell.appendChild(hostReady);
  const guestCell = el("div", { class: "room-seat" });
  if (room.guest === null) {
    guestCell.append(el("span", {}, "Waiting for opponent..."));
  } else {
    guestCell.append(el("span", {}, room.guest.name));
  }
  const guestReady = el("button", { class: "btn" }, "Ready");
  guestReady.disabled = !isGuest;
  guestCell.appendChild(guestReady);
  seats.append(hostCell, guestCell);

  cancel.style.display = isHost ? "inline-flex" : "none";
  page.append(heading, codeEl, link, copy, expiry, seats, toss, cancel, home);
  root.appendChild(page);

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
      pageStatusOf("Link copied");
    } catch {
      pageStatusOf("Link copied");
    }
  });

  const ready = async (button: HTMLButtonElement) => {
    button.textContent = "Waiting...";
    button.disabled = true;
    const res = await jsonFetch(`/api/matches/${room.matchId}/ready`, { method: "POST" });
    if (res.status !== 200) {
      button.textContent = "Ready";
      button.disabled = false;
    }
  };
  hostReady.addEventListener("click", () => void ready(hostReady));
  guestReady.addEventListener("click", () => void ready(guestReady));

  cancel.addEventListener("click", async () => {
    await jsonFetch(`/api/rooms/${code}`, { method: "DELETE" });
    window.location.href = "/";
  });

  // Countdown from the server's remaining time.
  let remaining = room.expiresInMs ?? 0;
  const tickExpiry = () => {
    if (room.status === "open" && room.guest === null) {
      expiry.textContent = `Closes in ${clockText(remaining)}`;
    } else {
      expiry.textContent = "";
    }
    remaining = Math.max(0, remaining - 1000);
  };
  tickExpiry();
  window.setInterval(tickExpiry, 1000);

  // Live room status over the socket. The lobby joins the room's match channel,
  // so the toss line and the start arrive without polling.
  socket.connect(room.matchId, {
    onMessage: (msg: ServerMessage) => {
      if (msg.type === "roomStatus") {
        const status = msg as unknown as {
          status: string;
          guest: { id: string; name: string } | null;
          matchId: string;
        };
        if (status.status === "closed") {
          renderClosed(root, "This room has closed");
          return;
        }
        if (status.guest !== null && room.guest === null) {
          room.guest = status.guest;
          guestCell.textContent = "";
          guestCell.append(el("span", {}, status.guest.name), guestReady);
          guestReady.disabled = !(me !== null && me.id === status.guest.id);
          expiry.textContent = "";
        }
        room.matchId = status.matchId;
      }
      if (msg.type === "state") {
        const match = msg as unknown as { id: string; status: string; seats: { ready: boolean }[] };
        if (match.status === "active" && match.seats.length === 2) {
          const hostName = room.host.name;
          toss.textContent = `${hostName} won the toss and breaks with white.`;
          room.matchId = match.id;
          window.setTimeout(() => {
            window.location.href = `/match/${match.id}`;
          }, 2000);
        }
      }
    },
  });
}

function pageStatusOf(text: string): void {
  let el2 = document.getElementById("page-status");
  if (el2 === null) {
    el2 = document.createElement("status");
    el2.id = "page-status";
    el2.setAttribute("role", "status");
    document.body.prepend(el2);
  }
  el2.textContent = text;
  el2.style.display = "block";
  window.setTimeout(() => {
    if (el2 !== null) el2.style.display = "none";
  }, 4000);
}

void main();
