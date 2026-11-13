import net from "node:net";

export type MailKind = "verification" | "reset";

const FROM = "Pratfall Cup <no-reply@wobblewell.test>";
const SUBJECTS: Record<MailKind, string> = {
  verification: "Verify your Pratfall Cup email",
  reset: "Reset your Pratfall Cup password"
};
const EXPIRY_LINE = "This link expires in 30 minutes.";

export type SmtpClient = {
  send: (kind: MailKind, to: string, link: string) => Promise<void>;
  close: () => void;
};

export function connectSmtp(host: string, port: number, timeoutMs = 4500): Promise<SmtpClient> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    const fail = (e: Error) => {
      socket.destroy();
      reject(e);
    };
    socket.once("error", fail);
    socket.once("timeout", () => fail(new Error("smtp timeout")));
    socket.once("connect", () => resolve(createClient(socket)));
  });
}

function createClient(socket: net.Socket): SmtpClient {
  const pending: Array<(line: string) => void> = [];
  let buffer = "";
  let closed = false;

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const waiter = pending.shift();
      if (waiter) waiter(line);
    }
  });
  socket.once("close", () => {
    closed = true;
    while (pending.length) {
      const waiter = pending.shift();
      if (waiter) waiter("");
    }
  });
  socket.once("error", () => {
    closed = true;
    while (pending.length) {
      const waiter = pending.shift();
      if (waiter) waiter("");
    }
  });

  const readReply = (): Promise<string> =>
    new Promise((resolve) => {
      if (closed) {
        resolve("");
        return;
      }
      pending.push(resolve);
    });

  const write = (line: string) =>
    new Promise<void>((resolve) => {
      socket.write(line + "\r\n", () => resolve());
    });

  const expect = async (code: number) => {
    const line = await readReply();
    if (!line.startsWith(String(code))) throw new Error(`smtp unexpected reply: ${line}`);
  };

  const send = async (kind: MailKind, to: string, link: string) => {
    await expect(220);
    await write(`EHLO pratfall-cup`);
    await expect(250);
    await write(`MAIL FROM:<no-reply@wobblewell.test>`);
    await expect(250);
    await write(`RCPT TO:<${to}>`);
    await expect(250);
    await write(`DATA`);
    await expect(354);
    const body = [link, EXPIRY_LINE].join("\n");
    const headers = [
      `From: ${FROM}`,
      `To: <${to}>`,
      `Subject: ${SUBJECTS[kind]}`,
      "Content-Type: text/plain; charset=utf-8",
      `Date: ${new Date().toUTCString()}`
    ];
    const lines = [...headers, "", body.replace(/^\./gm, "..")].join("\r\n");
    await write(`${lines}\r\n.`);
    await expect(250);
    await write(`RSET`);
    await readReply();
  };

  const close = () => {
    closed = true;
    socket.end();
    socket.destroy();
  };

  return { send, close };
}

/** Opens a fresh SMTP connection per send, deciding unreachability within 5 seconds. */
export async function sendMail(
  host: string,
  port: number,
  kind: MailKind,
  to: string,
  link: string
): Promise<void> {
  const client = await connectSmtp(host, port);
  try {
    await client.send(kind, to, link);
  } finally {
    client.close();
  }
}


