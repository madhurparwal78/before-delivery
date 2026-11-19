import * as net from "net";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { formatEuro } from "./routes/orders.js";

interface OutboxRow {
  id: number;
  order_id: string;
  to_email: string;
  subject: string;
  body: string;
  attempts: number;
}

export class Mailer {
  private readonly cfg: Config;
  private workerTimer: NodeJS.Timeout | null = null;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  startOutboxWorker(db: Database): void {
    const tick = async (): Promise<void> => {
      const rows = await db.withClient(async (client) => {
        const claimed = await client.query<OutboxRow>(
          `UPDATE mail_outbox SET attempts = attempts + 1, last_error = NULL
            WHERE id IN (
              SELECT id FROM mail_outbox WHERE sent_at IS NULL AND attempts < 10
              ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED
            )
            RETURNING id, order_id, to_email, subject, body, attempts`,
          [],
        );
        return claimed.rows;
      });
      for (const row of rows) {
        try {
          await this.send(row);
          await db.withClient(async (client) => {
            await client.query("UPDATE mail_outbox SET sent_at = now() WHERE id = $1", [row.id]);
          });
        } catch (err) {
          await db.withClient(async (client) => {
            await client.query("UPDATE mail_outbox SET last_error = $2 WHERE id = $1", [row.id, String(err)]);
          });
        }
      }
    };
    const run = (): void => {
      void tick().catch((err) => {
        console.error("mail worker error", err);
      });
    };
    run();
    this.workerTimer = setInterval(run, 30_000);
    this.workerTimer.unref();
  }

  private async send(row: OutboxRow): Promise<void> {
    const host = this.cfg.smtp_host;
    const port = this.cfg.smtp_port;
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        const from = extractAddress(this.cfg.mail_from);
        const lines = [
          `From: ${this.cfg.mail_from}`,
          `To: ${row.to_email}`,
          `Subject: ${row.subject}`,
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="utf-8"',
          "",
          row.body,
          "",
        ];
        const message = `MAIL FROM:<${from}>\r\nRCPT TO:<${row.to_email}>\r\nDATA\r\n${lines.join("\r\n")}\r\n.\r\nQUIT\r\n`;
        socket.write(message);
        socket.on("data", (chunk) => {
          void chunk;
        });
        socket.end();
        resolve();
      });
      socket.setTimeout(10_000, () => {
        socket.destroy();
        reject(new Error("smtp timeout"));
      });
      socket.on("error", (err) => {
        reject(err);
      });
    });
  }
}

function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

export { formatEuro };
