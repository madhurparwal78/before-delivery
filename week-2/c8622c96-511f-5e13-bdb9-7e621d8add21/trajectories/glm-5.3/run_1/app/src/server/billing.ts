import type { AppConfig } from "./config.js";
import { centsToDollars } from "../shared/time.js";

// Kill Bill raises every invoice charge and records every payout.
export type BillingOutcome =
  | { ok: true }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "refused"; detail: string };

const TIMEOUT_MS = 5000;

export class Billing {
  private readonly base: string;
  private readonly auth: string;
  private readonly headers: Record<string, string>;
  private tenantReady = false;

  constructor(private config: AppConfig) {
    this.base = config.killbill.url;
    this.auth = "Basic " + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
    this.headers = {
      Authorization: this.auth,
      "X-Killbill-ApiKey": config.killbill.apiKey,
      "X-Killbill-ApiSecret": config.killbill.apiSecret,
      "X-Killbill-CreatedBy": "saltprint-desk",
      "Content-Type": "application/json",
    };
  }

  // The app reconnects on its own within 5 seconds of the provider returning.
  private async request(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<{ status: number; location?: string; body: unknown }> {
    const url = new URL(this.base + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const location = res.headers.get("Location") ?? undefined;
      const text = await res.text();
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: res.status, location, body: parsed };
    } finally {
      clearTimeout(timer);
    }
  }

  private outcomeFor(status: number, detail: string): BillingOutcome {
    if (status >= 500) return { ok: false, kind: "unavailable" };
    if (status >= 400) return { ok: false, kind: "refused", detail };
    return { ok: true };
  }

  // One account per newsroom, created on its first licence.
  async ensureNewsroomAccount(slug: string, name: string): Promise<BillingOutcome & { accountId?: string }> {
    try {
      const found = await this.request("GET", "/accounts", undefined, { externalKey: `newsroom-${slug}` });
      if (found.status === 404) {
        const created = await this.request("POST", "/accounts", { externalKey: `newsroom-${slug}`, name, currency: "USD" });
        if (created.status === 401 && !this.tenantReady) {
          if (!(await this.ensureTenant())) return { ok: false, kind: "unavailable" };
          return this.ensureNewsroomAccount(slug, name);
        }
        if (created.status >= 400) return { ...this.outcomeFor(created.status, String(created.body)), accountId: undefined };
        const accountId = this.accountIdFromLocation(created.location);
        return { ok: true, accountId };
      }
      if (found.status >= 400) return { ...this.outcomeFor(found.status, String(found.body)), accountId: undefined };
      const body = found.body as { accountId?: string };
      return { ok: true, accountId: body?.accountId };
    } catch {
      return { ok: false, kind: "unavailable" };
    }
  }

