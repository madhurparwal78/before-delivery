// Background passes every instance runs: the outbox, billing reconciliation, the waitlist offer pass every 5 s and
// the due-reminder scan, plus the job handlers for offers and reminders (brief: Business rules, Waitlist, Jobs;
// Services, Email outage; Business rules, Billing outage).
import { reconcileBilling } from "./billing.js";
import { now } from "./clock.js";
import { config } from "./config.js";
import { background, runAfterCommit, runAs } from "./context.js";
import { db, first, transaction } from "./db.js";
import { dayChange, daysNeedingSettle } from "./days.js";
import { lastVisitDateSql, nextDue } from "./domain/nextDue.js";
import { enqueueJob, registerJob, startJobWorker } from "./jobs.js";
import { errorText, log } from "./log.js";
import { dueReminderMail } from "./mail/messages.js";
import { drainOutbox, queueEmail } from "./mail/outbox.js";
import { today } from "./practice.js";
const OFFER_PASS_SECONDS = 5;
registerJob("offer_pass", {
    run: async (job) => {
        await transaction((client) => dayChange(client, job.payload.barn_day_id ?? "", now(), async () => undefined));
        return null;
    },
});
registerJob("due_reminder", {
    run: async (job) => {
        const horse = first((await db.query(`SELECT h.name, u.name AS owner_name, u.email AS owner_email FROM horses h JOIN users u ON u.id = h.owner_id WHERE h.id = $1`, [job.payload.horse_id])).rows);
        const date = job.payload.next_due_date ?? "";
        await queueEmail(db, `due-reminder:${job.payload.horse_id}:${date}`, dueReminderMail({ to: horse.owner_email, name: horse.owner_name, horse: horse.name, nextDue: date }));
        return null;
    },
});
/** Queues one offer pass per day that has a lapse to write or people waiting. */
async function scanOffers() {
    for (const dayId of await daysNeedingSettle(now())) {
        await enqueueJob(db, { kind: "offer_pass", payload: { barn_day_id: dayId }, activeKey: `offer_pass:${dayId}` });
    }
}
/** Each horse in due status gets one reminder job per next-due date, once across all instances. */
async function scanDueReminders() {
    const { rows } = await db.query(`SELECT h.id, h.cycle_weeks, ${lastVisitDateSql("h.id")} AS last FROM horses h`);
    for (const horse of rows) {
        const due = nextDue(horse.last, horse.cycle_weeks, today(now()));
        if (due.due_status !== "due" || !due.next_due_date)
            continue;
        await enqueueJob(db, {
            kind: "due_reminder",
            payload: { horse_id: horse.id, next_due_date: due.next_due_date },
            onceKey: `due_reminder:${horse.id}:${due.next_due_date}`,
        });
    }
}
let stopped = false;
/** Runs a pass, then schedules the next one after it finishes, so passes never overlap. */
function every(name, seconds, pass) {
    const run = () => {
        if (stopped)
            return;
        const context = background(null);
        runAs(context, async () => {
            await pass();
            await runAfterCommit(context);
        })
            .catch((error) => log("error", `${name} pass failed`, { error: errorText(error) }))
            .finally(() => {
            if (!stopped)
                setTimeout(run, seconds * 1000);
        });
    };
    setTimeout(run, seconds * 1000);
}
export function startWorkers() {
    startJobWorker();
    every("outbox", 1, drainOutbox);
    every("billing reconciliation", 2, reconcileBilling);
    every("offer pass scan", OFFER_PASS_SECONDS, scanOffers);
    every("due reminder scan", config.reminderScanSeconds, scanDueReminders);
}
export function stopWorkers() {
    stopped = true;
}
