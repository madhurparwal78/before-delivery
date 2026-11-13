import { connect as netConnect, type Socket } from "node:net";
import type { Pool } from "pg";
import type { NoteState } from "../domain/types";

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly from: string;
}

export interface RulingNote {
  readonly disputeId: number;
  readonly to: string;
  readonly round: number;
  readonly question: number;
  readonly title: string;
  readonly answerText: string;
  readonly ruling: "upheld" | "dismissed";
  readonly note: NoteState;
}

export function addressFrom(header: string): string {
  const start = header.lastIndexOf("<");
  const end = header.lastIndexOf(">");
  if (start >= 0 && end > start) return header.slice(start, end + 1);
  return `<${header}>`;
}

export function rulingNoteMessage(note: RulingNote, config: SmtpConfig): string {
  const rulingWord = note.ruling === "upheld" ? "Upheld" : "Dismissed";
  const body = [
    `Round ${note.round}: ${note.title}`,
    `Question: ${note.question}`,
    `Your answer: ${note.answerText}`,
    `Ruling: ${rulingWord}`,
  ].join("\r\n");
  return [
    `From: ${config.from}`,
    `To: ${note.to}`,
    `Subject: Ruling on round ${note.round}, question ${note.question}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    ``,
    body,
    ``,
  ].join("\r\n");
}

function readReply(socket: Socket): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const lines: string[] = [];
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        lines.push(line);
        if (line.length < 4 || line[3] !== "-") {
          socket.off("data", onData);
          socket.off("error", onError);
          const code = Number.parseInt(line.slice(0, 3), 10);
          if (code >= 400) reject(new Error(`smtp_refused_${code}`));
          else resolve(lines);
          return;
        }
      }
    };
    const onError = (error: Error): void => {
      socket.off("data", onData);
      reject(error);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

async function command(socket: Socket, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${line}\r\n`, (error) => (error ? reject(error) : resolve()));
  });
  await readReply(socket);
}

async function deliver(message: string, from: string, to: string, config: SmtpConfig): Promise<void> {
  const socket = netConnect({ host: config.host, port: config.port });
  socket.setEncoding("utf8");
  try {
    await waitConnected(socket);
    await readReply(socket);
    await command(socket, `EHLO roundkeeper`);
    await command(socket, `MAIL FROM:${from}`);
    await command(socket, `RCPT TO:${to}`);
    await command(socket, `DATA`);
    await new Promise<void>((resolve, reject) => {
      socket.write(`${message.replace(/\r\n\./g, "..")}\r\n.\r\n`, (error) => (error ? reject(error) : resolve()));
    });
    await readReply(socket);
    await command(socket, `QUIT`);
  } finally {
    socket.end();
    socket.destroy();
  }
}

function waitConnected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
}

export interface NoteQueueStore {
  pendingNotes(): Promise<RulingNote[]>;
  markNoteSent(disputeId: number): Promise<void>;
}

export function poolNoteStore(pool: Pool): NoteQueueStore {
  return {
    async pendingNotes(): Promise<RulingNote[]> {
      const result = await pool.query(
        `SELECT d.id, t.captain_email, d.round, d.question, r.title, d.answer_text,
                d.status AS ruling, d.note
           FROM disputes d
           JOIN teams t ON t.id = d.team_id
           JOIN rounds r ON r.number = d.round
          WHERE d.note = 'queued' AND d.status IN ('upheld', 'dismissed')
          ORDER BY d.id`,
      );
      return result.rows.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          disputeId: Number(record["id"]),
          to: String(record["captain_email"]),
          round: Number(record["round"]),
          question: Number(record["question"]),
          title: String(record["title"]),
          answerText: String(record["answer_text"]),
          ruling: record["ruling"] === "upheld" ? "upheld" : "dismissed",
          note: "queued",
        } satisfies RulingNote;
      });
    },
    async markNoteSent(disputeId: number): Promise<void> {
      await pool.query(`UPDATE disputes SET note = 'sent' WHERE id = $1`, [disputeId]);
    },
  };
}

/** The one ruling-note queue: each ruling sends exactly one note, retried until the mail server accepts it. */
export class NoteDelivery {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private store: NoteQueueStore, private config: SmtpConfig) {}

  start(): void {
    void this.drain();
    this.timer = setInterval(() => {
      void this.drain();
    }, 10_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.store.pendingNotes();
      for (const note of pending) {
        const message = rulingNoteMessage(note, this.config);
        await deliver(message, addressFrom(this.config.from), addressFrom(note.to), this.config);
        await this.store.markNoteSent(note.disputeId);
      }
    } catch {
      // The mail server is unreachable; the notes stay queued and the next pass tries again.
    } finally {
      this.running = false;
    }
  }
}
