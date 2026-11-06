/** A minimal SMTP client for the provided mail server: no authentication,
 *  no TLS. One connection per message. */

import net from "node:net";
import { config } from "./config.js";

type SmtpResult = { ok: boolean; error?: string };

function readReply(socket: net.Socket): Promise<{ lines: string[] }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\r\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        lines.push(line);
        // A reply finishes with a space after the code; hyphens continue.
        if (/^\d{3} /.test(line)) {
          socket.off("data", onData);
          socket.off("error", onError);
          resolve({ lines });
          return;
        }
        newline = buffer.indexOf("\r\n");
      }
    };
    const onError = (err: Error): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      reject(err);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(socket: net.Socket, line: string): Promise<string> {
  socket.write(`${line}\r\n`);
  const reply = await readReply(socket);
  const last = reply.lines[reply.lines.length - 1] ?? "";
  if (!/^[23]\d{2}/.test(last)) {
    throw new Error(`SMTP refused ${line.split(" ")[0]}: ${last}`);
  }
  return last;
}

/** Sends one plain-text message. Resolves to ok=false when mail is unreachable. */
export function sendMail(to: string, subject: string, body: string): Promise<SmtpResult> {
  return new Promise<SmtpResult>((resolve) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10000);
    let settled = false;
    const finish = (result: SmtpResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.on("timeout", () => finish({ ok: false, error: "timeout" }));
    socket.on("error", (err) => finish({ ok: false, error: err.message }));
    void (async () => {
      try {
        await readReply(socket);
        await command(socket, `EHLO snaglight.local`);
        const from = extractAddress(config.mailFrom);
        await command(socket, `MAIL FROM:<${from}>`);
        await command(socket, `RCPT TO:<${to}>`);
        await command(socket, `DATA`);
        const message = [
          `From: ${config.mailFrom}`,
          `To: <${to}>`,
          `Subject: ${subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          "",
          body.replace(/^\./gm, ".."),
          ".",
        ].join("\r\n");
        socket.write(message + "\r\n");
        const done = await readReply(socket);
        if (!/^2\d{2}/.test(done.lines[done.lines.length - 1] ?? "")) {
          finish({ ok: false, error: "message refused" });
          return;
        }
        socket.write("QUIT\r\n");
        finish({ ok: true });
      } catch (e) {
        finish({ ok: false, error: (e as Error).message });
      }
    })();
  });
}

function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match === null ? from : match[1]!;
}
