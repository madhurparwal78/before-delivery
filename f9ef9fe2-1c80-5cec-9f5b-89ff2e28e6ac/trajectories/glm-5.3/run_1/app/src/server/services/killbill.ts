import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Config } from "../config";

export interface KillbillInvoiceSummary {
  invoiceId: string;
  amountCents: number | null;
}

interface KbResponse {
  status: number;
  location: string | undefined;
  body: string;
}

function kbRequest(config: Config, method: string, path: string, body: string | null): Promise<KbResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(config.killbillUrl);
    const doRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString("base64")}`,
      "X-Killbill-ApiKey": config.killbillApiKey,
      "X-Killbill-ApiSecret": config.killbillApiSecret,
      "X-Killbill-CreatedBy": "pilotlight",
    };
    if (body !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const req = doRequest(
      {
        host: url.hostname,
        port: url.port,
        method,
        path,
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, location: res.headers.location, body: data });
        });
      }
    );
    req.setTimeout(10000, () => {
      req.destroy(new Error("killbill timeout"));
    });
    req.on("error", reject);
    if (body !== null) {
      req.write(body);
    }
    req.end();
  });
}

function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Exact cents from a Kill Bill decimal amount string, without float math. */
function centsFromAmount(raw: string | number): number {
  const text = typeof raw === "number" ? raw.toFixed(2) : raw;
  const match = /^-?(\d+)(?:\.(\d{1,}))?$/.exec(text.trim());
  if (!match) {
    return 0;
  }
  const whole = Number.parseInt(match[1] ?? "0", 10);
  const frac = (match[2] ?? "").padEnd(2, "0").slice(0, 2);
  const cents = whole * 100 + Number.parseInt(frac, 10);
  return text.trim().startsWith("-") ? -cents : cents;
}

export interface Charge {
  description: string;
  amountCents: number;
}

export interface Killbill {
  isUp(): Promise<boolean>;
  ensureAccount(memberId: string, business: string, email: string): Promise<string>;
  postCharges(accountId: string, charges: Charge[]): Promise<{ invoiceId: string; amountCents: number }>;
  postCredit(accountId: string, amountCents: number, description: string): Promise<void>;
  reverseInvoice(invoiceId: string): Promise<void>;
  invoiceAmountCents(invoiceId: string): Promise<number | null>;
}

class KillbillError extends Error {}

export function makeKillbill(config: Config): Killbill {
  async function up(): Promise<boolean> {
    try {
      const res = await kbRequest(config, "GET", "/1.0/kb/nodesInfo", null);
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async function isUp(): Promise<boolean> {
    return up();
  }

  async function ensureAccount(memberId: string, business: string, email: string): Promise<string> {
    const byKey = await kbRequest(config, "GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(memberId)}`, null);
    if (byKey.status === 200) {
      const account = JSON.parse(byKey.body) as { accountId: string };
      return account.accountId;
    }
    const body = JSON.stringify({ name: business, externalKey: memberId, email, currency: "USD" });
    const created = await kbRequest(config, "POST", "/1.0/kb/accounts", body);
    if (created.status === 201 && created.location) {
      const id = created.location.split("/").pop();
      if (id) {
        return id;
      }
    }
    // Raced with another create; fall back to the key lookup.
    const again = await kbRequest(config, "GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(memberId)}`, null);
    if (again.status === 200) {
      const account = JSON.parse(again.body) as { accountId: string };
      return account.accountId;
    }
    throw new KillbillError(`cannot ensure billing account for ${memberId}`);
  }

  async function postCharges(accountId: string, charges: Charge[]): Promise<{ invoiceId: string; amountCents: number }> {
    const items = charges.map((charge) => ({
      description: charge.description,
      amount: Number.parseFloat(dollars(charge.amountCents)),
      currency: "USD",
    }));
    const res = await kbRequest(
      config,
      "POST",
      `/1.0/kb/invoices/charges/${encodeURIComponent(accountId)}?autoCommit=true&payInvoice=false`,
      JSON.stringify(items)
    );
    if (res.status !== 200) {
      throw new KillbillError(`charge failed (${res.status})`);
    }
    const created = JSON.parse(res.body) as Array<{ invoiceId: string }>;
    const invoiceId = created[0]?.invoiceId;
    if (!invoiceId) {
      throw new KillbillError("charge returned no invoice");
    }
    const invoice = await kbRequest(config, "GET", `/1.0/kb/invoices/${invoiceId}`, null);
    if (invoice.status !== 200) {
      throw new KillbillError("cannot read billing invoice");
    }
    const summary = readInvoiceAmount(invoice.body);
    return { invoiceId, amountCents: summary };
  }

  async function postCredit(accountId: string, amountCents: number, description: string): Promise<void> {
    const items = [{ description, amount: Number.parseFloat(dollars(amountCents)), currency: "USD", accountId }];
    const res = await kbRequest(
      config,
      "POST",
      `/1.0/kb/credits?accountId=${encodeURIComponent(accountId)}&autoCommit=true`,
      JSON.stringify(items)
    );
    if (res.status !== 200) {
      throw new KillbillError(`credit failed (${res.status})`);
    }
  }

  async function reverseInvoice(invoiceId: string): Promise<void> {
    const invoice = await kbRequest(config, "GET", `/1.0/kb/invoices/${invoiceId}`, null);
    if (invoice.status !== 200) {
      throw new KillbillError("cannot read billing invoice for reversal");
    }
    const parsed = JSON.parse(invoice.body) as {
      items: Array<{ invoiceItemId: string; itemType: string; accountId: string }>;
    };
    for (const item of parsed.items) {
      if (item.itemType !== "EXTERNAL_CHARGE") {
        continue;
      }
      const body = JSON.stringify({
        accountId: item.accountId,
        invoiceItemId: item.invoiceItemId,
        currency: "USD",
        description: "Reversed by Pilotlight",
      });
      const res = await kbRequest(config, "POST", `/1.0/kb/invoices/${invoiceId}`, body);
      if (res.status !== 201) {
        throw new KillbillError(`adjustment failed (${res.status})`);
      }
    }
  }

  async function invoiceAmountCents(invoiceId: string): Promise<number | null> {
    try {
      const res = await kbRequest(config, "GET", `/1.0/kb/invoices/${invoiceId}`, null);
      if (res.status !== 200) {
        return null;
      }
      return readInvoiceAmount(res.body);
    } catch {
      return null;
    }
  }

  /** The top-level `amount` of a Kill Bill invoice, parsed exactly. */
  function readInvoiceAmount(body: string): number {
    const invoice = parseJsonExact(body) as { amount?: unknown };
    return centsFromAmount(String(invoice.amount ?? 0));
  }

  return { isUp, ensureAccount, postCharges, postCredit, reverseInvoice, invoiceAmountCents };
}

