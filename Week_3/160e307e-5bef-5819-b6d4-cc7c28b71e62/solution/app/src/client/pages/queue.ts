import { ApiFail, del, get, post } from "../api";
import { h } from "../dom";
import { go } from "../router";
import type { Mount } from "../router";
import { connect } from "../socket";
import type { Message } from "../socket";
import { topBar } from "../ui/shell";

interface QueueView {
  mode: "casual" | "ranked";
  near: number;
  band: { low: number; high: number } | null;
  waitedSeconds?: number;
  matchId?: string | null;
}

const queue: Mount = async ({ root, params }) => {
  const mode = params[0] === "ranked" ? "ranked" : "casual";
  const near = h("p", { id: "queue-near", class: "queue-line" });
  const band = h("p", { id: "queue-band", class: "queue-line" });
  const elapsed = h("p", { id: "queue-elapsed", class: "queue-elapsed" });
  const problem = h("p", { class: "field-error-text", role: "alert" });
  const cancel = h("button", { type: "button", class: "btn btn-ink" }, "Cancel");
  const radar = h(
    "div",
    { id: "radar", class: "radar", "aria-hidden": "true" },
    h("span", { class: "radar-ring r1" }),
    h("span", { class: "radar-ring r2" }),
    h("span", { class: "radar-sweep" }),
  );
  let waited = 0;
  let startedAt = performance.now();
  let leaving = false;

  const show = (view: QueueView): void => {
    near.textContent = `Looking for players near ${view.near}`;
    band.textContent = view.band ? `Rating band: ${view.band.low}-${view.band.high}` : "Any rating";
    if (view.waitedSeconds !== undefined) {
      waited = view.waitedSeconds;
      startedAt = performance.now();
    }
    if (view.matchId) {
      leaving = true;
      go(`/match/${view.matchId}`);
    }
  };
  const tick = (): void => {
    const seconds = Math.floor((waited * 1000 + performance.now() - startedAt) / 1000);
    elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const leave = async (): Promise<void> => {
    if (leaving) return;
    leaving = true;
    await del("/api/queue").catch(() => undefined);
    go("/");
  };
  cancel.addEventListener("click", () => void leave());
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      void leave();
    }
  };
  document.addEventListener("keydown", onKey);

  root.replaceChildren(
    h(
      "div",
      { class: "queue field-cobalt" },
      topBar(true),
      h(
        "div",
        { class: "queue-body" },
        h("h1", { class: "page-title", tabindex: -1 }, "Finding a match"),
        near,
        band,
        elapsed,
        radar,
        problem,
        h("div", { class: "actions" }, cancel),
      ),
    ),
  );

  const socket = connect("/ws", (message: Message) => {
    if (message.type === "queueStatus") show(message as unknown as QueueView);
    if (message.type === "matchFound") {
      leaving = true;
      go(`/match/${String(message.matchId)}`);
    }
  });
  try {
    show(await post<QueueView>("/api/queue", { mode }));
    const status = await get<QueueView>("/api/queue");
    show(status);
  } catch (error) {
    if (error instanceof ApiFail && error.code === "LINK_REQUIRED") {
      go("/", true);
      return undefined;
    }
    problem.textContent = "Online play is unavailable right now.";
  }
  tick();
  const timer = window.setInterval(tick, 1000);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("keydown", onKey);
    socket.close();
  };
};

export default queue;
