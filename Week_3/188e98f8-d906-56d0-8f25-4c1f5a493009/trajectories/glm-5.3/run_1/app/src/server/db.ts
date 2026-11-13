import type { Pool } from "pg";

export interface RoundRow {
  readonly number: number;
  readonly title: string;
  readonly kind: "standard" | "picture";
  readonly status: "drafted" | "open" | "closed" | "marked" | "published";
  readonly opened_at: Date | null;
  readonly closes_at: Date | null;
  readonly closed_at: Date | null;
}

export interface SheetRow {
  readonly round: number;
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly content_type: string;
}

export interface AnswerRow {
  readonly id: number;
  readonly round: number;
  readonly team_id: number;
  readonly team_name: string;
  readonly question: number;
  readonly text: string;
  readonly submitted_at: Date;
  readonly current: boolean;
  readonly mark: number | null;
  readonly ruled: number | null;
}

export interface DisputeRow {
  readonly id: number;
  readonly answer_id: number;
  readonly team_id: number;
  readonly round: number;
  readonly question: number;
  readonly answer_text: string;
  readonly reason: string;
  readonly status: "raised" | "upheld" | "dismissed";
  readonly raised_at: Date;
  readonly ruled_at: Date | null;
  readonly note: "queued" | "sent" | null;
}

export interface TeamRow {
  readonly id: number;
  readonly name: string;
  readonly total: number;
}

export interface SessionRow {
  readonly role: "quizmaster" | "marker" | "captain";
  readonly team_id: number | null;
  readonly team_name: string | null;
}

export interface QueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount: number;
}

export interface DbClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult<Record<string, unknown>>>;
  release(): void;
}

export interface DbStore {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult<Record<string, unknown>>>;
  connect(): Promise<DbClient>;
}

export function poolStore(pool: Pool): DbStore {
  return {
    async query(text: string, values?: readonly unknown[]) {
      const args = values === undefined ? [] : [...values];
      const result = await pool.query(text, args);
      return { rows: result.rows as unknown as readonly Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    },
    async connect() {
      const client = await pool.connect();
      return {
        async query(text: string, values?: readonly unknown[]) {
          const args = values === undefined ? [] : [...values];
          const result = await client.query(text, args);
          return { rows: result.rows as unknown as readonly Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
        },
        release: () => client.release(),
      };
    },
  };
}
