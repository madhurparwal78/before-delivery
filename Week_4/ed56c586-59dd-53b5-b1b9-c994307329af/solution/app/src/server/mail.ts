import { randomUUID } from "node:crypto";
import net from "node:net";
import { STUDIO_EMAIL } from "../shared/catalog.js";
import { budgetLabel, projectTypeLabel, type Enquiry } from "../shared/enquiry.js";
import { type MailSettings } from "./config.js";

/** Outgoing mail: one plain SMTP conversation per enquiry, with no authentication. Every send connects again, so a
 * mail server that was down is used as soon as it is back. */

export class MailUnavailableError extends Error {
  constructor(reason: string) {
    super(`The mail server is unavailable: ${reason}`);
    this.name = "MailUnavailableError";
  }
}

const CONNECT_PROBE_TIMEOUT_MS = 2000;
const ENCODED_WORD_BYTES = 45;
const LINE = "\r\n";

/** A header value in plain printable ASCII goes out as it is; anything else is encoded as RFC 2047 words. */
function encodeHeaderText(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = (): void => {
    if (chunk.length > 0) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`);
    chunk = [];
  };
  for (const character of text) {
    const bytes = [...Buffer.from(character, "utf8")];
    if (chunk.length + bytes.length > ENCODED_WORD_BYTES) flush();
    chunk.push(...bytes);
  }
  flush();
  return words.join(`${LINE} `);
}

interface OutgoingMail {
  readonly envelopeFrom: string;
  readonly envelopeTo: string;
  readonly message: string;
}

function addressOf(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
}

export function composeEnquiryMail(enquiry: Enquiry, from: string): OutgoingMail {
  const projectType = projectTypeLabel(enquiry.projectType);
  const budget = budgetLabel(enquiry.budget);
  const body = [
    `Name: ${enquiry.name}`,
    `Email: ${enquiry.email}`,
    `Project type: ${projectType}`,
    `Budget: ${budget}`,
    "",
    enquiry.message.replace(/\r\n|\r|\n/g, LINE),
  ].join(LINE);
  const sender = addressOf(from);
  const headers = [
    `From: ${from}`,
    `To: ${STUDIO_EMAIL}`,
    `Reply-To: <${enquiry.email}>`,
    `Subject: ${encodeHeaderText(`New enquiry: ${projectType} from ${enquiry.name}`)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${sender.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const encodedBody = Buffer.from(body, "utf8").toString("base64").replace(/.{76}/g, `$&${LINE}`);
  return { envelopeFrom: sender, envelopeTo: STUDIO_EMAIL, message: `${headers.join(LINE)}${LINE}${LINE}${encodedBody}` };
}

interface Reply {
  readonly code: number;
}

/** Reads SMTP replies off a socket, one complete (possibly multi-line) reply at a time. */
function replyReader(socket: net.Socket): () => Promise<Reply> {
  let buffer = "";
  const complete: Reply[] = [];
  let waiting: ((reply: Reply) => void) | undefined;
  let failure: ((error: Error) => void) | undefined;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf(LINE); end !== -1; end = buffer.indexOf(LINE)) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + LINE.length);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) complete.push({ code: Number(line.slice(0, 3)) });
    }
    const next = complete.shift();
    if (next !== undefined && waiting !== undefined) {
      const resolve = waiting;
      waiting = undefined;
      resolve(next);
    }
  });
  socket.on("close", () => failure?.(new MailUnavailableError("the connection closed")));
  return () =>
    new Promise<Reply>((resolve, reject) => {
      const ready = complete.shift();
      if (ready !== undefined) {
        resolve(ready);
        return;
      }
      waiting = resolve;
      failure = reject;
    });
}

export async function sendMail(settings: MailSettings, mail: OutgoingMail): Promise<void> {
  const socket = net.createConnection({ host: settings.host, port: settings.port });
  const deadline = setTimeout(() => socket.destroy(new MailUnavailableError("no answer in time")), settings.timeoutSeconds * 1000);
  const failed = new Promise<never>((_, reject) => {
    socket.on("error", (error) => reject(new MailUnavailableError(error.message)));
  });
  const nextReply = replyReader(socket);
  const expect = async (...codes: number[]): Promise<void> => {
    const reply = await Promise.race([nextReply(), failed]);
    if (!codes.includes(reply.code)) throw new MailUnavailableError(`unexpected reply ${reply.code}`);
  };
  const say = (command: string): void => {
    socket.write(`${command}${LINE}`);
  };
  try {
    await Promise.race([new Promise<void>((resolve) => socket.once("connect", resolve)), failed]);
    await expect(220);
    say("EHLO ottolinerask.example");
    await expect(250);
    say(`MAIL FROM:<${mail.envelopeFrom}>`);
    await expect(250);
    say(`RCPT TO:<${mail.envelopeTo}>`);
    await expect(250, 251);
    say("DATA");
    await expect(354);
    socket.write(`${mail.message}${LINE}.${LINE}`);
    await expect(250);
    say("QUIT");
  } finally {
    clearTimeout(deadline);
    socket.end();
    socket.destroy();
  }
}

/** Whether the mail server accepts a connection right now (health only; nothing is sent). */
export function mailAcceptsConnection(settings: MailSettings): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: settings.host, port: settings.port, timeout: CONNECT_PROBE_TIMEOUT_MS });
    const settle = (accepted: boolean): void => {
      socket.destroy();
      resolve(accepted);
    };
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}
