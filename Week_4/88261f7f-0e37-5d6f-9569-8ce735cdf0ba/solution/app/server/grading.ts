import type { IncomingMessage } from "node:http";
import { config } from "./config";
import { database, isUniqueViolation, run, atomic } from "./db";
import { fail, isObject, isUuid, jsonBody, ok, type JsonObject, type Reply } from "./http";
import { provisionHotel } from "./provision";

/** The two grading routes need the key header; anything else is not found. */
function requireGradingKey(req: IncomingMessage): void {
  const given = req.headers["x-grading-key"];
  if (!config.gradingKey || given !== config.gradingKey) throw fail.notFound();
}

export async function gradingSetup(req: IncomingMessage, origin: string): Promise<Reply> {
  requireGradingKey(req);
  const spec = await jsonBody(req);
  try {
    const created = await atomic(async (client) => {
      const first = await provisionHotel(client, spec, origin);
      const secondSpec = isObject(spec.secondHotel) ? spec.secondHotel : null;
      const second = secondSpec ? await provisionHotel(client, secondSpec, origin) : null;
      return { ...first, ...(second ? { secondHotel: second } : {}) };
    });
    return ok(created, 201);
  } catch (failure) {
    if (isUniqueViolation(failure, "stay_nights_hold")) throw fail.invalid({ setup: "two stays hold the same room on the same night." });
    throw failure;
  }
}

export async function gradingClock(req: IncomingMessage): Promise<Reply> {
  requireGradingKey(req);
  const body: JsonObject = await jsonBody(req);
  const hotelId = typeof body.hotelId === "string" && isUuid(body.hotelId) ? body.hotelId : null;
  const moment = typeof body.now === "string" ? new Date(body.now) : null;
  if (moment && Number.isNaN(moment.getTime())) throw fail.invalid({ now: "now is not a moment." });
  const changed = hotelId ? await run(database(), "UPDATE hotels SET clock_now = $2 WHERE id = $1", [hotelId, moment]) : 0;
  if (changed === 0) throw fail.notFound();
  return ok({ hotelId, now: moment ? moment.toISOString() : null });
}
