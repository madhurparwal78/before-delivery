// The driver's run sheet: presses show at once, wait on the phone with no signal, and go in order once there is signal.
import { $, $$, announce, call, safely } from "./core.js";
import { afterRefresh, refreshNow } from "./refresh.js";

interface WaitingPress { repeatKey: string; stopId: string; kind: string; pressedAt: number }
const ORDER = ["arrived", "boarded", "left", "comfortStop", "backOnTheRoad"];
let sending = false;

export const initRunSheet = (): void => {
  const sheet = $<HTMLElement>("[data-sheet]");
  if (!sheet) return;
  const token = sheet.dataset.token as string;
  const key = `run-sheet-queue:${token}`;
  const readQueue = (): WaitingPress[] => JSON.parse(localStorage.getItem(key) ?? "[]");
  const writeQueue = (queue: WaitingPress[]): void => localStorage.setItem(key, JSON.stringify(queue));
  const count = (): HTMLElement | null => $("[data-waiting-count]");

  const draw = (): void => {
    const queue = readQueue();
    const line = count();
    if (line) line.textContent = queue.length ? (sheet.dataset.waiting as string).replace("9999", String(queue.length)) : (sheet.dataset.allSent as string);
    for (const stop of $$("[data-stop]")) {
      for (const button of $$("[data-press]", stop)) {
        const done = button.dataset.pressDone === "1" || queue.some((q) => q.stopId === stop.dataset.stop && q.kind === button.dataset.press);
        button.classList.toggle("is-done", done);
        if (done) button.setAttribute("aria-disabled", "true");
        else button.removeAttribute("aria-disabled");
      }
    }
  };
  const send = async (): Promise<void> => {
    if (sending || navigator.onLine === false) return;
    sending = true;
    for (;;) {
      const [next] = readQueue();
      if (!next) break;
      const secondsAgo = Math.max(Math.floor((Date.now() - next.pressedAt) / 1000), 0);
      const reply = await safely(() => call("POST", `/api/r/${token}/presses`, { stopId: next.stopId, kind: next.kind, secondsAgo, repeatKey: next.repeatKey }));
      if (reply.status === 0 || reply.status >= 500) break;
      writeQueue(readQueue().slice(1));
      draw();
    }
    sending = false;
    if (!readQueue().length) void refreshNow();
  };
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-press]");
    if (!button || button.getAttribute("aria-disabled") === "true") return;
    const stop = button.closest<HTMLElement>("[data-stop]") as HTMLElement;
    const kind = button.dataset.press as string;
    const earlier = ORDER[ORDER.indexOf(kind) - 1];
    const earlierButton = earlier ? $(`[data-press="${earlier}"]`, stop) : null;
    if (earlierButton && !earlierButton.classList.contains("is-done")) return;
    writeQueue([...readQueue(), { repeatKey: crypto.randomUUID(), stopId: stop.dataset.stop as string, kind, pressedAt: Date.now() }]);
    draw();
    announce((sheet.dataset.recorded as string).replace("{p}", button.textContent?.trim() ?? ""), false);
    void send();
  });
  addEventListener("online", () => void send());
  afterRefresh(() => {
    draw();
    void send();
  });
  draw();
  void send();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/assets/js/client/sw.js", { scope: "/r/" }).catch(() => undefined);
};
