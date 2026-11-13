import { ORDER_STATUS_WORDS } from "../shared/format";
import { emit, one, pool, rows, unit, type Unit } from "./db";
import { sendMail } from "./mail";

// Every customer-facing status change writes one notification and sends one email. The text of a
// notification is its subject. It shows `emailed` only once the mail server accepted the message.

export function orderSubject(number: string, status: string): string {
  return status === "cancelled" ? `Order ${number} is cancelled` : `Order ${number}: ${ORDER_STATUS_WORDS[status] ?? status}`;
}

export const placedSubject = (number: string): string => `Your Roam House order ${number} is placed`;

interface Pending {
  id: string;
  text: string;
  body: string;
  email: string;
  user_id: string;
}

/** Writes the notification row (pending) in the caller's transaction and delivers it once that commits. */
export async function notify(u: Unit, userId: string, subject: string, detail: string, at: Date): Promise<string> {
  const { rows: [created] } = await u.db.query<{ id: string }>(
    "INSERT INTO notifications (user_id, text, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
    [userId, subject, `${subject}\n\n${detail}\n`, at],
  );
  if (!created) throw new Error("notification inserted");
  emit(u, "notification", { text: subject, email_status: "pending" }, "owner", `user:${userId}`);
  u.afterCommit.push(() => void deliver(created.id).catch(() => undefined));
  return created.id;
}

/** Sends a notification's email inside the caller's transaction: the order exists only if the server accepts it. */
export async function sendWithin(u: Unit, id: string, at: Date): Promise<void> {
  const row = await one<Pending>(u.db, "SELECT n.id, n.text, n.body, n.user_id, u.email FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = $1", [id]);
  if (!row) throw new Error("notification exists");
  await sendMail(row.email, row.text, row.body);
  await markEmailed(u, row, at);
}

async function markEmailed(u: Unit, row: Pending, at: Date): Promise<void> {
  await u.db.query("UPDATE notifications SET email_status = 'emailed', emailed_at = $2 WHERE id = $1", [row.id, at]);
  emit(u, "notification", { text: row.text, email_status: "emailed" }, "owner", `user:${row.user_id}`);
}

/** Sends one pending notification, exactly once: the row is claimed while the message goes out. */
async function deliver(id: string): Promise<void> {
  await unit(async (u) => {
    const row = await one<Pending>(
      u.db,
      `SELECT n.id, n.text, n.body, n.user_id, u.email FROM notifications n JOIN users u ON u.id = n.user_id
       WHERE n.id = $1 AND n.email_status = 'pending' FOR UPDATE OF n SKIP LOCKED`,
      [id],
    );
    if (!row) return;
    try {
      await sendMail(row.email, row.text, row.body);
    } catch {
      await u.db.query("UPDATE notifications SET next_attempt_at = now() + interval '5 seconds' WHERE id = $1", [id]);
      return;
    }
    await markEmailed(u, row, new Date());
  });
}

/** Retries pending emails at least every 30 seconds until the mail server accepts them. */
export function startNotifier(): void {
  setInterval(() => {
    void rows<{ id: string }>(pool, "SELECT id FROM notifications WHERE email_status = 'pending' AND next_attempt_at <= now() ORDER BY created_at LIMIT 20")
      .then((due) => Promise.all(due.map((n) => deliver(n.id))))
      .catch(() => undefined);
  }, 5000);
}
