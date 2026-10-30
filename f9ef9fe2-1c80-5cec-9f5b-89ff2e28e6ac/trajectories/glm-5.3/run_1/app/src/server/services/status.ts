import type { Killbill } from "./killbill";
import type { ObjectStorage } from "./storage";
import type { MailService } from "./mail";

export type ServiceName = "billing" | "files" | "mail";

export interface ServiceState {
  billing: "up" | "down";
  files: "up" | "down";
  mail: "up" | "down";
}

export const BILLING_ACTIONS = ["confirm_booking", "create_series", "cancel_booking", "buy_pack"];
export const FILES_ACTIONS = ["upload_document", "view_document"];
export const MAIL_ACTIONS = ["confirm_booking", "create_series", "cancel_booking"];

export class ServiceStatus {
  private state: ServiceState = { billing: "up", files: "up", mail: "up" };
  private lastState: ServiceState = { billing: "up", files: "up", mail: "up" };
  private timer: NodeJS.Timeout | null = null;
  private checking = false;

  constructor(private readonly killbill: Killbill, private readonly storage: ObjectStorage, private readonly mail: MailService) {}

  async boot(): Promise<void> {
    this.checking = true;
    await Promise.all([this.killbill.isUp(), this.storage.isUp(), this.mail.isUp()]).then(([billing, files, mail]) => {
      this.state = { billing: billing ? "up" : "down", files: files ? "up" : "down", mail: mail ? "up" : "down" };
      this.lastState = { ...this.state };
    });
    this.checking = false;
  }

  startLoop(intervalSeconds: number): void {
    this.timer = setInterval(() => {
      void this.check();
    }, intervalSeconds * 1000);
    this.timer.unref();
  }

  stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async check(): Promise<void> {
    if (this.checking) {
      return;
    }
    this.checking = true;
    try {
      const [billing, files, mail] = await Promise.all([this.killbill.isUp(), this.storage.isUp(), this.mail.isUp()]);
      this.lastState = { ...this.state };
      this.state = { billing: billing ? "up" : "down", files: files ? "up" : "down", mail: mail ? "up" : "down" };
    } finally {
      this.checking = false;
    }
  }

  markDown(service: ServiceName): void {
    this.lastState = { ...this.state };
    this.state = { ...this.state, [service]: "down" };
  }

  snapshot(): ServiceState {
    return { ...this.state };
  }

  changed(): ServiceName[] {
    const changedServices: ServiceName[] = [];
    if (this.state.billing !== this.lastState.billing) {
      changedServices.push("billing");
    }
    if (this.state.files !== this.lastState.files) {
      changedServices.push("files");
    }
    if (this.state.mail !== this.lastState.mail) {
      changedServices.push("mail");
    }
    return changedServices;
  }

  noteReported(): void {
    this.lastState = { ...this.state };
  }

  isUp(service: ServiceName): boolean {
    return this.state[service] === "up";
  }

  paused(): string[] {
    const paused: string[] = [];
    if (this.state.billing === "down") {
      paused.push(...BILLING_ACTIONS);
    }
    if (this.state.files === "down") {
      paused.push(...FILES_ACTIONS);
    }
    if (this.state.mail === "down") {
      paused.push(...MAIL_ACTIONS);
    }
    return paused;
  }
}
