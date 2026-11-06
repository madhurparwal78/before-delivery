// Background work: service status checks, catalog upload, the outbox loop,
// hold expiry and batch go-live. Everything recovers without a restart.
import { type Pool } from "pg";
import { KillBillClient } from "../services/killbill.js";
import { Outbox } from "../services/outbox.js";
import { expireHolds } from "../domain/holds.js";
import { activateDueBatches } from "../domain/batches.js";

export interface BackgroundHandles {
  billingUp: boolean;
}

export class Background {
  billingUp = true;
  private catalogReady = false;
  private stopped = false;

  constructor(
    private pool: Pool,
    private kb: KillBillClient,
    private outbox: Outbox
  ) {}

  start(): void {
    this.loop5s();
    this.loopCatalog();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop5s(): Promise<void> {
    while (!this.stopped) {
      const started = Date.now();
      try {
        this.billingUp = await this.kb.ping();
      } catch {
        this.billingUp = false;
      }
      try {
        await this.outbox.tick();
      } catch {
        // The outbox keeps its own state; the next tick retries.
      }
      try {
        await expireHolds(this.pool);
      } catch {
        // Holds expire lazily too: every stock count checks the clock.
      }
      try {
        const client = await this.pool.connect();
        try {
          await activateDueBatches(client);
        } finally {
          client.release();
        }
      } catch {
        // The next pass activates any batch that came due.
      }
      const elapsed = Date.now() - started;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 5_000 - elapsed)));
    }
  }

  private async loopCatalog(): Promise<void> {
    while (!this.stopped && !this.catalogReady) {
      try {
        const plans = await this.kb.basePlans();
        const wanted: { planId: string; billingPeriod: string }[] = [
          { planId: "trio-monthly", billingPeriod: "MONTHLY" },
          { planId: "trio-bimestrial", billingPeriod: "BIMESTRIAL" },
          { planId: "trio-quarterly", billingPeriod: "QUARTERLY" }
        ];
        for (const plan of wanted) {
          if (!plans.some((candidate) => candidate.plan === plan.planId)) {
            await this.kb.createSimplePlan({
              planId: plan.planId,
              productName: "trio",
              productCategory: "BASE",
              currency: "CAD",
              amount: 29.04,
              billingPeriod: plan.billingPeriod,
              trialLength: 0
            });
          }
        }
        this.catalogReady = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    }
  }
}
