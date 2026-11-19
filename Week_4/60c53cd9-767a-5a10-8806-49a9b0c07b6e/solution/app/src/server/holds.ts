/** Holds: placing (with attempt limits and idempotent replay), reading, releasing and sharing. All rules are decided in Postgres. */
import { randomBytes } from "node:crypto";
import type { PublicHold, SharedUnit } from "../shared/api-types.js";
import { FIELD_MESSAGES, holdAttemptsMessage, holdCooldownMessage } from "../shared/copy.js";
import { formatOfficeTime } from "../shared/office-time.js";
import type { AccountRow } from "./accounts.js";
import type { AppClock } from "./clock.js";
import type { Config } from "./config.js";
import type { Database, Tx } from "./db.js";
import { ApiError } from "./errors.js";
import type { Indexer } from "./indexer.js";
import { integerLiteral, type ParsedBody } from "./json.js";
import { lapseExpired } from "./lapse.js";
import type { MediaSigner } from "./media.js";
import { endHold, lapseAndNotify, lockUnit, startHold, withActiveHold, type HoldRow } from "./transitions.js";
import { UNIT_SELECT, isVisible, statusOf, toSharedUnit, type UnitRow } from "./units.js";

export const toPublicHold = (row: HoldRow): PublicHold => ({
  id: row.id,
  unitCode: row.unit_code,
  status: row.status,
  endedBy: row.ended_by,
  quotedPrice: row.quoted_price,
  priceVersion: row.price_version,
  createdAt: row.created_at.toISOString(),
  endsAt: row.ends_at.toISOString(),
  endedAt: row.ended_at === null ? null : row.ended_at.toISOString(),
  shareUrl: row.share_token === null ? null : `/shared/${row.share_token}`,
});

interface Reply {
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (text: string): boolean => UUID.test(text);

const MAX_ATTEMPTS = 3;
const VISIBLE_ASCII = /^[\x21-\x7e]{1,100}$/;

const errorReply = (error: ApiError): Reply => ({ status: error.status, body: error.body() });

export class Holds {
  constructor(
    private readonly db: Database,
    private readonly clock: AppClock,
    private readonly config: Config,
    private readonly indexer: Indexer,
    private readonly media: MediaSigner,
  ) {}

