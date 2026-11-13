import net from "node:net";
import { smtp, mailFrom, appOrigin } from "./config.ts";
import { logger } from "./logger.ts";

const CRLF = "\r\n";

export type MailMessage = { to: string; subject: string; text: string };

function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match?.[1] ?? from;
}

/** Sends one message and resolves true only after the server accepts it. */
export function sendMail(message: MailMessage): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: smtp.host, port: smtp.port });
    socket.setTimeout(10_000);
    let buffer = "";
    let stage = 0;
    let finished = false;
    const dialog: { expect: number; send?: string }[] = [
      { expect: 220 },
      { expect: 250, send: `EHLO brackenpad${CRLF}` },
      { expect: 250, send: `MAIL FROM:<${extractAddress(mailFrom)}>${CRLF}` },
      { expect: 250, send: `RCPT TO:<${message.to}>${CRLF}` },
      { expect: 354, send: `DATA${CRLF}` },
      { expect: 250 },
    ];
    const body = [
      `From: ${mailFrom}`,
      `To: ${message.to}`,
      `Subject: ${message.subject.replace(/[\r\n]/g, " ")}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      message.text.replace(/\r?\n/g, CRLF),
      ".",
      "",
    ].join(CRLF);
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(ok);
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(CRLF);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!/^\d{3}[ -]/.test(line)) continue;
        const step = dialog[stage];
        if (step === undefined) continue;
        const code = Number(line.slice(0, 3));
        if (line.charCodeAt(3) !== 32) continue;
        if (code !== step.expect) {
          finish(false);
          return;
        }
        if (stage === 4) {
          socket.write(body);
          stage += 1;
          continue;
        }
        if (stage === 5) {
          socket.write(`QUIT${CRLF}`);
          finish(true);
          return;
        }
        stage += 1;
        const next = dialog[stage];
        if (next?.send !== undefined) socket.write(next.send);
      }
    });
    socket.on("error", (err) => {
      logger.warn(`smtp: ${err.message}`);
      finish(false);
    });
    socket.on("timeout", () => {
      logger.warn("smtp: timeout");
      finish(false);
    });
  });
}

export function verificationMail(to: string, token: string): MailMessage {
  return {
    to,
    subject: "Verify your Brackenpad email",
    text: `Welcome to Brackenpad.\n\nConfirm your email address by opening this link:\n${appOrigin}/verify/${token}\n`,
  };
}

export function invitationMail(to: string, ownerName: string, title: string, role: string, token: string): MailMessage {
  return {
    to,
    subject: `${ownerName} shared “${title}” with you`,
    text: `${ownerName} shared the notebook “${title}” with you as ${role}.\n\nOpen it here:\n${appOrigin}/invite/${token}\n`,
  };
}