  // One account per contributor with the external payment method, created on
  // their first payout.
  async ensureContributorAccount(handle: string): Promise<BillingOutcome & { accountId?: string }> {
    try {
      const found = await this.request("GET", "/accounts", undefined, { externalKey: `contributor-${handle}` });
      if (found.status === 404) {
        const created = await this.request("POST", "/accounts", { externalKey: `contributor-${handle}`, name: handle, currency: "USD" });
        if (created.status === 401 && !this.tenantReady) {
          if (!(await this.ensureTenant())) return { ok: false, kind: "unavailable" };
          return this.ensureContributorAccount(handle);
        }
        if (created.status >= 400) return { ...this.outcomeFor(created.status, String(created.body)), accountId: undefined };
        const accountId = this.accountIdFromLocation(created.location);
        const pm = await this.request("POST", `/accounts/${accountId}/paymentMethods`, { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} }, { isDefault: "true" });
        if (pm.status >= 400) return { ...this.outcomeFor(pm.status, String(pm.body)), accountId: undefined };
        return { ok: true, accountId };
      }
      if (found.status >= 400) return { ...this.outcomeFor(found.status, String(found.body)), accountId: undefined };
      const body = found.body as { accountId?: string };
      return { ok: true, accountId: body?.accountId };
    } catch {
      return { ok: false, kind: "unavailable" };
    }
  }

  private accountIdFromLocation(location: string | undefined): string | undefined {
    if (!location) return undefined;
    const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(location);
    return m ? m[0] : undefined;
  }

  private async ensureTenant(): Promise<boolean> {
    try {
      const res = await this.request("POST", "/tenants", {
        externalKey: "saltprint-desk",
        apiKey: this.config.killbill.apiKey,
        apiSecret: this.config.killbill.apiSecret,
      });
      this.tenantReady = res.status < 500;
      return res.status < 500;
    } catch {
      return false;
    }
  }

  // Before any retry, the app checks the account for a charge with that
  // description, so a charge is never raised twice.
  async hasCharge(accountId: string, description: string): Promise<boolean | "unavailable"> {
    try {
      const list = await this.request("GET", `/accounts/${accountId}/invoices`);
      if (list.status >= 500) return "unavailable";
      if (list.status >= 400) return "unavailable";
      const invoices = list.body as { invoiceId: string }[];
      for (const inv of invoices.slice(0, 200)) {
        const detail = await this.request("GET", `/invoices/${inv.invoiceId}`);
        if (detail.status >= 500) return "unavailable";
        if (detail.status >= 400) continue;
        const body = detail.body as { items?: { description?: string }[] };
        if (body.items?.some((it) => it.description === description)) return true;
      }
      return false;
    } catch {
      return "unavailable";
    }
  }

  // Each licence raises exactly one committed external charge, in USD, with
  // the amount written as dollars with exactly two decimals.
  async raiseCharge(accountId: string, licenceId: string, kind: "exclusive" | "standard", amountMinor: number): Promise<BillingOutcome> {
    const description = `Saltprint licence ${licenceId} · ${kind}`;
    try {
      const existing = await this.hasCharge(accountId, description);
      if (existing === "unavailable") return { ok: false, kind: "unavailable" };
      if (existing === true) return { ok: true };
      const chargeBody = [{ amount: Number(centsToDollars(amountMinor)), description, currency: "USD", accountId, invoiceId: null }];
      const created = await this.request("POST", `/invoices/charges/${accountId}`, chargeBody);
      if (created.status >= 500) return { ok: false, kind: "unavailable" };
      if (created.status >= 400) return { ok: false, kind: "refused", detail: String(created.body) };
      const items = created.body as { invoiceId?: string }[];
      const invoiceId = items?.[0]?.invoiceId;
      if (!invoiceId) return { ok: false, kind: "refused", detail: "no invoice id" };
      const commit = await this.request("PUT", `/invoices/${invoiceId}/commitInvoice`);
      if (commit.status >= 500) return { ok: false, kind: "unavailable" };
      if (commit.status >= 400) return { ok: false, kind: "refused", detail: String(commit.body) };
      return { ok: true };
    } catch {
      return { ok: false, kind: "unavailable" };
    }
  }

  // Each payout is a CREDIT payment on the contributor's account, recorded in
  // billing exactly once, deduped by its external key.
  async recordPayout(accountId: string, month: string, handle: string, amountMinor: number): Promise<BillingOutcome> {
    const key = `payout-${month}-${handle}`;
    try {
      const created = await this.request(
        "POST",
        `/accounts/${accountId}/payments`,
        { transactionType: "CREDIT", amount: Number(centsToDollars(amountMinor)), currency: "USD", transactionExternalKey: key },
        { externalKey: key },
      );
      if (created.status >= 500) return { ok: false, kind: "unavailable" };
      if (created.status >= 400) {
        const body = created.body as { code?: number; message?: string };
        // 7030: a successful transaction with that external key already exists.
        if (body?.code === 7030 || /already exists/i.test(body?.message ?? "")) return { ok: true };
        return { ok: false, kind: "refused", detail: String(created.body) };
      }
      return { ok: true };
    } catch {
      return { ok: false, kind: "unavailable" };
    }
  }
}