/**
 * A JSON parser that keeps numbers as their literal text, so money never goes
 * through binary floating point.
 */
export function parseJsonExact(text: string): unknown {
  let i = 0;
  function skipWhitespace(): void {
    while (i < text.length && /\s/.test(text[i]!)) {
      i++;
    }
  }
  function parseValue(): unknown {
    skipWhitespace();
    const c = text[i];
    if (c === "{") {
      return parseObject();
    }
    if (c === "[") {
      return parseArray();
    }
    if (c === '"') {
      return parseString();
    }
    if (c === "t") {
      i += 4;
      return true;
    }
    if (c === "f") {
      i += 5;
      return false;
    }
    if (c === "n") {
      i += 4;
      return null;
    }
    return parseNumber();
  }
  function parseObject(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    i++; // {
    skipWhitespace();
    if (text[i] === "}") {
      i++;
      return result;
    }
    for (;;) {
      skipWhitespace();
      const key = parseString();
      skipWhitespace();
      i++; // :
      result[key] = parseValue();
      skipWhitespace();
      if (text[i] === ",") {
        i++;
        continue;
      }
      i++; // }
      return result;
    }
  }
  function parseArray(): unknown[] {
    const result: unknown[] = [];
    i++; // [
    skipWhitespace();
    if (text[i] === "]") {
      i++;
      return result;
    }
    for (;;) {
      result.push(parseValue());
      skipWhitespace();
      if (text[i] === ",") {
        i++;
        continue;
      }
      i++; // ]
      return result;
    }
  }
  function parseString(): string {
    i++; // "
    let out = "";
    while (text[i] !== '"') {
      if (text[i] === "\\") {
        const next = text[i + 1];
        if (next === "u") {
          out += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        out += next === "/" ? "/" : next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : (next ?? "");
        i += 2;
        continue;
      }
      out += text[i] ?? "";
      i++;
    }
    i++; // "
    return out;
  }
  function parseNumber(): number | string {
    const start = i;
    while (i < text.length && /[0-9eE+\-.]/.test(text[i]!)) {
      i++;
    }
    const raw = text.slice(start, i);
    if (raw.includes(".") || raw.includes("e") || raw.includes("E")) {
      return raw;
    }
    return Number.parseInt(raw, 10);
  }
  const value = parseValue();
  return value;
}
