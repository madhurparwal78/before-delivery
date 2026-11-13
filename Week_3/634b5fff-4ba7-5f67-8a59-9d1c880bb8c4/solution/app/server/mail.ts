import { connect } from "node:net";
import { config } from "./config.js";

/** Plain SMTP to Mailpit: one message per call, UTF-8 text body in base64. */

class MailUnreachable extends Error {
  constructor() {
    super("mail unreachable");
  }
}

const SAFE_HEADER = /^[^\r\n\0\u0085\u2028\u2029]*$/;

const envelopeAddress = (from: string): string => {
  const open = from.indexOf("<");
  return open >= 0 ? from.slice(open + 1, from.indexOf(">")) : from.trim();
};

interface Step {
  send: string | null;
  expect: number;
}

/** Walks an SMTP conversation: each step sends its line (the first sends nothing) and awaits the expected reply code. */
const dialogue = (steps: Step[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    const abandon = (): void => { socket.destroy(); reject(new MailUnreachable()); };
    socket.setTimeout(15000, abandon);
    socket.on("error", abandon);
    let buffer = "";
    let step = 0;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const last = buffer.split("\r\n").filter((line) => line.length > 0).at(-1) ?? "";
      if (!buffer.endsWith("\r\n") || !/^\d{3} /.test(last)) return;
      buffer = "";
      if (Number(last.slice(0, 3)) !== steps[step]?.expect) return abandon();
      step += 1;
      const next = steps[step];
      if (!next) { socket.end(); resolve(); return; }
      socket.write(next.send ?? "");
    });
  });

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const sendMail = async (mail: Mail): Promise<void> => {
  if (![mail.to, mail.subject, config.smtp.from].every((value) => SAFE_HEADER.test(value))) throw new MailUnreachable();
  const body = Buffer.from(mail.text, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  const message = [
    `From: ${config.smtp.from}`, `To: ${mail.to}`, `Subject: ${mail.subject}`, `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", body,
  ].join("\r\n");
  await dialogue([
    { send: null, expect: 220 },
    { send: "EHLO svovlstik.press\r\n", expect: 250 },
    { send: `MAIL FROM:<${envelopeAddress(config.smtp.from)}>\r\n`, expect: 250 },
    { send: `RCPT TO:<${mail.to}>\r\n`, expect: 250 },
    { send: "DATA\r\n", expect: 354 },
    { send: `${message}\r\n.\r\n`, expect: 250 },
    { send: "QUIT\r\n", expect: 221 },
  ]);
};
