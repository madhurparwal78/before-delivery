/**
 * Email over plain SMTP, implemented on node:net. A synchronous send counts only when
 * the server accepts the message data. Queued mail is delivered by the sweep instead.
 */

import { connect, type Socket } from "node:net";
import { ProviderError } from "../http/errors.js";

export class MailUnavailableError extends ProviderError {
  constructor(cause: Error | string) {
    super("mail", cause);
  }
}

const SMTP_TIMEOUT_MS = 10_000;

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

export const MAIL_FROM = "Stationkeeper at Larder Row Kitchen <bookings@larderrow.test>";

interface Reply {
  code: number;
  lines: string[];
}

/** Read one SMTP reply, possibly multiline, ending in a line with a space in position 4. */
function readReply(socket: Socket, timeout: number): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    let buffer = "";
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    socket.on("error", onError);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP reply timeout"));
    }, timeout);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      if (lines.length > 0 && /^[2345]\d\d /.test(lines[lines.length - 1])) {
        cleanup();
        const code = Number(lines[lines.length - 1].slice(0, 3));
        resolve({ code, lines });
      }
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
  });
}

async function command(socket: Socket, line: string, accepted: number[]): Promise<Reply> {
  socket.write(`${line}\r\n`);
  const reply = await readReply(socket, SMTP_TIMEOUT_MS);
  if (!accepted.includes(reply.code)) {
    const detail = reply.lines.join(" ").slice(0, 200);
    throw new Error(`SMTP ${reply.code} after ${line.split(" ")[0]}: ${detail}`);
  }
  return reply;
}

/** The DATA payload, with dot-stuffing for lines that begin with a dot. */
function dataMessage(email: OutgoingEmail): string {
  const headers = [
    `From: ${MAIL_FROM}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    ""
  ];
  const body = email.body.replace(/^\./gm, "..");
  return `${headers.join("\r\n")}\r\n${body}`;
}

/** Synchronous send during a unit of work. Throws MailUnavailableError unless SMTP accepts. */
export async function sendEmail(host: string, port: number, email: OutgoingEmail): Promise<void> {
  const ops = async (): Promise<void> => {
    const socket: Socket = await new Promise<Socket>((resolve, reject) => {
      const s = connect({ host, port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error("SMTP connect timeout"));
      }, SMTP_TIMEOUT_MS);
      s.once("connect", () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    try {
      const greeting = await readReply(socket, SMTP_TIMEOUT_MS);
      if (greeting.code !== 220) {
        throw new Error(`SMTP greeting ${greeting.code}`);
      }
      await command(socket, "EHLO stationkeeper", [250]);
      await command(socket, "MAIL FROM:<bookings@larderrow.test>", [250]);
      await command(socket, `RCPT TO:<${email.to}>`, [250, 251]);
      await command(socket, "DATA", [354]);
      socket.write(`${dataMessage(email)}\r\n.\r\n`);
      const accepted = await readReply(socket, SMTP_TIMEOUT_MS);
      if (accepted.code !== 250) {
        throw new Error(`SMTP ${accepted.code} after data: ${accepted.lines.join(" ").slice(0, 200)}`);
      }
      await command(socket, "QUIT", [221]).catch(() => undefined);
    } finally {
      socket.destroy();
    }
  };
  try {
    await ops();
  } catch (e) {
    throw new MailUnavailableError(
      `SMTP send failed to ${email.to}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export class Mailer {
  constructor(
    private readonly host: string,
    private readonly port: number
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    await sendEmail(this.host, this.port, email);
  }
}
