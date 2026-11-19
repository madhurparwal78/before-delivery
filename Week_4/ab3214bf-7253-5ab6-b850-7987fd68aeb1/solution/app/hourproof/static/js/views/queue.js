// The verifier's review queue, and signing-key replacement.
import { h, link, loadingFigure } from "../dom.js";
import { get, post, ApiError } from "../api.js";
import { countdown } from "../clock.js";
import { openDialog } from "../dialog.js";
import { problems } from "../problems.js";
import { poll } from "../poll.js";
import { table, row } from "../table.js";

const ORDER = ["In review", "Cancelling", "Cancelled", "Signed"];

export function mount({ container, user, shell }) {
  let queuedWindows = [];
  const timers = [];
  const timerById = new Map();
  const group = { async ask() { await refresh(); } };
  const grid = table("Review queue", ["Window", "State", "Recorded", "Review"], "2fr 1fr 1fr 1.4fr");
  const empty = h("p", { class: "figure", hidden: true, text: "NO WINDOWS TO REVIEW." });
  const rotate = h("button", { type: "button", text: "Replace signing key" });
  const loading = loadingFigure();
  grid.el.hidden = true;
  container.replaceChildren(h("section", { class: "page field-cyan" },
    h("h1", { text: "YOUR REVIEW QUEUE." }), h("div", { class: "row" }, rotate), loading, grid.el, empty));

  const draw = () => {
    for (const t of timers.splice(0)) t.stop();
    timerById.clear();
    grid.body.replaceChildren(...queuedWindows.map(({ window: w, recorded }) => {
      const timer = w.state === "In review" && w.review_seconds_left !== null
        ? h("span", { role: "timer", "aria-label": "Review time left" }) : null;
      if (timer) {
        const handle = countdown(timer, w.review_seconds_left, group);
        timers.push(handle);
        timerById.set(w.id, handle);
      }
      return row([
        ["Window", link(`/review/${w.id}`, `${w.site.name} ${w.month}`)],
        ["State", w.state],
        ["Recorded", `${recorded} of 25 recorded`],
        ["Review", timer],
      ]);
    }));
    loading.remove();
    empty.hidden = queuedWindows.length > 0;
    grid.el.hidden = queuedWindows.length === 0;
  };
  let lastShape = "";
  const refresh = async () => {
    const { windows } = await get("/api/windows", { background: true });
    const queued = windows.filter((w) => ORDER.includes(w.state)).sort((a, b) =>
      ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.month.localeCompare(b.month) || a.id.localeCompare(b.id));
    queuedWindows = await Promise.all(queued.map(async (w) => {
      try {
        const { hours } = await get(`/api/windows/${w.id}/sample`, { background: true });
        return { window: w, recorded: hours.filter((x) => x.result).length };
      } catch (error) {
        if (error instanceof ApiError) return { window: w, recorded: 0 };
        throw error;
      }
    }));
    const shape = JSON.stringify(queuedWindows.map((i) => ({ ...i, window: { ...i.window, review_seconds_left: null } })));
    if (shape !== lastShape) {
      lastShape = shape;
      draw();
    } else {
      for (const { window: w } of queuedWindows) if (w.review_seconds_left !== null) timerById.get(w.id)?.set(w.review_seconds_left);
    }
  };

  rotate.addEventListener("click", () => {
    const list = problems();
    const confirm = h("button", { type: "button", text: "Replace key" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    const dialog = h("dialog", { class: "panel field-cyan", "aria-label": "Replace signing key" },
      h("div", { class: "stack" },
        h("p", { text: "Earlier statements keep the key they were signed under." }), list.el,
        h("div", { class: "row" }, confirm, cancel)));
    const handle = openDialog(dialog, { opener: rotate, initial: confirm });
    cancel.addEventListener("click", () => handle.close());
    confirm.addEventListener("click", async () => {
      confirm.setAttribute("aria-disabled", "true");
      try {
        await post(`/api/firms/${user.firm_id}/keys/rotate`, {});
        handle.close();
        shell.status("Signing key replaced. Earlier statements still check.");
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        list.show(error.message, []);
      } finally {
        confirm.removeAttribute("aria-disabled");
      }
    });
  });

  refresh();
  const loop = poll(refresh, 2000);
  return { unmount() { loop.stop(); for (const t of timers) t.stop(); } };
}
