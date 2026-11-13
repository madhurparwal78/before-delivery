// Live service state: billing, storage and mail are checked together, at most a few seconds apart.
import type { ServiceStates } from "../../shared/types.js";
import type { KillBill } from "./killbill.js";
import type { Mailer } from "./smtp.js";
import type { ObjectStore } from "./s3.js";

export class ServiceMonitor {
  private states: ServiceStates = { billing: "down", storage: "down", mail: "down" };

  constructor(
    private readonly killbill: KillBill,
    private readonly objects: ObjectStore,
    private readonly mailer: Mailer,
  ) {}

  async check(): Promise<void> {
    const [billing, storage, mail] = await Promise.all([
      this.killbill.reachable(),
      this.objects.ensureBucket(),
      this.mailer.reachable(),
    ]);
    this.states = { billing: billing ? "up" : "down", storage: storage ? "up" : "down", mail: mail ? "up" : "down" };
  }

  current(): ServiceStates {
    return { ...this.states };
  }

  up(service: keyof ServiceStates): boolean {
    return this.states[service] === "up";
  }
}
