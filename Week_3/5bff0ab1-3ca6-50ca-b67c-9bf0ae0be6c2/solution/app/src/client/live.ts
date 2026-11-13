import type { FinishId, HubId, ModelId } from "../shared/catalogue.js";
import { STATUS, priceStatus, staleStatus } from "../shared/copy.js";
import { holdsFinish } from "../shared/derive.js";
import type { Reading } from "../shared/types.js";
import { refreshMine } from "./mine.js";
import { call } from "./net.js";
import { pollIdentity, sessionEnded } from "./session.js";
import { RANK, announce, clearStatus } from "./status.js";
import { Store } from "./store.js";

type Selection = { hub: HubId; model: ModelId; finish: FinishId };
type RoomState = {
  sel: Selection;
  /** The newest reading drawn for the current selection; null until its first reply. */
  drawn: Reading | null;
  /** The `serverNow` of the last good reply, for the as-of label after a failed read. */
  lastGoodAt: string | null;
  failed: boolean;
};

export const room = new Store<RoomState>({ sel: { hub: "pune", model: "megh-349", finish: "monsoon-slate" }, drawn: null, lastGoodAt: null, failed: false });

const SILENT_MS = 35_000;
const REOPEN_MS = 2_000;
const POLL_MS = 5_000;
const STREAM_AFTER_LOAD_MS = 700;

let epoch = 0;
let acceptAny = false;
let started = false;
let streamUp = false;
let controller: AbortController | null = null;
let silentTimer: ReturnType<typeof setTimeout> | null = null;
let reopenTimer: ReturnType<typeof setTimeout> | null = null;
let staleKey = "";
let staleReasonBefore: Reading["staleReason"] = null;

const whenLoaded = (run: () => void): void => {
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
};
const same = (a: Selection, b: Selection): boolean => a.hub === b.hub && a.model === b.model && a.finish === b.finish;
const query = (s: Selection): string => `hub=${s.hub}&model=${s.model}&finish=${s.finish}`;
const staleSignature = (r: Reading): string => (r.stale ? `${r.staleReason}|${r.stockAsOfLabel}` : "");

export function initRoom(sel: Selection, reading: Reading | null): void {
  room.set({ sel, drawn: reading, lastGoodAt: reading?.serverNow ?? null, failed: false });
  staleKey = reading ? staleSignature(reading) : "";
  staleReasonBefore = reading?.staleReason ?? null;
}

/** A page that loads onto a hub that is already stale says so, as choosing that hub would. */
export function announceLoaded(): void {
  const reading = room.get().drawn;
  if (reading?.stale) announce(staleStatus(reading), RANK.stale, "stale");
}

/** Points the live feed at a selection: a new selection starts a new reading and re-opens the stream. */
export function follow(sel: Selection): void {
  if (!same(sel, room.get().sel)) {
    epoch += 1;
    staleKey = "";
    staleReasonBefore = null;
    room.set({ sel, drawn: null, lastGoodAt: null, failed: false });
    openStream();
  } else if (!started) {
    started = true;
    void refreshMine();
    whenLoaded(() => {
      if (!controller) reopenTimer = setTimeout(openStream, STREAM_AFTER_LOAD_MS);
    });
    setInterval(() => {
      if (!streamUp) void readNow();
    }, POLL_MS);
    window.addEventListener("offline", () => controller?.abort());
    window.addEventListener("online", () => openStream());
  }
}

/** Reads the newest reading at once, as after a refused price or a refused claim. */
export function readAgain(): void {
  void readNow();
}

/** After a change of who is signed in, the stream and the reading belong to the current caller. */
export function reidentify(): void {
  acceptAny = true;
  epoch += 1;
  if (started) openStream();
}

function narrate(prev: Reading | null, next: Reading): void {
  const key = staleSignature(next);
  if (!prev) {
    if (next.stale) announce(staleStatus(next), RANK.stale, "stale");
    else clearStatus("stale");
    staleKey = key;
    staleReasonBefore = next.staleReason;
    return;
  }
  if (prev.quote.stepEffectiveFrom !== next.quote.stepEffectiveFrom) announce(priceStatus(next.quote.onRoadPaise), RANK.price);
  if (prev.unitsLeft > 0 && next.unitsLeft === 0 && !holdsFinish(next, next.finish)) announce(STATUS.finishGone, RANK.lock);
  if (key !== staleKey) {
    if (next.stale) announce(staleStatus(next), RANK.stale, "stale");
    else announce(staleReasonBefore === "count" ? STATUS.countDone : STATUS.hubBack, RANK.stale);
    staleKey = key;
    staleReasonBefore = next.staleReason;
  }
}

function accept(reading: Reading, forEpoch: number): void {
  if (forEpoch !== epoch) return;
  const state = room.get();
  const prev = state.drawn;
  if (prev && !acceptAny && reading.seq <= prev.seq) {
    if (state.failed) room.set({ failed: false });
    return;
  }
  acceptAny = false;
  room.set({ drawn: reading, lastGoodAt: reading.serverNow, failed: false });
  narrate(prev, reading);
}

async function readNow(): Promise<void> {
  const mark = epoch;
  const r = await call<Reading>("GET", `/api/live/now?${query(room.get().sel)}`);
  if (mark !== epoch) return;
  if (r.ok) accept(r.data, mark);
  else if (r.status === 0 || r.status >= 500) room.set({ failed: true });
}

function bumpSilence(ctl: AbortController): void {
  if (silentTimer) clearTimeout(silentTimer);
  silentTimer = setTimeout(() => ctl.abort(), SILENT_MS);
}

function openStream(): void {
  controller?.abort();
  if (reopenTimer) clearTimeout(reopenTimer);
  const ctl = new AbortController();
  controller = ctl;
  const mark = epoch;
  streamUp = false;
  bumpSilence(ctl);
  void (async () => {
    try {
      const reply = await fetch(`/api/live?${query(room.get().sel)}`, { signal: ctl.signal, credentials: "same-origin", cache: "no-store", headers: { Accept: "text/event-stream" } });
      if (!reply.ok || !reply.body) throw new Error("stream refused");
      streamUp = true;
      void refreshMine();
      const reader = reply.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bumpSilence(ctl);
        buffer += decoder.decode(value, { stream: true });
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          handle(buffer.slice(0, end), mark);
          buffer = buffer.slice(end + 2);
        }
      }
    } catch {
      // the stream ended or failed: fall through to the recovery below
    }
    if (controller !== ctl) return;
    streamUp = false;
    if (silentTimer) clearTimeout(silentTimer);
    void readNow();
    reopenTimer = setTimeout(openStream, REOPEN_MS);
  })();
}

function handle(block: string, mark: number): void {
  let name = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return;
  let body: unknown;
  try {
    body = JSON.parse(data.join("\n"));
  } catch {
    return;
  }
  if (name === "live") accept(body as Reading, mark);
  else if (name === "mine") void refreshMine();
  else if (name === "session") {
    const state = (body as { state?: string }).state;
    if (state === "ended") sessionEnded();
    else if (state === "signed_out") void pollIdentity();
  }
}
