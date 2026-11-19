import { KillBillClient } from "./killbill.js";
import { MailClient } from "./mail.js";
import { StorageClient } from "./storage.js";
import { DocumentsClient } from "./documents.js";

export type ServiceName = "payments" | "email" | "storage" | "documents";

export interface ServiceStates {
  payments: boolean;
  email: boolean;
  storage: boolean;
  documents: boolean;
}

// Each dependency is probed at least every 10 seconds and any failed real call
// marks it down at once.

export class ServiceHealth {
  private readonly killbill: KillBillClient;
  private readonly mail: MailClient;
  private readonly storage: StorageClient;
  private readonly documents: DocumentsClient;

  private states: ServiceStates = {
    payments: true,
    email: true,
    storage: true,
    documents: true,
  };
  private probing = false;

  constructor(
    killbill: KillBillClient,
    mail: MailClient,
    storage: StorageClient,
    documents: DocumentsClient,
  ) {
    this.killbill = killbill;
    this.mail = mail;
    this.storage = storage;
    this.documents = documents;
  }

  async probeAll(): Promise<void> {
    const [payments, email, storage, documents] = await Promise.all([
      this.killbill.ping(),
      this.mail.ping(),
      this.storage.ping(),
      this.documents.ping(),
    ]);
    this.states = { payments, email, storage, documents };
  }

  /** Probes any service whose last probe is older than 10 seconds. */
  async probeStale(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      await this.probeAll();
    } finally {
      this.probing = false;
    }
  }

  markDown(service: ServiceName): void {
    this.states[service] = false;
  }

  async markDownThenProbe(service: ServiceName): Promise<void> {
    this.markDown(service);
    await this.probeStale();
  }

  isUp(service: ServiceName): boolean {
    return this.states[service];
  }

  snapshot(): ServiceStates {
    return { ...this.states };
  }

  startProbing(): void {
    const periodMs = 10_000;
    const tick = (): void => {
      this.probeStale().catch(() => undefined);
      setTimeout(tick, periodMs).unref?.();
    };
    this.probeStale().catch(() => undefined);
    setTimeout(tick, periodMs).unref?.();
  }
}
