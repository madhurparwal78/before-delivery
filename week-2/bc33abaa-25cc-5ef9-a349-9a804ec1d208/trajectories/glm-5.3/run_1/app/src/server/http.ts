import type { Request, Response, NextFunction, RequestHandler } from "express";
import { resolveCaller, type Caller, type Role } from "./auth";
import { query } from "./db";

declare global {
  namespace Express {
    interface Request {
      caller?: Caller;
      cookies?: Record<string, string>;
      body: unknown;
      rawBody?: Buffer;
      file?: { originalname: string; buffer: Buffer; mimetype: string };
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
    public headers: Record<string, string> = {},
  ) {
    super(typeof body.error === "string" ? body.error : "http_error");
  }
}

export const errors = {
  unauthenticated(): HttpError {
    return new HttpError(401, { error: "unauthenticated" });
  },
  forbidden(): HttpError {
    return new HttpError(403, { error: "forbidden" });
  },
  crossOrigin(): HttpError {
    return new HttpError(403, { error: "cross_origin" });
  },
  notFound(): HttpError {
    return new HttpError(404, { error: "not_found" });
  },
  gone(): HttpError {
    return new HttpError(410, { error: "gone" });
  },
  readOnly(): HttpError {
    return new HttpError(402, { error: "workspace_read_only" });
  },
  cardDeclined(): HttpError {
    return new HttpError(402, { error: "card_declined" });
  },
  conflict(code: string, extra: Record<string, unknown> = {}): HttpError {
    return new HttpError(409, { error: code, ...extra });
  },
  payloadTooLarge(limitBytes: number): HttpError {
    return new HttpError(413, { error: "payload_too_large", limitBytes });
  },
  fileTooLarge(limitBytes: number): HttpError {
    return new HttpError(413, { error: "file_too_large", limitBytes });
  },
  unsupportedType(): HttpError {
    return new HttpError(415, { error: "unsupported_type" });
  },
  validation(fields: Record<string, string>): HttpError {
    return new HttpError(422, { errors: fields });
  },
  serviceUnavailable(service: "billing" | "file_storage"): HttpError {
    return new HttpError(503, { error: "service_unavailable", service });
  },
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    res.status(err.status).json(err.body);
    return;
  }
  console.error("[orrery] unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const caller = await resolveCaller(req);
    if (!caller) throw errors.unauthenticated();
    req.caller = caller;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const caller = req.caller;
    if (!caller) return next(errors.forbidden());
    if (caller.kind === "agent") return next(errors.forbidden());
    if (!roles.includes(caller.member.role)) return next(errors.forbidden());
    next();
  };
}

export function requireMemberLike(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const caller = req.caller;
    if (!caller || caller.kind !== "member") return next(errors.forbidden());
    if (!roles.includes(caller.member.role)) return next(errors.forbidden());
    next();
  };
}

export function requireAgentScope(...scopes: Array<"read" | "edit">): RequestHandler {
  return (req, _res, next) => {
    const caller = req.caller;
    if (!caller || caller.kind !== "agent") return next(errors.forbidden());
    if (!scopes.includes(caller.token.scope)) return next(errors.forbidden());
    next();
  };
}

const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, billing_manager: 3, admin: 4, owner: 5 };

export function canEditScene(caller: Caller): boolean {
  if (caller.kind === "agent") return caller.token.scope === "edit";
  if (caller.kind === "member") return caller.member.role === "owner" || caller.member.role === "editor";
  return false;
}

export async function seatsUsed(workspaceId: string): Promise<number> {
  const res = await query(
    `SELECT
      (SELECT count(*) FROM members WHERE workspace_id = $1 AND removed_at IS NULL) +
      (SELECT count(*) FROM invites WHERE workspace_id = $1 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > now()) AS used`,
    [workspaceId],
  );
  return Number((res.rows[0] as { used: string }).used);
}

export async function seatsPurchased(workspaceId: string): Promise<number> {
  const res = await query("SELECT seats_purchased FROM subscriptions WHERE workspace_id = $1", [workspaceId]);
  const row = res.rows[0] as { seats_purchased: number } | undefined;
  return row?.seats_purchased ?? 8;
}

export async function subscriptionState(workspaceId: string): Promise<string> {
  const res = await query("SELECT state FROM subscriptions WHERE workspace_id = $1", [workspaceId]);
  const row = res.rows[0] as { state: string } | undefined;
  return row?.state ?? "trial";
}

export function isReadOnly(state: string): boolean {
  return state === "suspended" || state === "cancelled";
}

export async function assertNotReadOnly(workspaceId: string): Promise<void> {
  const state = await subscriptionState(workspaceId);
  if (isReadOnly(state)) throw errors.readOnly();
}

export function requireWorkspaceWrite(): RequestHandler {
  return async (req, _res, next) => {
    try {
      const caller = req.caller;
      if (!caller) return next(errors.unauthenticated());
      const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
      await assertNotReadOnly(ws);
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function formatDate(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(d);
}

export function formatDateTime(d: Date, timeZone: string): string {
  const date = formatDate(d, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
  return `${date} ${time} (${timeZone})`;
}

export function formatTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}

export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
