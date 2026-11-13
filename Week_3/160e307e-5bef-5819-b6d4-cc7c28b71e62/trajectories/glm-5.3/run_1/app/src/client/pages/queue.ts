import { api, jsonFetch, mountOutageBanner, loadingEl, el, elapsedText, prefersReducedMotion, type Me } from "../lib/app.js";
import { socket, type ServerMessage } from "../lib/socket.js";

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  const mode = window.location.pathname.endsWith("ranked") ? "ranked" : "casual";
  root.appendChild(loadingEl());
  let me: Me | null = null;
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  api.invalidate();
  root.textContent = "";

  const page = el("div", { class: "page queue-page" });
  const h1 = el("h1", {}, "Finding a match");
  const near = el("p", { id: "queue-near" }, me === null ? "" : `Looking for players near ${Math.round(me.rating)}`);
  const band = el("p", { id: "queue-band" }, mode === "casual" ? "Any rating" : "");
  const elapsed = el("p", { id: "queue-elapsed" }, "0:00");
  const radar = el("div", { id: "radar" });
  const cancel = el("button", { class: "btn", id: "cancel" }, "Cancel");
  page.append(h1, near, band, elapsed, radar, cancel);
  root.appendChild(page);

  const leave = async () => {
    await jsonFetch("/api/queue", { method: "DELETE" });
    window.location.href = "/";
  };
  cancel.addEventListener("click", () => void leave());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void leave();
    }
  });

  const startTime = Date.now();
  let waited = 0;
  const poll = async () => {
    const { status, body } = await jsonFetch<{
      near: number;
      band: { low: number; high: number } | null;
      waitedSeconds: number;
      matchId: string | null;
    }>("/api/queue");
    if (status === 404) {
      window.location.href = "/";
      return;
    }
    waited = body.waitedSeconds;
    elapsed.textContent = elapsedText(waited);
    near.textContent = `Looking for players near ${body.near}`;
    band.textContent =
      body.band === null ? "Any rating" : `Rating band: ${body.band.low}-${body.band.high}`;
    if (body.matchId !== null) {
      window.location.href = `/match/${body.matchId}`;
    }
  };
  void poll();
  window.setInterval(() => void poll(), 1000);
  elapsed.textContent = elapsedText((Date.now() - startTime) / 1000);

  // Radar sweep once every 1.6 seconds while waiting.
  if (!prefersReducedMotion()) {
    const sweep = el("div", { class: "radar-sweep" });
    radar.appendChild(sweep);
  }

  socket.connect(null, {
    onMessage: (msg: ServerMessage) => {
      if (msg.type === "matchFound") {
        const matchId = (msg as unknown as { matchId: string }).matchId;
        window.location.href = `/match/${matchId}`;
      }
      if (msg.type === "queueStatus") {
        const body = msg as unknown as {
          band: { low: number; high: number } | null;
          waitedSeconds: number;
          matchId: string | null;
        };
        elapsed.textContent = elapsedText(body.waitedSeconds);
        band.textContent =
          body.band === null ? "Any rating" : `Rating band: ${body.band.low}-${body.band.high}`;
        if (body.matchId !== null) {
          window.location.href = `/match/${body.matchId}`;
        }
      }
    },
  });
}

void main();
