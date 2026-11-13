export class KillBillClient {
    base;
    headers;
    authHeader;
    constructor(cfg) {
        this.base = cfg.url.replace(/\/$/, '');
        this.authHeader = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
        this.headers = {
            'X-Killbill-ApiVersion': 'v1',
            'X-Killbill-ApiKey': cfg.apiKey,
            'X-Killbill-ApiSecret': cfg.apiSecret,
            'X-Killbill-CreatedBy': 'relayline',
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
    }
    async request(method, path, body) {
        let response;
        try {
            response = await fetch(`${this.base}${path}`, {
                method,
                headers: { ...this.headers, Authorization: this.authHeader },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(8000),
            });
        }
        catch {
            throw new KillBillUnavailable();
        }
        let json = null;
        const text = await response.text();
        if (text) {
            try {
                json = JSON.parse(text);
            }
            catch {
                json = null;
            }
        }
        if (!response.ok && (response.status >= 500 || response.status === 404)) {
            // 404 for a known account is an outage-shaped answer; callers treat reachable=false.
            if (response.status >= 500)
                throw new KillBillUnavailable();
        }
        return { ok: response.ok, status: response.status, json };
    }
    async requestJson(method, path, body) {
        const res = await this.request(method, path, body);
        if (!res.ok)
            throw new KillBillUnavailable();
        return res.json;
    }
    /** The organisation's account, creating it the first time it is needed. */
    async ensureAccount(orgId, orgName) {
        const found = await this.request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(orgId)}`);
        if (found.ok) {
            const accountId = found.json?.accountId;
            if (accountId)
                return accountId;
        }
        const created = await this.request('POST', '/1.0/kb/accounts', { name: orgName, externalKey: orgId, currency: 'USD' });
        if (!created.ok)
            throw new KillBillUnavailable();
        const confirmed = await this.request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(orgId)}`);
        const accountId = confirmed.json?.accountId;
        if (!confirmed.ok || !accountId)
            throw new KillBillUnavailable();
        return accountId;
    }
    /** Post one external charge, committed at once. Returns the invoice item. */
    async postCharge(accountId, amountCents, description) {
        const dollars = amountCents / 100;
        const res = await this.request('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, [
            { amount: dollars, currency: 'USD', description },
        ]);
        if (!res.ok || !Array.isArray(res.json))
            throw new KillBillUnavailable();
        const items = res.json;
        if (items.length === 0)
            throw new KillBillUnavailable();
        return { invoiceItemId: items[0].invoiceItemId };
    }
    /** Every invoice item on the account's invoices, with adjustments applied. Each invoice
     * is read individually because the account list does not carry items in this version. */
    async listCharges(accountId) {
        const invoices = await this.requestJson('GET', `/1.0/kb/accounts/${accountId}/invoices`);
        const charges = new Map();
        for (const invoice of invoices) {
            const detail = await this.requestJson('GET', `/1.0/kb/invoices/${invoice.invoiceId}?withItems=true`);
            for (const item of detail.items ?? []) {
                if (item.itemType === 'EXTERNAL_CHARGE') {
                    charges.set(item.invoiceItemId, {
                        invoiceItemId: item.invoiceItemId,
                        amount: item.amount,
                        description: item.description,
                        adjustmentsCents: 0,
                    });
                }
            }
            for (const item of detail.items ?? []) {
                if (item.itemType === 'ITEM_ADJ' && item.linkedInvoiceItemId) {
                    const target = charges.get(item.linkedInvoiceItemId);
                    if (target)
                        target.adjustmentsCents += Math.round(item.amount * 100);
                }
            }
        }
        return [...charges.values()];
    }
    /** Read items back from a single invoice, used by the read-back sync step. */
    async listInvoiceItems(accountId, invoiceId) {
        const invoice = await this.requestJson('GET', `/1.0/kb/invoices/${invoiceId}?withItems=true`);
        const charges = [];
        for (const item of invoice.items ?? []) {
            if (item.itemType === 'EXTERNAL_CHARGE') {
                charges.push({ invoiceItemId: item.invoiceItemId, amount: item.amount, description: item.description, adjustmentsCents: 0 });
            }
        }
        return charges;
    }
    async health() {
        try {
            const res = await this.request('GET', '/1.0/kb/healthcheck');
            return res.ok;
        }
        catch {
            return false;
        }
    }
}
export class KillBillUnavailable extends Error {
    constructor() {
        super('Kill Bill is unreachable');
    }
}
/** Cents for a charge's current amount: the charge plus its adjustments. */
export function chargeTotalCents(charge) {
    return Math.round(charge.amount * 100) + charge.adjustmentsCents;
}
