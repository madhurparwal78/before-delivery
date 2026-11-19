import nodemailer, { type Transporter } from "nodemailer";
import { request } from "undici";
import { randomBytes } from "node:crypto";
import type { Config } from "./config.js";
import { errors } from "./errors.js";

const TIMEOUT = 5000;

export interface MailLine {
  to: string;
  subject: string;
  text: string;
}

let transporter: Transporter | null = null;

function transport(cfg: Config): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
  }
  return transporter;
}

export async function sendMail(cfg: Config, m: MailLine): Promise<void> {
  try {
    await transport(cfg).sendMail({
      from: cfg.mailFrom,
      to: m.to,
      subject: m.subject,
      text: m.text,
    });
  } catch {
    throw errors.provider("The mail service is unavailable right now. Nothing was sent.");
  }
}

/** The app never treats a mail failure as fatal on public writes; errors flow as 503. */
export async function trySendMail(cfg: Config, m: MailLine): Promise<boolean> {
  try {
    await transport(cfg).sendMail({ from: cfg.mailFrom, to: m.to, subject: m.subject, text: m.text });
    return true;
  } catch {
    return false;
  }
}

export async function fetchJson<T>(url: string, init?: { method?: "GET" | "POST" | "PUT" | "DELETE"; headers?: Record<string, string>; body?: string }): Promise<T> {
  const res = await request(url, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
    bodyTimeout: TIMEOUT,
    headersTimeout: TIMEOUT,
  });
  const text = await res.body.text();
  if (res.statusCode >= 500 || res.statusCode < 200) throw new Error("provider");
  return JSON.parse(text) as T;
}

export async function wireGet<T>(cfg: Config, path: string): Promise<T | null> {
  try {
    const res = await request(cfg.wiremockUrl + path, { bodyTimeout: TIMEOUT, headersTimeout: TIMEOUT });
    const text = await res.body.text();
    if (res.statusCode !== 200) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function wirePost<T>(cfg: Config, path: string, body: unknown): Promise<T | null> {
  try {
    const res = await request(cfg.wiremockUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      bodyTimeout: TIMEOUT,
      headersTimeout: TIMEOUT,
    });
    const text = await res.body.text();
    if (res.statusCode !== 200) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface FlightInfo {
  scheduledArrival: string;
  actualArrival: string | null;
  status: string;
}

export interface OperatorRow {
  id: string;
  name: string;
  town: string;
  email: string;
  telephone: string;
  sizes: number[];
}

export async function getFlight(cfg: Config, code: string, date: string): Promise<FlightInfo | null> {
  return wireGet<FlightInfo>(cfg, `/v1/flights/${encodeURIComponent(code)}?date=${date}`);
}

/** Fetch every page of the directory; null on any failure (all or nothing). */
export async function fetchDirectory(cfg: Config): Promise<OperatorRow[] | null> {
  const out: OperatorRow[] = [];
  let cursor: string | null = null;
  let guard = 0;
  for (;;) {
    const path: string = `/v2/operators${cursor ? `?cursor=${cursor}` : ""}`;
    const page = await wireGet<{ operators: OperatorRow[]; nextCursor: string | null }>(cfg, path);
    if (!page) return null;
    out.push(...page.operators);
    cursor = page.nextCursor ?? null;
    guard++;
    if (guard > 10 || !cursor) return out;
  }
}

export async function renderPdf(cfg: Config, html: string): Promise<Buffer> {
  try {
    const boundary = "----wayticketform" + randomBytes(8).toString("hex");
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="index.html"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, Buffer.from(html, "utf8"), tail]);
    const res = await request(`${cfg.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      bodyTimeout: 30000,
      headersTimeout: 30000,
    });
    if (res.statusCode !== 200) throw new Error("render");
    const chunks: Buffer[] = [];
    for await (const c of res.body) chunks.push(Buffer.from(c));
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) throw new Error("empty");
    return buf;
  } catch {
    throw errors.provider("The PDF service is unavailable right now. Nothing was saved.");
  }
}

export async function notifyDriver(cfg: Config, telephoneDigits: string, title: string, message: string): Promise<boolean> {
  try {
    const res = await request(`${cfg.ntfyUrl}/driver-${telephoneDigits}`, {
      method: "POST",
      body: message,
      headers: {
        Title: title,
        ...(cfg.ntfyUsername
          ? { Authorization: "Basic " + Buffer.from(cfg.ntfyUsername + ":" + cfg.ntfyPassword).toString("base64") }
          : {}),
      },
      bodyTimeout: TIMEOUT,
      headersTimeout: TIMEOUT,
    });
    await res.body.text();
    return res.statusCode >= 200 && res.statusCode < 300;
  } catch {
    return false;
  }
}
