import { AppCtx } from "./ctx.js";

/** A next value is used only when it starts with one slash not followed by another / or \. */
export function safeNext(next: string): string {
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) return next;
  return "/";
}

/** Text lengths count grapheme segments of the NFC-normalised form. */
export function graphemeLength(s: string): number {
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  let n = 0;
  for (const _ of seg.segment(s.normalize("NFC"))) n++;
  return n;
}

export function nfc(s: string): string {
  return s.normalize("NFC");
}

/** Send a plain-text mail through Mailpit's SMTP. */
export async function sendMail(ctx: AppCtx, to: string, subject: string, body: string): Promise<void> {
  const { createConnection } = await import("node:net");
  const from = ctx.config.mailFrom;
  const fromAddr = /<(.*)>/.exec(from)?.[1] ?? from;
  const message = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, "", body].join("\r\n");
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: ctx.config.smtp.host, port: ctx.config.smtp.port });
    let stage = 0;
    let buffer = "";
    const bodyLines = message.split("\r\n");
    let i = 0;
    socket.setEncoding("utf8");
    socket.on("connect", () => { /* server greets first */ });
    socket.on("data", (d: string) => {
      buffer += d;
      if (!buffer.includes("\r\n")) return;
      buffer = "";
      stage++;
      if (stage === 1) socket.write("HELO tinework\r\n");
      else if (stage === 2) socket.write(`MAIL FROM:<${fromAddr}>\r\n`);
      else if (stage === 3) socket.write(`RCPT TO:<${to}>\r\n`);
      else if (stage === 4) socket.write("DATA\r\n");
      else if (stage === 5) {
        for (;;) {
          if (i >= bodyLines.length) { socket.write(".\r\n"); break; }
          const line = bodyLines[i]!;
          i++;
          socket.write(line.replace(/^(\.)/, "..") + "\r\n");
        }
      } else if (stage === 6) socket.write("QUIT\r\n");
      else { socket.end(); resolve(); }
    });
    socket.on("error", reject);
    socket.setTimeout(10_000, () => { socket.destroy(); reject(new Error("SMTP timeout")); });
  });
}
