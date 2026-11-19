import { randomUUID } from "node:crypto";
import net from "node:net";
import { createInterface } from "node:readline";
import { config } from "./config";

/** The mail server did not answer or did not accept the message. */
export class MailError extends Error {}

const TIMEOUT_MS = 5000;

interface Mail {
  to: string;
  subject: string;
  body: string;
}

function envelopeAddress(header: string): string {
  const open = header.indexOf("<");
  return open === -1 ? header.trim() : header.slice(open + 1, header.indexOf(">", open));
}

/** Delivers one plain-text message over SMTP; resolves only once the server has accepted it. */
export async function sendMail(mail: Mail): Promise<void> {
  const { host, port, from } = config.smtp;
  const socket = net.createConnection({ host, port });
  socket.setTimeout(TIMEOUT_MS);
  const failure = new Promise<never>((_, reject) => {
    socket.once("error", reject);
    socket.once("timeout", () => reject(new MailError("mail server timed out")));
  });
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]();

  const reply = async (expected: number): Promise<void> => {
    for (;;) {
      const { value, done } = await lines.next();
      const match = done ? null : /^(\d{3})([ -])/.exec(value);
      if (!match) throw new MailError("mail server closed the connection");
      if (match[2] === " ") {
        if (Number(match[1]) !== expected) throw new MailError(`mail server answered ${String(value)}`);
        return;
      }
    }
  };
  const command = async (text: string, expected: number): Promise<void> => {
    socket.write(`${text}\r\n`);
    await reply(expected);
  };

  const message = [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@quarkyard>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    ...mail.body.split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line)),
  ].join("\r\n");

  const conversation = async (): Promise<void> => {
    await reply(220);
    await command("EHLO quarkyard", 250);
    await command(`MAIL FROM:<${envelopeAddress(from)}>`, 250);
    await command(`RCPT TO:<${mail.to}>`, 250);
    await command("DATA", 354);
    await command(`${message}\r\n.`, 250);
    await command("QUIT", 221);
  };

  try {
    await Promise.race([conversation(), failure]);
  } catch (error) {
    throw error instanceof MailError ? error : new MailError("mail server unreachable", { cause: error });
  } finally {
    socket.destroy();
  }
}
