// Service status: storage and mail are probed every 5 seconds, so a reported value is never older than 10.
import { type Mailer } from "./mailer.js";
import { type Storage } from "./storage.js";

export interface ServiceStatus {
  storage: "up" | "down";
  mail: "up" | "down";
  checkedAt: string;
}

export class StatusMonitor {
  private current: ServiceStatus = { storage: "down", mail: "down", checkedAt: new Date().toISOString() };
  private listeners: Array<(s: ServiceStatus, before: ServiceStatus) => void> = [];

  constructor(
    private readonly storage: Storage,
    private readonly mailer: Mailer,
  ) {}

  get status(): ServiceStatus {
    return this.current;
  }

  onChange(listener: (s: ServiceStatus, before: ServiceStatus) => void): void {
    this.listeners.push(listener);
  }

  /** Records a failure seen while using a service, ahead of the next probe. */
  markDown(service: "storage" | "mail"): void {
    if (this.current[service] === "down") return;
    this.update({ ...this.current, [service]: "down", checkedAt: new Date().toISOString() });
  }

  private update(next: ServiceStatus): void {
    const before = this.current;
    this.current = next;
    if (before.storage !== next.storage || before.mail !== next.mail) for (const l of this.listeners) l(next, before);
  }

  async probe(): Promise<void> {
    const [storage, mail] = await Promise.all([this.storage.reachable(), this.mailer.reachable()]);
    this.update({ storage: storage ? "up" : "down", mail: mail ? "up" : "down", checkedAt: new Date().toISOString() });
  }

  start(): void {
    const tick = (): void => {
      void this.probe().finally(() => setTimeout(tick, 5000));
    };
    tick();
  }
}
