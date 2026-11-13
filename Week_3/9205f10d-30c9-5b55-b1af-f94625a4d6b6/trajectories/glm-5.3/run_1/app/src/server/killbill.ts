import type { Config } from "./config.js";

export type KbChargeResult = { invoiceId: string; invoiceItemId: string };

/** Kill Bill client: account per organisation (external key crosshand-<code>), one external-charge item per charge. */
export class KillBill {
  private readonly cfg: Config["killbill"];

  constructor(cfg: Config["killbill"]) {
    this.cfg = cfg;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: "Basic " + Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString("base64"),
      "X-Killbill-ApiKey": this.cfg.apiKey,
      "X-Killbill-ApiSecret": this.cfg.apiSecret,
      "X-Killbill-CreatedBy": "crosshand-relay",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.url}/1.0/healthcheck`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureAccount(orgName: string, orgCode: string): Promise<string> {
    const key = `crosshand-${orgCode}`;
    const existing = await this.accountIdByKey(key);
    if (existing) return existing;
    const created = await fetch(`${this.cfg.url}/1.0/kb/accounts`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ name: orgName, externalKey: key, currency: "USD" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (created.status === 409) {
      const again = await this.accountIdByKey(key);
      if (again) return again;
    }
    if (!created.ok && created.status !== 409) throw new Error(`killbill account create ${created.status}`);
    const body = (await created.json()) as { accountId: string };
    return body.accountId;
  }

  private async accountIdByKey(key: string): Promise<string | null> {
    const res = await fetch(`${this.cfg.url}/1.0/kb/accounts?externalKey=${encodeURIComponent(key)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { accountId: string };
    return body.accountId;
  }

  async createCharge(accountId: string, description: string, amount: string): Promise<KbChargeResult> {
    const res = await fetch(`${this.cfg.url}/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify([
        { description, amount: Number(amount), currency: "USD", itemType: "EXTERNAL_CHARGE" },
      ]),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`killbill charge ${res.status}`);
    const items = (await res.json()) as Array<{ invoiceId: string; invoiceItemId: string }>;
    const first = items[0];
    if (!first) throw new Error("killbill charge empty response");
    return { invoiceId: first.invoiceId, invoiceItemId: first.invoiceItemId };
  }
}
