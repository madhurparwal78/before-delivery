import net from "node:net";
import { config } from "./config";
import { fail } from "./errors";
import { asText, isObject, parseJson } from "./parse";

const CONNECT_TIMEOUT_MS = 3000;
const COMMAND_TIMEOUT_MS = 5000;

const addressOf = (header: string): string => {
  const match = /<([^>]+)>/.exec(header);
  return (match?.[1] ?? header).trim();
};

const needsEncoding = (text: string): boolean => /[^\x20-\x7e]/.test(text);

/** RFC 2047 encoded words of at most 20 characters, so a long Polish subject stays within line limits. */
function encodeHeader(text: string): string {
  if (!needsEncoding(text)) return text;
  const chars = [...text];
  const words: string[] = [];
  for (let i = 0; i < chars.length; i += 20) {
    words.push(`=?UTF-8?B?${Buffer.from(chars.slice(i, i + 20).join(""), "utf8").toString("base64")}?=`);
  }
  return words.join("\r\n ");
}

function wrapBase64(data: string): string {
  return (data.match(/.{1,76}/g) ?? []).join("\r\n");
}

function composeMessage(to: string, subject: string, body: string): string {
  return [
    `From: ${config.mail.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@holmgarth.example>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(body, "utf8").toString("base64")),
    "",
  ].join("\r\n");
}

/** A minimal SMTP dialogue with Mailpit: any failure to talk to it is `mail_unavailable`. */
export function sendMail(to: string, subject: string, body: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: config.mail.smtpHost, port: config.mail.smtpPort });
    const refuse = (): void => {
      socket.destroy();
      reject(new Error("smtp"));
    };
    socket.setTimeout(COMMAND_TIMEOUT_MS, refuse);
    const connectTimer = setTimeout(refuse, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => clearTimeout(connectTimer));
    socket.on("error", () => {
      clearTimeout(connectTimer);
      refuse();
    });

    const steps = [
      { send: null, expect: "220" },
      { send: "EHLO fittings-desk", expect: "250" },
      { send: `MAIL FROM:<${addressOf(config.mail.from)}>`, expect: "250" },
      { send: `RCPT TO:<${addressOf(to)}>`, expect: "250" },
      { send: "DATA", expect: "354" },
      { send: `${composeMessage(to, subject, body).replace(/^\./gm, "..")}\r\n.`, expect: "250" },
      { send: "QUIT", expect: "221" },
    ];
    let step = 0;
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      const lines = buffer.split("\r\n");
      const last = lines[lines.length - 2];
      if (!buffer.endsWith("\r\n") || last === undefined || /^\d{3}-/.test(last)) return;
      const code = last.slice(0, 3);
      buffer = "";
      const current = steps[step];
      if (!current || code !== current.expect) return refuse();
      step += 1;
      const next = steps[step];
      if (!next) {
        socket.end();
        resolve();
        return;
      }
      if (next.send !== null) socket.write(`${next.send}\r\n`);
    });
  }).catch(() => fail("mail_unavailable"));
}

// ---- Mailpit HTTP API (erasure) -----------------------------------------------------------

async function mailpit(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(`${config.mail.mailpitUrl}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      return fail("mail_unavailable");
    }
    return response;
  } catch {
    return fail("mail_unavailable");
  }
}

/** The ids of every message whose recipient address equals `address` (any letter case), and no other. */
export async function messagesTo(address: string): Promise<string[]> {
  const wanted = address.toLowerCase();
  const ids: string[] = [];
  const query = encodeURIComponent(`to:"${address}"`);
  const response = await mailpit(`/api/v1/search?query=${query}&limit=500`);
  const payload = parseJson(await response.text());
  const messages = isObject(payload) && Array.isArray(payload["messages"]) ? payload["messages"] : [];
  for (const message of messages) {
    if (!isObject(message) || !Array.isArray(message["To"])) continue;
    const id = asText(message["ID"]);
    const recipients = message["To"].map((entry) => (isObject(entry) ? (asText(entry["Address"]) ?? "").toLowerCase() : ""));
    if (id && recipients.includes(wanted)) ids.push(id);
  }
  return ids;
}

export async function deleteMessages(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const response = await mailpit("/api/v1/messages", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: ids }),
  });
  await response.arrayBuffer();
}
