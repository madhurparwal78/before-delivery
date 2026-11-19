// Service monitor: probes object storage and mail at boot and every 5 seconds. The reported
// state comes only from these real calls.
import { probeMail } from "./mail.js";
import { probeBucket } from "./storage.js";

type ServiceState = "ok" | "unreachable";

const PROBE_INTERVAL_MS = 5_000;

interface Snapshot {
  storage: ServiceState;
  mail: ServiceState;
  checkedAt: Date;
}

async function probe(check: () => Promise<void>): Promise<ServiceState> {
  try {
    await check();
    return "ok";
  } catch {
    return "unreachable";
  }
}

class Monitor {
  private snapshot: Snapshot | null = null;
  private first: Promise<Snapshot> | null = null;
  private readonly okListeners: Array<() => void> = [];

  start(): void {
    this.first = this.check();
    setInterval(() => void this.check(), PROBE_INTERVAL_MS).unref();
  }

  /** Runs after every probe that finds storage answering. */
  onStorageOk(listener: () => void): void {
    this.okListeners.push(listener);
  }

  private async check(): Promise<Snapshot> {
    const [storage, mail] = await Promise.all([probe(probeBucket), probe(probeMail)]);
    this.snapshot = { storage, mail, checkedAt: new Date() };
    if (storage === "ok") for (const listener of this.okListeners) listener();
    return this.snapshot;
  }

  async current(): Promise<Snapshot> {
    return this.snapshot ?? (await (this.first ?? this.check()));
  }

  /** Storage is attempted unless the latest probe found it unreachable. */
  storageOk(): boolean {
    return this.snapshot?.storage !== "unreachable";
  }

  mailOk(): boolean {
    return this.snapshot?.mail !== "unreachable";
  }
}

export const monitor = new Monitor();
