import { connect } from "node:net";
import { config } from "./config.ts";

const SOCKET_TIMEOUT_MS = 5000;

/** The address inside "Name <address>", or the bare address. */
function address(mailbox: string): string {
  const open = mailbox.indexOf("<");
  return open === -1 ? mailbox.trim() : mailbox.slice(open + 1, mailbox.indexOf(">"));
}

function encodeSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
}

function composeMessage(to: string, subject: string, body: string): string {
  const wrapped = (Buffer.from(body).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapped,
  ].join("\r\n");
}

/** Sends one plain-text mail; rejects when the server cannot be reached or does not accept it. */
export function sendMail(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => socket.destroy(new Error("SMTP timed out")));
    const script: Array<{ send: string | null; expect: string }> = [
      { send: null, expect: "220" },
      { send: "EHLO fernsquare", expect: "250" },
      { send: `MAIL FROM:<${address(config.smtp.from)}>`, expect: "250" },
      { send: `RCPT TO:<${address(to)}>`, expect: "250" },
      { send: "DATA", expect: "354" },
      { send: `${composeMessage(to, subject, body)}\r\n.`, expect: "250" },
      { send: "QUIT", expect: "221" },
    ];
    let step = 0;
    let buffered = "";
    socket.on("error", reject);
    socket.on("close", () => (step >= script.length ? resolve() : reject(new Error("SMTP closed early"))));
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\r\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 3 && line[3] === "-") continue;
        const current = script[step];
        if (!current || !line.startsWith(current.expect)) {
          socket.destroy(new Error(`SMTP refused: ${line}`));
          return;
        }
        step += 1;
        const next = script[step];
        if (next?.send) socket.write(`${next.send}\r\n`);
        else if (!next) socket.end();
      }
    });
  });
}