  /** POST /api/holds, steps 4 to 9 of the error order, inside one transaction serialised on the account. */
  async place(account: AccountRow, keyHeader: string | undefined, body: ParsedBody | null): Promise<Reply> {
    const request = JSON.stringify([body?.raw.get("unitCode") ?? null, body?.raw.get("priceVersion") ?? null]);
    const storedKey = keyHeader !== undefined && VISIBLE_ASCII.test(keyHeader) ? keyHeader : null;
    const reply = await this.db.tx<Reply>(async (tx) => {
      await tx.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [account.id]);
      const now = this.clock.now();
      await lapseExpired(tx, now);
      if (storedKey !== null) {
        const stored = await tx.query<{ request: string; response_status: number; response_body: string }>(
          "SELECT request, response_status, response_body FROM idempotency_keys WHERE account_id = $1 AND key = $2",
          [account.id, storedKey],
        );
        const first = stored.rows[0];
        if (first) {
          if (first.request === request) return { status: first.response_status, body: JSON.parse(first.response_body) as unknown };
          return errorReply(new ApiError("idempotency_key_reused"));
        }
      }
      const windowMs = this.config.holdAttemptWindowSeconds * 1000;
      const counted = await tx.query<{ at: Date }>(
        "SELECT at FROM hold_attempts WHERE account_id = $1 AND at > $2 ORDER BY at",
        [account.id, this.clock.plusSeconds(now, -this.config.holdAttemptWindowSeconds)],
      );
      if (counted.rows.length >= MAX_ATTEMPTS) {
        const oldest = (counted.rows[counted.rows.length - MAX_ATTEMPTS] as { at: Date }).at;
        const seconds = Math.max(1, Math.ceil((oldest.getTime() + windowMs - now.getTime()) / 1000));
        return {
          ...errorReply(new ApiError("hold_attempts", holdAttemptsMessage(seconds), { retryAfterSeconds: seconds })),
          retryAfterSeconds: seconds,
        };
      }
      await tx.query("INSERT INTO hold_attempts (account_id, at) VALUES ($1, $2)", [account.id, now]);
      const outcome = await this.decide(tx, account, keyHeader, storedKey !== null, body, now);
      if (storedKey !== null) {
        await tx.query(
          `INSERT INTO idempotency_keys (account_id, key, request, response_status, response_body, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [account.id, storedKey, request, outcome.status, JSON.stringify(outcome.body), now],
        );
      }
      return outcome;
    });
    void this.indexer.tick();
    return reply;
  }

  /** Steps 6 to 9: role, visibility, validation, then the state conflicts in their published order. */
  private async decide(
    tx: Tx,
    account: AccountRow,
    keyHeader: string | undefined,
    keyIsValid: boolean,
    body: ParsedBody | null,
    now: Date,
  ): Promise<Reply> {
    if (account.role !== "buyer") return errorReply(new ApiError("forbidden"));
    const unitCode = body?.value["unitCode"];
    if (typeof unitCode === "string") {
      const found = await tx.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = $1`, [unitCode]);
      const visible = found.rows[0];
      if (!visible || !isVisible(visible)) return errorReply(new ApiError("not_found"));
    }
    const priceVersion = integerLiteral(body?.raw.get("priceVersion"));
    const fields: Record<string, string> = {};
    if (typeof unitCode !== "string") fields["unitCode"] = FIELD_MESSAGES.unitCode;
    if (priceVersion === null || priceVersion < 1) fields["priceVersion"] = FIELD_MESSAGES.priceVersion;
    if (keyHeader !== undefined && !keyIsValid) fields["idempotencyKey"] = FIELD_MESSAGES.idempotencyKey;
    if (typeof unitCode !== "string" || priceVersion === null || Object.keys(fields).length > 0) {
      return errorReply(new ApiError("invalid", undefined, { fields }));
    }
    await lockUnit(tx, unitCode);
    await lapseExpired(tx, now);
    const locked = await tx.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = $1`, [unitCode]);
    const unit = locked.rows[0];
    if (!unit || !isVisible(unit)) return errorReply(new ApiError("not_found"));
    const mine = await tx.query("SELECT 1 FROM holds WHERE account_id = $1 AND status = 'active'", [account.id]);
    if (mine.rowCount !== 0) return errorReply(new ApiError("hold_limit"));
    const status = statusOf(unit);
    if (status === "reserved") return errorReply(new ApiError("unit_reserved"));
    if (status === "held") return errorReply(new ApiError("unit_unavailable"));
    const previous = await tx.query<{ ended_at: Date }>(
      `SELECT max(ended_at) AS ended_at FROM holds
        WHERE account_id = $1 AND unit_code = $2 AND ended_by IN ('buyer', 'lapse')`,
      [account.id, unitCode],
    );
    const lastEnd = previous.rows[0]?.ended_at ?? null;
    if (lastEnd !== null) {
      const until = this.clock.plusSeconds(lastEnd, this.config.holdCooldownSeconds);
      if (now.getTime() < until.getTime()) {
        return errorReply(new ApiError("hold_cooldown", holdCooldownMessage(formatOfficeTime(until, this.config.officeZone))));
      }
    }
    if (priceVersion !== unit.price_version) return errorReply(new ApiError("price_changed"));
    const created = await startHold(tx, unit, account.id, now, this.clock.plusSeconds(now, this.config.holdSeconds));
    return { status: 201, body: { hold: toPublicHold(created) } };
  }

  async list(account: AccountRow): Promise<PublicHold[]> {
    await lapseAndNotify(this.db, this.clock, this.indexer);
    const rows = await this.db.query<HoldRow>("SELECT * FROM holds WHERE account_id = $1 ORDER BY created_at DESC, id", [account.id]);
    return rows.rows.map(toPublicHold);
  }

  async get(account: AccountRow, id: string): Promise<PublicHold> {
    await lapseAndNotify(this.db, this.clock, this.indexer);
    const row = isUuid(id) ? (await this.db.query<HoldRow>("SELECT * FROM holds WHERE id = $1 AND account_id = $2", [id, account.id])).rows[0] : undefined;
    if (!row) throw new ApiError("not_found");
    return toPublicHold(row);
  }

  private async ownHold<T>(account: AccountRow, id: string, change: (tx: Tx, hold: HoldRow, now: Date) => Promise<T>): Promise<T> {
    if (!isUuid(id)) throw new ApiError("not_found");
    return withActiveHold(this.db, this.clock, this.indexer, id, account.id, change);
  }

  release(account: AccountRow, id: string): Promise<PublicHold> {
    return this.ownHold(account, id, async (tx, hold, now) =>
      toPublicHold(await endHold(tx, hold.id, hold.unit_code, "released", "buyer", now)),
    );
  }

  /** A fresh share token each call; the previous token stops resolving. */
  share(account: AccountRow, id: string): Promise<{ shareUrl: string }> {
    return this.ownHold(account, id, async (tx, hold) => {
      const token = randomBytes(32).toString("base64url");
      await tx.query("UPDATE holds SET share_token = $2 WHERE id = $1", [hold.id, token]);
      return { shareUrl: `/shared/${token}` };
    });
  }

  /** Revoking is idempotent: it answers the same whether or not a link exists or the hold has ended. */
  async unshare(account: AccountRow, id: string): Promise<void> {
    if (!isUuid(id)) throw new ApiError("not_found");
    const outcome = await this.db.tx<true | ApiError>(async (tx) => {
      const owned = await tx.query<HoldRow>("SELECT * FROM holds WHERE id = $1 AND account_id = $2", [id, account.id]);
      const hold = owned.rows[0];
      if (!hold) return new ApiError("not_found");
      await lockUnit(tx, hold.unit_code);
      await lapseExpired(tx, this.clock.now());
      await tx.query("UPDATE holds SET share_token = NULL WHERE id = $1", [id]);
      return true;
    });
    void this.indexer.tick();
    if (outcome instanceof ApiError) throw outcome;
  }

  /** The partner view: the shared unit and the end time, or null when the token no longer resolves. */
  async shared(token: string): Promise<{ unit: SharedUnit; endsAt: string } | null> {
    await lapseAndNotify(this.db, this.clock, this.indexer);
    const found = await this.db.query<HoldRow>("SELECT * FROM holds WHERE share_token = $1 AND status = 'active'", [token]);
    const hold = found.rows[0];
    if (!hold) return null;
    const unit = (await this.db.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = $1`, [hold.unit_code])).rows[0];
    if (!unit || unit.withdrawn) return null;
    return { unit: toSharedUnit(unit, this.media), endsAt: hold.ends_at.toISOString() };
  }
}
