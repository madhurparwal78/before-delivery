/** Keeps figures current: a ten-second timer, stream events, and recovery after an outage. */
import { Unreachable, ServerFault, SignedOut } from "../shared/api.js";
import { announce } from "../shared/announce.js";
import { COPY } from "../shared/copy.js";
import { refreshFailed, refreshSucceeded } from "../shared/outage.js";
import { REFRESH_SECONDS } from "../../shared/rules.js";
import { every } from "../shared/timers.js";
import { openStream } from "../shared/stream.js";
import { loadAccounts, loadWaiting } from "./store.js";

type Job = () => Promise<void>;

/** One refresh at a time; a request made while one runs is run once more afterwards. */
export class Refresher {
  private running = false;
  private again = false;

  constructor(private readonly job: Job) {}

  async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        try {
          await this.job();
          refreshSucceeded();
        } catch (error) {
          if (error instanceof SignedOut) return;
          if (error instanceof Unreachable) refreshFailed();
          else if (error instanceof ServerFault) announce(COPY.serverError);
          else throw error;
        }
      } while (this.again);
    } finally {
      this.running = false;
    }
  }
}

const transactionListeners = new Set<(row: Record<string, any>) => void>();
const reconnectListeners = new Set<() => void>();

export function onLiveTransaction(listener: (row: Record<string, any>) => void): void {
  transactionListeners.add(listener);
}

export function onLiveReconnect(listener: () => void): void {
  reconnectListeners.add(listener);
}

/** The cockpit keeps one stream open; pages listen to it through the two hooks above. */
export function startLive(): void {
  openStream({
    onTransaction: (row) => transactionListeners.forEach((listener) => listener(row)),
    onReconnected: () => reconnectListeners.forEach((listener) => listener()),
  });
}

/** Runs `job` every ten seconds, after every stream event and after the stream reconnects. */
export function keepFresh(job: Job): Refresher {
  const refresher = new Refresher(job);
  every(() => void refresher.run(), REFRESH_SECONDS * 1000);
  onLiveTransaction(() => void refresher.run());
  onLiveReconnect(() => void refresher.run());
  return refresher;
}

/** The rail's account balances and Approvals count. */
export async function refreshRail(): Promise<void> {
  await loadAccounts();
  await loadWaiting();
}
