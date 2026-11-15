import type { IncomingMessage, ServerResponse } from "node:http";
import type { User } from "../shared/types.js";
import { SESSION_COOKIE, userForSession } from "./accounts.js";
import { transaction, type Tx } from "./db.js";
import { validation } from "./errors.js";
import { claimInside, remember, type Claim } from "./idempotency.js";

export interface Reply {
  status: number;
  body?: unknown;
  raw?: string | Buffer;
  type?: string;
  headers?: Record<string, string | string[]>;
}

export const STREAMED = Symbol("streamed");

export class Ctx {
  viewer: User | null = null;
  private resolved = false;
  claim: Claim | null = null;
  verification: "sent" | "pending" | null = null;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly url: URL,
    readonly params: Record<string, string>,
    readonly rawBody: Buffer,
  ) {}

  get query(): URLSearchParams {
    return this.url.searchParams;
  }

  get sessionToken(): string | undefined {
    for (const part of (this.header("cookie") ?? "").split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === SESSION_COOKIE) return rest.join("=");
    }
    return undefined;
  }

  /** Reads the session once; routes that may not need the viewer (renders of plain files) ask for it only when they do. */
  async resolveViewer(): Promise<User | null> {
    if (!this.resolved) {
      const token = this.sessionToken;
      const session = token === undefined ? null : await userForSession(token);
      this.viewer = session?.user ?? null;
      this.verification = session?.verification ?? null;
      this.resolved = true;
    }
    return this.viewer;
  }

  header(name: string): string | undefined {
    const value = this.req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  parsedBody(): unknown {
    if (this.rawBody.length === 0) return {};
    try {
      return JSON.parse(this.rawBody.toString("utf8")) as unknown;
    } catch {
      return this.rawBody.toString("utf8");
    }
  }

  body(): Record<string, unknown> {
    const parsed = this.parsedBody();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw validation({ body: "Send a JSON object." });
    }
    return parsed as Record<string, unknown>;
  }

  effect(penId: string | null, work: (tx: Tx) => Promise<Reply>): Promise<Reply> {
    const claim = this.claim;
    return transaction(async (tx) => {
      if (claim) {
        const replay = await claimInside(tx, claim, penId);
        if (replay) return { status: replay.status, raw: replay.response, type: "application/json; charset=utf-8" };
      }
      const reply = await work(tx);
      if (claim) await remember(tx, claim, reply.status, JSON.stringify(reply.body));
      return reply;
    });
  }
}
