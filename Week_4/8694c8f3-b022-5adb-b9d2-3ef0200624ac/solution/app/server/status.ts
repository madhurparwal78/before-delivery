import type { Collab } from "./collab.ts";
import type { Storage } from "./storage.ts";
import type { ServiceStatus } from "../shared/types.ts";

const CHECK_INTERVAL_MS = 2500;

export class StatusMonitor {
  private storageOk = false;
  private collabOk = false;
  private checkedAt = new Date();
  private announced = "";
  private listener: (status: ServiceStatus) => void = () => undefined;

  onChange(listener: (status: ServiceStatus) => void): void {
    this.listener = listener;
  }

  noteStorage(reachable: boolean): void {
    this.storageOk = reachable;
    this.announce();
  }

  noteCollab(reachable: boolean): void {
    this.collabOk = reachable;
    this.announce();
  }

  current(): ServiceStatus {
    return {
      storage: this.storageOk ? "ok" : "unreachable",
      collab: this.collabOk ? "ok" : "unreachable",
      checked_at: this.checkedAt.toISOString(),
    };
  }

  private announce(): void {
    const key = `${this.storageOk}:${this.collabOk}`;
    if (key === this.announced) return;
    this.announced = key;
    this.listener(this.current());
  }

  start(storage: Storage, collab: Collab): void {
    const check = async (): Promise<void> => {
      const [storageOk, collabOk] = await Promise.all([storage.probe(), collab.probe()]);
      this.checkedAt = new Date();
      this.storageOk = storageOk;
      this.collabOk = collabOk;
      this.announce();
    };
    void check();
    setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
  }
}
