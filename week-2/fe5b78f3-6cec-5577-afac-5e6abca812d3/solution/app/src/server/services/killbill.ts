// Kill Bill: one account per traveller, a PURCHASE per booking, a REFUND per refund (brief: Services > Kill Bill).
import type { Config } from "../config.js";
import { rupees } from "../domain/money.js";
import { ProviderUnavailable } from "./errors.js";


interface KbTransaction {
  transactionExternalKey: string;
  transactionType: string;
  status: string;
}

interface KbPayment {
  paymentId: string;
  transactions?: KbTransaction[];
}

export type KillBill = ReturnType<typeof createKillBill>;

export function createKillBill(config: Config["killbill"]) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
    "X-Killbill-ApiKey": config.apiKey,
    "X-Killbill-ApiSecret": config.apiSecret,
    "X-Killbill-CreatedBy": "pakka-rail",
    Accept: "application/json",
  };

  async function call(method: string, path: string, body?: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${config.url}/1.0/kb${path}`, {
        method,
        headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ProviderUnavailable(`Kill Bill ${method} ${path}: ${String(error)}`);
    }
    if (response.status >= 500) throw new ProviderUnavailable(`Kill Bill ${method} ${path}: ${response.status}`);
    return response;
  }

  async function json<T>(method: string, path: string, body?: string): Promise<T> {
    const response = await call(method, path, body);
    if (!response.ok) throw new ProviderUnavailable(`Kill Bill ${method} ${path}: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }

  const idFromLocation = (response: Response): string => {
    const id = (response.headers.get("location") ?? "").split("?")[0]?.split("/").filter(Boolean).pop();
    if (!id) throw new ProviderUnavailable("Kill Bill answered without a Location");
    return id;
  };

  async function payment(paymentId: string): Promise<KbPayment> {
    return json<KbPayment>("GET", `/payments/${paymentId}`);
  }

  async function settled(paymentId: string, transactionKey: string): Promise<boolean> {
    const found = (await payment(paymentId)).transactions?.find((t) => t.transactionExternalKey === transactionKey);
    return found?.status === "SUCCESS";
  }

  return {
    async ensureAccount(externalKey: string, name: string): Promise<string> {
      const existing = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
      let accountId: string;
      let hasMethod = false;
      if (existing.status === 200) {
        const account = (await existing.json()) as { accountId: string; paymentMethodId?: string | null };
        accountId = account.accountId;
        hasMethod = Boolean(account.paymentMethodId);
      } else {
        const created = await call("POST", "/accounts", JSON.stringify({ name, externalKey, currency: "INR" }));
        if (created.status !== 201) throw new ProviderUnavailable(`Kill Bill account: ${created.status}`);
        accountId = idFromLocation(created);
      }
      if (!hasMethod) {
        const method = await call(
          "POST",
          `/accounts/${accountId}/paymentMethods?isDefault=true`,
          JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__" }),
        );
        if (method.status !== 201) throw new ProviderUnavailable(`Kill Bill payment method: ${method.status}`);
      }
      return accountId;
    },

    async purchase(accountId: string, pnr: string, paise: number): Promise<string> {
      const body = `{"transactionType":"PURCHASE","amount":${rupees(paise)},"currency":"INR",` +
        `"paymentExternalKey":${JSON.stringify(pnr)},"transactionExternalKey":${JSON.stringify(`${pnr}-fare`)}}`;
      const created = await call("POST", `/accounts/${accountId}/payments`, body);
      if (created.status !== 201) throw new ProviderUnavailable(`Kill Bill purchase: ${created.status} ${await created.text()}`);
      const paymentId = idFromLocation(created);
      if (!(await settled(paymentId, `${pnr}-fare`))) throw new ProviderUnavailable("Kill Bill purchase did not succeed");
      return paymentId;
    },

    async refund(paymentId: string, transactionKey: string, paise: number): Promise<void> {
      if (await settled(paymentId, transactionKey)) return;
      const body = `{"amount":${rupees(paise)},"currency":"INR","transactionExternalKey":${JSON.stringify(transactionKey)}}`;
      const created = await call("POST", `/payments/${paymentId}/refunds`, body);
      if (created.status !== 201) throw new ProviderUnavailable(`Kill Bill refund: ${created.status} ${await created.text()}`);
      if (!(await settled(paymentId, transactionKey))) throw new ProviderUnavailable("Kill Bill refund did not succeed");
    },
  };
}
