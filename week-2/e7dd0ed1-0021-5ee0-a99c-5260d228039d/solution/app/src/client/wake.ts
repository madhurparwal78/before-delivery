// Replica Wake (brief: Motion and effects, Replica Wake 1–12). The inspector shows a replica record that
// may trail the server's: settles queue and play one at a time, while failures, returns to pending and
// new-version resets apply in the frame they arrive. Pins, the status list and announcements all read
// these displayed pins.
import { formatCount, formatRegionCount, shortVersion } from "../shared/format";
import type { Replica, ReplicaRecord, ReplicaState } from "./api";

type PinState = "origin" | "pending" | "settled" | "failed";

export interface Pin {
  region: string;
  state: PinState;
  progress: number;
  fill: number;
  numeral: string;
  settleMs: number | null;
}

interface Settle {
  region: string;
  settleMs: number;
  settledAt: string;
  order: number;
}

const LINE_MS = 330;
const FILL_MS = 200;
const COUNT_MS = 570;
const WAKE_MS = LINE_MS + FILL_MS + COUNT_MS;

const RESET = { state: "pending", progress: 0, fill: 0, numeral: "", settleMs: null } as const;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const ms = (value: number): string => `${formatCount(value)} ms`;

function bySettle(a: Settle, b: Settle): number {
  return a.settledAt === b.settledAt ? a.order - b.order : a.settledAt < b.settledAt ? -1 : 1;
}

function finishedPin(replica: Replica): Pin {
  const pin: Pin = { region: replica.region, state: "pending", progress: 0, fill: 0, numeral: "", settleMs: null };
  if (replica.role === "origin") return { ...pin, state: "origin", fill: 1 };
  if (replica.state === "settled" && replica.settle_ms !== null) {
    return { ...pin, state: "settled", progress: 1, fill: 1, numeral: ms(replica.settle_ms), settleMs: replica.settle_ms };
  }
  if (replica.state === "failed") return { ...pin, state: "failed" };
  return pin;
}

function pendingPin(replica: Replica): Pin {
  return replica.role === "origin" ? finishedPin(replica) : { ...finishedPin(replica), ...RESET };
}

export function statusLine(name: string, pin: Pin): string {
  if (pin.state === "origin") return `${name}: origin, settled`;
  if (pin.state === "settled") return `${name}: settled in ${formatCount(pin.settleMs ?? 0)} ms`;
  return `${name}: ${pin.state}`;
}

export class ReplicaWake {
  versionId: string;
  pins: Pin[];
  announcement = "";
  // Announcements raised together (a new version whose copy already failed) are spoken one after another.
  private unsaid: string[] = [];
  private serverStates = new Map<string, ReplicaState>();
  private queue: Settle[] = [];
  private playing: { settle: Settle; start: number } | null = null;

  // Opening shows the record as finished; only settles that arrive later play.
  constructor(record: ReplicaRecord, private readonly nameOf: (region: string) => string, private readonly reduced: boolean) {
    this.versionId = record.version_id;
    this.pins = record.replicas.map(finishedPin);
    for (const replica of record.replicas) this.serverStates.set(replica.region, replica.state);
  }

  get playingWake(): boolean {
    return this.playing !== null;
  }

  // A record from the server. `restored` marks a version brought back by an undo.
  receive(record: ReplicaRecord, now: number, restored: boolean): void {
    const said: string[] = [];
    if (record.version_id !== this.versionId) {
      this.versionId = record.version_id;
      this.queue = [];
      this.playing = null;
      this.pins = record.replicas.map(pendingPin);
      this.serverStates = new Map(record.replicas.map((r) => [r.region, r.role === "origin" ? r.state : "pending"]));
      const copies = record.replicas.length - 1;
      const lead = `${restored ? "Restored version" : "New version"} ${shortVersion(record.version_id)}.`;
      said.push(copies > 0 ? `${lead} Copies pending in ${formatRegionCount(copies)}.` : lead);
    }
    const settles: Settle[] = [];
    record.replicas.forEach((replica, order) => {
      const before = this.serverStates.get(replica.region);
      if (replica.role === "origin" || before === replica.state) return;
      this.serverStates.set(replica.region, replica.state);
      const pin = this.pin(replica.region);
      if (replica.state === "settled" && replica.settle_ms !== null && replica.settled_at !== null) {
        settles.push({ region: replica.region, settleMs: replica.settle_ms, settledAt: replica.settled_at, order });
      } else if (replica.state === "failed") {
        Object.assign(pin, RESET, { state: "failed" });
        said.push(`${this.nameOf(replica.region)} failed`);
      } else if (replica.state === "pending" && before === "failed") {
        Object.assign(pin, RESET);
        said.push(`${this.nameOf(replica.region)} retrying`);
      }
    });
    settles.sort(bySettle);
    if (this.reduced) {
      for (const settle of settles) said.push(this.finish(settle));
    } else {
      this.queue = [...this.queue, ...settles].sort(bySettle);
      if (!this.playing) this.startNext(now);
    }
    this.announce(said);
  }

  // The server accepted a manual retry: the failed pin is pending again.
  retried(region: string): void {
    this.serverStates.set(region, "pending");
    Object.assign(this.pin(region), RESET);
    this.announce([`${this.nameOf(region)} retrying`]);
  }

  get announcementsWaiting(): boolean {
    return this.unsaid.length > 0;
  }

  // Moves to the next waiting announcement; false when none is left.
  nextAnnouncement(): boolean {
    const next = this.unsaid.shift();
    if (next === undefined) return false;
    this.announcement = next;
    return true;
  }

  private announce(said: string[]): void {
    if (this.unsaid.length) {
      this.unsaid.push(...said);
      return;
    }
    const [first, ...rest] = said;
    if (first === undefined) return;
    this.announcement = first;
    this.unsaid.push(...rest);
  }

  // Advance the playing wake to `now`. A finished wake hands over to the next at its own finish moment.
  step(now: number): void {
    const said: string[] = [];
    while (this.playing) {
      const { settle, start } = this.playing;
      const pin = this.pin(settle.region);
      const t = now - start;
      if (t < LINE_MS) {
        pin.progress = easeOut(t / LINE_MS);
        break;
      }
      pin.progress = 1;
      if (pin.state !== "settled") {
        pin.state = "settled";
        pin.settleMs = settle.settleMs;
        said.push(this.settledCopy(settle));
      }
      if (t < LINE_MS + FILL_MS) {
        pin.fill = easeOut((t - LINE_MS) / FILL_MS);
        break;
      }
      pin.fill = 1;
      if (t < WAKE_MS) {
        pin.numeral = ms(Math.round(easeOut((t - LINE_MS - FILL_MS) / COUNT_MS) * settle.settleMs));
        break;
      }
      pin.numeral = ms(settle.settleMs);
      this.startNext(start + WAKE_MS);
    }
    this.announce(said);
  }

  private startNext(start: number): void {
    const next = this.queue.shift();
    this.playing = next ? { settle: next, start } : null;
  }

  private finish(settle: Settle): string {
    Object.assign(this.pin(settle.region), {
      state: "settled",
      progress: 1,
      fill: 1,
      numeral: ms(settle.settleMs),
      settleMs: settle.settleMs,
    });
    return this.settledCopy(settle);
  }

  private settledCopy(settle: Settle): string {
    return `${this.nameOf(settle.region)} settled in ${ms(settle.settleMs)}`;
  }

  private pin(region: string): Pin {
    return this.pins.find((p) => p.region === region) as Pin;
  }
}
