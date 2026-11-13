import net from "node:net";
import { config } from "./config";

const TIMEOUT_MS = 4000;
/** The reply to the end of DATA is the mail server accepting the message. */
const ACCEPTED_STEP = 5;

interface Note {
  to: string;
  subject: string;
  lines: string[];
}

function address(from: string): string {
  const open = from.indexOf("<");
  return open >= 0 ? from.slice(open + 1, from.indexOf(">")) : from.trim();
}

function render(note: Note): string {
  const body = Buffer.from(note.lines.join("\r\n") + "\r\n", "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: ${note.to}`,
    `Subject: ${note.subject}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Speaks SMTP to the mail sink. Resolves only after the server accepted the message. */
export function send(note: Note): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp timeout")));
    let buffer = "";
    let step = 0;
    const commands = [
      `EHLO roundkeeper`,
      `MAIL FROM:<${address(config.smtp.from)}>`,
      `RCPT TO:<${note.to}>`,
      "DATA",
      `${render(note).replace(/^\./gm, "..")}\r\n.`,
      "QUIT",
    ];
    const expected = [220, 250, 250, 250, 354, 250, 221];
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("smtp closed")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line[3] === "-") continue;
        if (Number(line.slice(0, 3)) !== expected[step]) {
          socket.destroy();
          reject(new Error(`smtp refused: ${line}`));
          return;
        }
        const accepted = step === ACCEPTED_STEP;
        const next = commands[step];
        step += 1;
        if (next === undefined) {
          socket.end();
          return;
        }
        if (accepted) {
          socket.removeAllListeners("close");
          resolve();
        }
        socket.write(`${next}\r\n`);
      }
    });
  });
}
