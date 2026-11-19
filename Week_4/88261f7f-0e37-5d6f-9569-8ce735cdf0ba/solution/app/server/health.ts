import { database } from "./db";
import { ok, type Reply } from "./http";
import { pdfServiceReachable } from "./providers/gotenberg";
import { mailReachable } from "./providers/smtp";
import { storeReachable } from "./providers/s3";

async function databaseReachable(): Promise<boolean> {
  try {
    await database().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** Always 200: `ok` only when all four providers answer a short probe. */
export async function health(): Promise<Reply> {
  const answers = await Promise.all([databaseReachable(), pdfServiceReachable(), storeReachable(), mailReachable()]);
  return ok({ status: answers.every(Boolean) ? "ok" : "unavailable" });
}
