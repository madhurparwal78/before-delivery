import type { NoticeKind } from "../shared/api.ts";
import { formatTenths } from "../shared/money.ts";
import { type Db, pool, publish } from "./db.ts";
import { PocketBaseUnreachable, storeNotice } from "./pocketbase.ts";

// Notices wait in Postgres and are written to PocketBase exactly once (brief: Services / PocketBase).

export const noticeText = {
  deadlineLocked: (gameweek: number) => `Gameweek ${gameweek} is locked. Your team is set.`,
  transferRefused: (gameweek: number) => `Your change for gameweek ${gameweek} arrived after the deadline and was not saved.`,
  autoSub: (incoming: string, out: string, gameweek: number) => `${incoming} came on for ${out} in gameweek ${gameweek}.`,
  armband: (vice: string, gameweek: number) => `${vice} took the armband in gameweek ${gameweek}.`,
  priceChange: (name: string, priceTenths: number, rose: boolean) => `${name} ${rose ? "rose" : "fell"} to ${formatTenths(priceTenths)}m.`,
};

export async function queueNotice(db: Db | typeof pool, managerId: string, kind: NoticeKind, gameweek: number, message: string): Promise<void> {
  await db.query("INSERT INTO notice_outbox (manager_id, kind, gameweek, message) VALUES ($1, $2, $3, $4)", [managerId, kind, gameweek, message]);
  await publish(db, { t: "outbox" });
}

let installId = "";
let running = false;

// Record ids are 15 characters: this database's install id and the outbox row id.
const recordId = (outboxId: number) => `${installId}${outboxId.toString(36).padStart(10, "0")}`;

export async function deliverNotices(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const delivered = await pool.connect().then(async (db) => {
        try {
          await db.query("BEGIN");
          const due = await db.query<{ id: number; manager_id: string; kind: NoticeKind; gameweek: number; message: string }>(
            "SELECT id, manager_id, kind, gameweek, message FROM notice_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED",
          );
          let count = 0;
          try {
            for (const notice of due.rows) {
              await storeNotice(recordId(notice.id), {
                manager: notice.manager_id,
                kind: notice.kind,
                gameweek: notice.gameweek,
                message: notice.message,
              });
              await db.query("UPDATE notice_outbox SET delivered_at = now() WHERE id = $1", [notice.id]);
              await publish(db, { t: "notice", manager: notice.manager_id });
              count += 1;
            }
          } finally {
            await db.query("COMMIT");
          }
          return count === due.rows.length ? count : -1;
        } finally {
          db.release();
        }
      });
      if (delivered <= 0) return;
    }
  } catch (error) {
    if (!(error instanceof PocketBaseUnreachable)) console.error("notice delivery:", (error as Error).message);
  } finally {
    running = false;
  }
}

export function startNoticeDelivery(id: string): void {
  installId = id;
  setInterval(() => void deliverNotices(), 1000).unref();
}
