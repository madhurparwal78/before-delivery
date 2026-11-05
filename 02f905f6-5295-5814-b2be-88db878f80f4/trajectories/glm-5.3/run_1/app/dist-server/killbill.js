import { AppError } from "./errors.js";
// Kill Bill client. All owed figures come from here.
export class KillBillClient {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    headers() {
        const auth = Buffer.from(`${this.cfg.killbill.username}:${this.cfg.killbill.password}`).toString("base64");
        return {
            Authorization: `Basic ${auth}`,
            "X-Killbill-ApiKey": this.cfg.killbill.apiKey,
            "X-Killbill-ApiSecret": this.cfg.killbill.apiSecret,
            "X-Killbill-CreatedBy": "shelfmark",
            "Content-Type": "application/json"
        };
    }
    async request(method, path, body, query) {
        const url = `${this.cfg.killbill.url}/1.0/kb${path}${query ? (path.includes("?") ? "&" : "?") + query : ""}`;
        let res;
        try {
            res = await fetch(url, {
                method,
                headers: this.headers(),
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(10000)
            });
        }
        catch {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        const location = res.headers.get("Location") ?? undefined;
        if (res.status === 204)
            return { status: 204, json: null, location };
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        }
        catch {
            json = null;
        }
        return { status: res.status, json, location };
    }
    async reachable() {
        try {
            const res = await fetch(`${this.cfg.killbill.url}/1.0/kb/tenants`, {
                headers: this.headers(),
                signal: AbortSignal.timeout(4000)
            });
            return res.status > 0;
        }
        catch {
            return false;
        }
    }
    async getAccountByExternalKey(externalKey) {
        const res = await this.request("GET", `/accounts`, undefined, `externalKey=${encodeURIComponent(externalKey)}`);
        if (res.status === 404)
            return null;
        if (res.status !== 200) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        const acc = res.json;
        if (!acc || !acc.accountId)
            return null;
        return acc;
    }
    async createAccount(externalKey, name, email) {
        const res = await this.request("POST", `/accounts`, {
            name,
            email,
            externalKey,
            currency: "USD"
        });
        if (res.status === 201) {
            const accountId = (res.location ?? "").split("/").pop();
            return { accountId, name, email, externalKey };
        }
        if (res.status === 400) {
            const existing = await this.getAccountByExternalKey(externalKey);
            if (existing)
                return existing;
        }
        throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    // One external charge on the owner's account. Returns the invoice id.
    async createCharge(externalKey, amountDollars, description) {
        const account = await this.getOrCreateAccount(externalKey, description);
        const res = await this.request("POST", `/invoices/charges/${account.accountId}`, [{ amount: Number(amountDollars), currency: "USD", description }], "autoCommit=true");
        if (res.status !== 200) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        const items = res.json;
        if (!items || !items[0] || !items[0].invoiceId) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        return { invoiceId: items[0].invoiceId };
    }
    async getOrCreateAccount(externalKey, _hint) {
        const existing = await this.getAccountByExternalKey(externalKey);
        if (existing)
            return existing;
        return this.createAccount(externalKey, _hint, externalKey);
    }
    // Creates the account when missing and corrects the recorded name and email.
    // Kill Bill's create refuses a taken key, so concurrent instances are safe.
    async ensureAccount(externalKey, name, email) {
        const existing = await this.getAccountByExternalKey(externalKey);
        if (!existing) {
            await this.createAccount(externalKey, name, email);
            return;
        }
        if (existing.name !== name || existing.email !== email) {
            try {
                await this.request("PUT", `/accounts/${existing.accountId}`, {
                    accountId: existing.accountId,
                    name,
                    email,
                    externalKey,
                    currency: "USD"
                });
            }
            catch {
                // name/email correction is best-effort; billing still works
            }
        }
    }
    async voidInvoice(invoiceId) {
        const res = await this.request("PUT", `/invoices/${invoiceId}/voidInvoice`);
        if (res.status !== 204 && res.status !== 200) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
    }
    // Records a PURCHASE for the invoice's full balance. Returns success only
    // when Kill Bill confirms a SUCCESS transaction.
    async purchasePayment(externalKey, invoiceId, amountDollars, paymentExternalKey) {
        const account = await this.getAccountByExternalKey(externalKey);
        if (!account) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        const res = await this.request("POST", `/invoices/${invoiceId}/payments`, {
            accountId: account.accountId,
            targetInvoiceId: invoiceId,
            purchasedAmount: Number(amountDollars),
            currency: "USD",
            paymentExternalKey
        }, "externalPayment=true");
        if (res.status === 404)
            return { ok: false };
        if (res.status !== 201 && res.status !== 200 && res.status !== 204) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        // Confirm the PURCHASE succeeded by reading the payment back.
        const lookup = await this.request("GET", `/payments`, undefined, `externalKey=${encodeURIComponent(paymentExternalKey)}`);
        if (lookup.status !== 200) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        const payment = res.status === 204 ? lookup.json : (res.json ?? lookup.json);
        const success = payment?.transactions?.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
        return { ok: success === true };
    }
    async getInvoice(invoiceId) {
        const res = await this.request("GET", `/invoices/${invoiceId}`);
        if (res.status === 404)
            return null;
        if (res.status !== 200) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        return res.json;
    }
    async listInvoices(externalKey) {
        const account = await this.getAccountByExternalKey(externalKey);
        if (!account)
            return [];
        const res = await this.request("GET", `/accounts/${account.accountId}/invoices`);
        if (res.status !== 200) {
            throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
        }
        const list = res.json;
        // The invoice list's balances lag behind recent charges; read each
        // invoice for its current balance.
        const fresh = [];
        for (const inv of list) {
            const current = await this.getInvoice(inv.invoiceId);
            fresh.push(current ?? inv);
        }
        return fresh;
    }
    // Owed for an account = its Kill Bill account balance (sum of invoice balances).
    async accountBalanceCents(externalKey) {
        const invoices = await this.listInvoices(externalKey);
        let total = 0;
        for (const inv of invoices) {
            total += Math.round(inv.balance * 100);
        }
        return total;
    }
}
