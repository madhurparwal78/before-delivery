import { EDITION, plateOf } from "../shared/domain.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { fail } from "./http.js";
import { newToken } from "./ids.js";
import { nudge, salesOpen } from "./shelf.js";
import { grantHold, holdState, releaseHold, ValkeyUnreachable } from "./valkey.js";

/** Holds: one live token per box number in Valkey, ending on their own at their TTL. */

const HOLD_MS = config.holdSeconds * 1000;

export const isBoxNumber = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= EDITION;

const guard = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ValkeyUnreachable) return fail("sales_paused");
    throw error;
  }
};

const grantBody = (number: number, token: string, remainingMs: number): Record<string, unknown> => ({
  number, plate: plateOf(number), holdToken: token, holdMs: HOLD_MS, remainingMs,
});

export const reach = (number: unknown, ownToken: string | undefined): Promise<{ status: 200 | 201; body: Record<string, unknown> }> =>
  guard(async () => {
    if (!isBoxNumber(number)) return fail("validation_failed");
    if (ownToken) {
      const own = await holdState(number);
      if (own.owner === ownToken) return { status: 200, body: grantBody(number, ownToken, own.remainingMs) };
    }
    if (!salesOpen()) return fail("edition_closed");
    const box = await pool.query("SELECT state FROM boxes WHERE number = $1", [number]);
    if (box.rows[0].state !== "available") return fail("box_taken", { number });
    const token = newToken();
    if (!(await grantHold(number, token, HOLD_MS))) return fail("box_held", { number });
    nudge();
    return { status: 201, body: grantBody(number, token, (await holdState(number)).remainingMs) };
  });

/** The caller's live hold, or the refusal that says why it is not theirs. */
export const ownedHold = (number: number, token: string | undefined): Promise<number> =>
  guard(async () => {
    const hold = await holdState(number);
    if (hold.owner === null) return fail("hold_ended", { number });
    if (hold.owner !== token) return fail("hold_not_yours");
    return hold.remainingMs;
  });

export const holdStatus = async (number: number, token: string | undefined): Promise<Record<string, unknown>> => ({
  number, state: "held", holdMs: HOLD_MS, remainingMs: await ownedHold(number, token),
});

export const putBack = async (number: number, token: string | undefined): Promise<void> => {
  await ownedHold(number, token);
  await guard(() => releaseHold(number, token ?? ""));
  nudge();
};

/** Remaining hold time for a checkout reply: null once the hold became an order or ended. */
export const remainingOrNull = async (number: number): Promise<number | null> => {
  try {
    return (await holdState(number)).remainingMs || null;
  } catch {
    return null;
  }
};
