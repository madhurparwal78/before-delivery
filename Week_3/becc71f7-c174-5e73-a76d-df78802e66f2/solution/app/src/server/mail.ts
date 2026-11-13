// A small SMTP client: every mail is handed to Mailpit at its action, or the action is refused.
import { connect, type Socket } from "node:net";
import { config } from "./config";

export class MailDown extends Error {}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const TIMEOUT_MS = 8000;

const fromAddress = (): string => /<([^>]+)>/.exec(config.mailFrom)?.[1] ?? config.mailFrom.trim();

function encodeSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
}

function message({ to, subject, text }: Mail): string {
  const body = Buffer.from(text).toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${config.mailFrom}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
    "",
  ].join("\r\n");
}

/** Reads one SMTP reply, multi-line replies included, and refuses anything but the expected class. */
function replies(socket: Socket): (expected: string) => Promise<void> {
  let buffered = "";
  const waiting: ((line: string | Error) => void)[] = [];
  const settled: (string | Error)[] = [];
  const deliver = (item: string | Error): void => {
    const next = waiting.shift();
    if (next) next(item);
    else settled.push(item);
  };
  socket.on("data", (chunk) => {
    buffered += chunk.toString("latin1");
    for (let end = buffered.indexOf("\r\n"); end >= 0; end = buffered.indexOf("\r\n")) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (line[3] !== "-") deliver(line);
    }
  });
  socket.on("error", (error) => deliver(new MailDown(error.message)));
  socket.on("close", () => deliver(new MailDown("SMTP session closed")));
  socket.on("timeout", () => {
    deliver(new MailDown("SMTP timed out"));
    socket.destroy();
  });
  return async (expected) => {
    const earlier = settled.shift();
    const reply = earlier ?? (await new Promise<string | Error>((resolve) => waiting.push(resolve)));
    if (reply instanceof Error) throw reply;
    if (!reply.startsWith(expected)) throw new MailDown(`SMTP answered ${reply}`);
  };
}

/** One mail on its own SMTP session, complete but for the final dot, which is what makes the server accept it. */
interface WaitingMail {
  socket: Socket;
  expect: (expected: string) => Promise<void>;
}

async function prepare(mail: Mail): Promise<WaitingMail> {
  const socket = connect({ host: config.smtp.host, port: config.smtp.port, timeout: TIMEOUT_MS });
  const expect = replies(socket);
  try {
    await expect("220");
    for (const [command, reply] of [["EHLO atelier-ourlet", "250"], [`MAIL FROM:<${fromAddress()}>`, "250"], [`RCPT TO:<${mail.to}>`, "250"], ["DATA", "354"]] as const) {
      socket.write(`${command}\r\n`);
      await expect(reply);
    }
    socket.write(message(mail));
    return { socket, expect };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function accept({ socket, expect }: WaitingMail): Promise<void> {
  socket.write(".\r\n");
  await expect("250");
  socket.end("QUIT\r\n");
}

interface WaitingMails {
  send(): Promise<void>;
  discard(): void;
}

/** Brings every mail up to its final dot, so a server that can't take them all refuses before any is sent. */
export async function prepareMails(mails: Mail[]): Promise<WaitingMails> {
  const waiting: WaitingMail[] = [];
  const discard = (): void => waiting.forEach(({ socket }) => socket.destroy());
  try {
    for (const mail of mails) waiting.push(await prepare(mail));
  } catch (error) {
    discard();
    throw error;
  }
  return {
    discard,
    async send() {
      try {
        if (waiting.some(({ socket }) => socket.readyState !== "open")) throw new MailDown("SMTP session closed");
        await Promise.all(waiting.map(accept));
      } catch (error) {
        discard();
        throw error;
      }
    },
  };
}

export async function sendMail(mail: Mail): Promise<void> {
  await (await prepareMails([mail])).send();
}
