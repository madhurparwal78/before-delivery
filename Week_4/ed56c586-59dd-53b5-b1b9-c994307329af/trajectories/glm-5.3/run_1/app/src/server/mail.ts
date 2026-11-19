/**
 * Minimal SMTP client for the single outgoing enquiry email per accepted
 * request. Connects again for every send, so a returned mail server needs no
 * restart. Plain SMTP, no authentication, as the studio's mail server requires.
 */
import { connect, type Socket } from "node:net";

export type Mail = {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  body: string;
};

export type SmtpConfig = {
  host: string;
  port: number;
  timeoutSeconds: number;
};

type Reply = { code: number; text: string };

class SmtpSession {
  private readonly socket: Socket;
  private buffer = "";
  private pending: { code: number; lines: string[] } | null = null;
  private waiter: ((reply: Reply) => void) | null = null;
  private readonly abandon: (error: Error) => void;

  private constructor(socket: Socket, abandon: (error: Error) => void) {
    this.socket = socket;
    this.abandon = abandon;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.receive(chunk));
  }

  /** Feeds the socket one reply at a time; SMTP replies may be multiline. */
  private receive(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd === -1) return;
      const line = this.buffer.slice(0, lineEnd).replace(/\r$/, "");
      this.buffer = this.buffer.slice(lineEnd + 1);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) continue;
      const code = Number(match[1]);
      if (match[2] === "-") {
        this.pending = { code, lines: [...(this.pending?.lines ?? []), match[3]] };
        continue;
      }
      const reply: Reply = {
        code,
        text: [...(this.pending?.lines ?? []), match[3]].join(" ").trim(),
      };
      this.pending = null;
      const waiter = this.waiter;
      this.waiter = null;
      waiter?.(reply);
    }
  }

  private command(line: string): Promise<Reply> {
    return new Promise((resolve, reject) => {
      this.waiter = (reply) => {
        if (reply.code < 400) resolve(reply);
        else reject(new Error(`mail refused: ${reply.code} ${reply.text}`));
      };
      this.socket.write(`${line}\r\n`, (error) => {
        if (error) reject(error);
      });
    });
  }

  static open(config: SmtpConfig): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = connect(config.port, config.host);
      socket.setTimeout(config.timeoutSeconds * 1000);
      let settled = false;
      const settle = (error: Error | null, session?: SmtpSession): void => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(session as SmtpSession);
      };
      const session = new SmtpSession(socket, (error: Error) => settle(error));
      session.waiter = (reply) => {
        if (reply.code < 400) settle(null, session);
        else settle(new Error(`mail refused: ${reply.code}`));
      };
      socket.on("timeout", () => {
        socket.destroy();
        settle(new Error("mail timeout"));
      });
      socket.on("error", (error: Error) => {
        session.abandon(error);
        settle(error);
      });
      socket.on("close", () => settle(new Error("mail closed")));
    });
  }

  async ehlo(): Promise<void> {
    await this.command("EHLO quillfern.works");
  }

  async mailFrom(address: string): Promise<void> {
    await this.command(`MAIL FROM:<${address}>`);
  }

  async rcptTo(address: string): Promise<void> {
    await this.command(`RCPT TO:<${address}>`);
  }

  async data(): Promise<void> {
    await this.command("DATA");
  }

  async message(headers: string[], body: string): Promise<void> {
    const text = [...headers, "", body].join("\r\n");
    const stuffed = text
      .split("\r\n")
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    await this.command(`${stuffed}\r\n.`);
  }

  quit(): void {
    this.socket.write("QUIT\r\n");
    this.socket.end();
  }
}

/** RFC 2047 encoded-word for header text outside plain ASCII. */
function encodeHeaderWord(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const encoded = Buffer.from(text, "utf8").toString("base64");
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += 60) chunks.push(encoded.slice(i, i + 60));
  return chunks.map((chunk) => `=?utf-8?B?${chunk}?=`).join("\r\n ");
}

/** Mailbox form of a header value: `Display Name <address>`. */
function mailbox(display: string, address: string): string {
  const safeDisplay = display.replace(/[\r\n]+/g, " ").trim();
  if (!safeDisplay) return address;
  if (/^[\x20-\x7e]*$/.test(safeDisplay) && !/[<>"]/.test(safeDisplay)) {
    return `${safeDisplay} <${address}>`;
  }
  return `${encodeHeaderWord(safeDisplay)} <${address}>`;
}

/** The bare address from a `Display Name <address>` form. */
function bareAddress(value: string): string {
  const match = /<([^>]*)>/.exec(value);
  return match ? match[1] : value.trim();
}

/**
 * Send exactly one email. Answers only after the mail server accepted it.
 * Throws when the server cannot be reached or refuses within the timeout.
 */
export async function sendMail(config: SmtpConfig, mail: Mail): Promise<void> {
  const session = await SmtpSession.open(config);
  try {
    await session.ehlo();
    await session.mailFrom(bareAddress(mail.from));
    await session.rcptTo(mail.to);
    await session.data();
    const fromHeader = mailbox(mail.from.replace(/\s*<[^>]*>\s*$/, ""), bareAddress(mail.from));
    await session.message(
      [
        `From: ${fromHeader}`,
        `To: ${mail.to}`,
        `Reply-To: ${bareAddress(mail.replyTo)}`,
        `Subject: ${encodeHeaderWord(mail.subject)}`,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "MIME-Version: 1.0",
      ],
      mail.body
    );
  } finally {
    session.quit();
  }
}
