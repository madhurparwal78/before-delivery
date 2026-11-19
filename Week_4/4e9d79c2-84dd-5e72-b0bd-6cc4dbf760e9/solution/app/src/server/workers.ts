// Background work: the erasure worker every 2 seconds, the daily check, and storing the seeded invoice's PDF.
import { config } from "./config.js";
import { nowSeconds, one, pool, rows, transaction } from "./db.js";
import { askStore, deleteObject, ProviderDown, sendMail } from "./providers.js";
import { hireMoney, vehiclesOf } from "./domain.js";
import { storeWaitingDocuments } from "./api-documents.js";
import { paperName } from "./api-operators.js";
import { money } from "../shared/rules.js";
import { addDays, daysBetween, longDate, ukDate, ukTime } from "../shared/time.js";
import type { CustomerRow, HireRow, PaperRow } from "./records.js";

/** Erases customers past their wait, asking MinIO first even when the customer has no files. */
const eraseDue = async (): Promise<void> => {
  const due = await rows<CustomerRow>(pool, "SELECT * FROM customers WHERE state='closed' AND erase_at<=$1", [nowSeconds()]);
  for (const customer of due) {
    try {
      await askStore();
      const hires = await rows<HireRow>(pool, "SELECT * FROM hires WHERE customer_id=$1", [customer.id]);
      const ids = hires.map((h) => h.id);
      const keys = [
        ...(await rows<{ object_key: string }>(pool, "SELECT object_key FROM documents WHERE hire_id=ANY($1) AND object_key IS NOT NULL", [ids])),
        ...(await rows<{ object_key: string }>(pool, "SELECT object_key FROM passenger_lists WHERE hire_id=ANY($1)", [ids])),
      ].map((r) => r.object_key);
      for (const key of keys) await deleteObject(key);
      await transaction(async (tx) => {
        for (const hire of hires) {
          if (hire.quote_token) await tx.query("INSERT INTO replaced_tokens (token,hire_id,language) VALUES ($1,$2,'en') ON CONFLICT (token) DO UPDATE SET language='en'", [hire.quote_token, hire.id]);
        }
        await tx.query("UPDATE replaced_tokens SET language='en' WHERE hire_id=ANY($1)", [ids]);
        await tx.query("DELETE FROM passengers WHERE hire_id=ANY($1)", [ids]);
        await tx.query("DELETE FROM passenger_lists WHERE hire_id=ANY($1)", [ids]);
        await tx.query("UPDATE documents SET customer_name='Erased customer',object_key=NULL,erased=true WHERE hire_id=ANY($1)", [ids]);
        await tx.query("UPDATE hires SET name='Erased customer',email=NULL,telephone=NULL,submitted_body=NULL,details=NULL,quote_token=NULL WHERE id=ANY($1)", [ids]);
        await tx.query("DELETE FROM enquiry_requests WHERE email_folded=$1", [customer.email_folded]);
        await tx.query("UPDATE customers SET state='erased',name=NULL,email=NULL,email_folded=NULL,telephone=NULL,telephone_folded=NULL,notes=NULL WHERE id=$1", [customer.id]);
      });
    } catch (error) {
      if (!(error instanceof ProviderDown)) throw error;
    }
  }
};

const dailyCheck = async (): Promise<void> => {
  const now = nowSeconds();
  const today = ukDate(now);
  const papers = await rows<PaperRow & { operator_name: string; desk_email: string }>(pool,
    "SELECT p.*, o.name AS operator_name, d.email AS desk_email FROM papers p JOIN operators o ON o.desk_id=p.desk_id AND o.id=p.operator_id JOIN desks d ON d.id=p.desk_id WHERE NOT p.expiry_mailed AND p.ends_on>=$1 AND p.ends_on<=$2",
    [today, addDays(today, 30)]);
  for (const paper of papers) {
    const line = `${paperName(paper.kind)} for ${paper.operator_name} ends on ${longDate(paper.ends_on)}`;
    await sendMail(paper.desk_email, line, `${line}\n`).then(
      () => pool.query("UPDATE papers SET expiry_mailed=true WHERE desk_id=$1 AND operator_id=$2 AND kind=$3", [paper.desk_id, paper.operator_id, paper.kind]),
      () => undefined,
    );
  }
  const hires = await rows<HireRow & { customer_email: string }>(pool,
    "SELECT h.*, c.email AS customer_email FROM hires h JOIN customers c ON c.id=h.customer_id WHERE h.accepted_at IS NOT NULL AND NOT h.reminded AND h.cancellation IS NULL AND c.state='active' AND h.depart_date>$1 AND h.depart_date<=$2",
    [addDays(today, 7), addDays(today, 10)]);
  for (const hire of hires) {
    const vehicles = await vehiclesOf(pool, hire.id);
    const { owed } = await hireMoney(pool, hire.id, vehicles);
    const bookedLate = daysBetween(ukDate(hire.created_at), hire.depart_date) <= 7;
    if (owed <= 0 || bookedLate) continue;
    await sendMail(hire.customer_email, `Balance reminder ${hire.id}`, `Amount owed: ${money(owed)}\nDue on: ${longDate(addDays(hire.depart_date, -7))}\nQuote this reference: ${hire.id}\n`).then(
      () => pool.query("UPDATE hires SET reminded=true WHERE id=$1", [hire.id]),
      () => undefined,
    );
  }
};
const dailyDue = async (): Promise<boolean> => {
  if (config.dailyRunAt === "any") return true;
  const now = nowSeconds();
  if (ukTime(now) < config.dailyRunAt) return false;
  const today = ukDate(now);
  const last = await one<{ value: string }>(pool, "SELECT value FROM meta WHERE key='daily_run'");
  if (last?.value === today) return false;
  await pool.query("INSERT INTO meta (key,value) VALUES ('daily_run',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [today]);
  return true;
};

const forever = (work: () => Promise<void>, everyMs: number): void => {
  const tick = (): void => {
    work().catch((error) => console.error(error)).finally(() => setTimeout(tick, everyMs));
  };
  tick();
};
export const startWorkers = (): void => {
  forever(eraseDue, 2000);
  forever(async () => {
    if (await dailyDue()) await dailyCheck();
  }, 2000);
  forever(storeWaitingDocuments, 3000);
};
