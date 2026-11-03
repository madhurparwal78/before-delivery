// Account mail over plain SMTP (no authentication, no TLS), as Mailpit accepts it.
import { randomBytes } from "node:crypto";
import net from "node:net";

const FROM_NAME = "Pratfall Cup";
const FROM_ADDRESS = "no-reply@wobblewell.test";
const DECIDE_MS = 4500;

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export class MailUnavailable extends Error {}

let host = "";
let port = 0;

export function configureMail(smtpHost: string, smtpPort: number): void {
  host = smtpHost;
  port = smtpPort;
}

function compose(mail: Mail): string {
  const id = `${randomBytes(12).toString("hex")}@wobblewell.test`;
  const headers = [
    `From: ${FROM_NAME} <${FROM_ADDRESS}>`,
    `To: <${mail.to}>`,
    `Subject: ${mail.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${id}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  const body = mail.text.split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line));
  return [...headers, "", ...body].join("\r\n");
}

interface Step {
  send: string | null;
  expect: number;
}

// Sends one message, or throws MailUnavailable when the server can't be reached or refuses it within the deadline.
export function sendMail(mail: Mail): Promise<void> {
  return converse([
    { send: null, expect: 220 },
    { send: "EHLO pratfall-cup", expect: 250 },
    { send: `MAIL FROM:<${FROM_ADDRESS}>`, expect: 250 },
    { send: `RCPT TO:<${mail.to}>`, expect: 250 },
    { send: "DATA", expect: 354 },
    { send: `${compose(mail)}\r\n.`, expect: 250 },
    { send: "QUIT", expect: 221 },
  ]);
}

// Checks that the mail server answers, without sending anything.
export function probeMail(): Promise<void> {
  return converse([
    { send: null, expect: 220 },
    { send: "EHLO pratfall-cup", expect: 250 },
    { send: "QUIT", expect: 221 },
  ]);
}

function converse(steps: Step[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = "";
    let index = 0;
    let settled = false;
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error === null) resolve();
      else reject(new MailUnavailable(error.message));
    };
    const timer = setTimeout(() => finish(new Error("mail server did not answer in time")), DECIDE_MS);
    socket.setEncoding("utf8");
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(index >= steps.length - 1 ? null : new Error("mail server closed the connection")));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.length > 3 && line[3] === "-") continue;
        const step = steps[index];
        if (step === undefined) return;
        if (Number(line.slice(0, 3)) !== step.expect) {
          finish(new Error(`mail server answered ${line.slice(0, 3)}`));
          return;
        }
        index += 1;
        if (index === steps.length) {
          finish(null);
          return;
        }
        const next = steps[index];
        if (next?.send !== null && next?.send !== undefined) socket.write(`${next.send}\r\n`);
      }
    });
  });
}
