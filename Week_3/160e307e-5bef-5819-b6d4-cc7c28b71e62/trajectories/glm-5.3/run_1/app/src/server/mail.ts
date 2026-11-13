import net from "node:net";

/**
 * A minimal SMTP client that reports whether the server accepted the message.
 * A send counts only when the server answers the final dot with 250.
 */
export async function sendMail(
  host: string,
  port: number,
  from: string,
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 4000 });
    let accepted = false;
    let buffer = "";
    let stage = 0;
    const finish = (ok: boolean) => {
      try {
        socket.destroy();
      } catch {
        // already closed
      }
      resolve(ok);
    };
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("close", () => resolve(accepted));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.endsWith("\r\n")) return;
      const code = Number.parseInt(buffer.slice(0, 3), 10);
      buffer = "";
      switch (stage) {
        case 0:
          if (code !== 220) return finish(false);
          stage = 1;
          socket.write("EHLO duecoin.test\r\n");
          return;
        case 1:
          if (code !== 250) return finish(false);
          stage = 2;
          socket.write(`MAIL FROM:<${extractAddress(from)}>\r\n`);
          return;
        case 2:
          if (code !== 250) return finish(false);
          stage = 3;
          socket.write(`RCPT TO:<${to}>\r\n`);
          return;
        case 3:
          if (code !== 250) return finish(false);
          stage = 4;
          socket.write("DATA\r\n");
          return;
        case 4:
          if (code !== 354) return finish(false);
          stage = 5;
          socket.write(
            [
              `From: ${from}`,
              `To: ${to}`,
              `Subject: ${subject}`,
              "Content-Type: text/plain; charset=utf-8",
              "",
              body,
            ].join("\r\n") + "\r\n.\r\n"
          );
          return;
        default:
          accepted = code === 250;
          finish(accepted);
      }
    });
  });
}

function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match !== null ? match[1] : from;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
