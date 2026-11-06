import { withTx } from './db.js';
import { now } from './time.js';
import { putObject, getObject } from './storage.js';
import sharp from 'sharp';
import { emails as T } from './email-templates.js';
import { connectDb } from './db.js';
import { newId, sweepDay, offerPass } from './domain.js';
function parseParams(job) {
    try {
        return JSON.parse(job.params);
    }
    catch {
        return {};
    }
}
export async function runJob(job) {
    switch (job.kind) {
        case 'thumbnail': return runThumbnail(job);
        case 'offer_pass': return runOfferPass(job);
        case 'due_reminder': return runDueReminder(job);
        case 'dunning_retry': return runDunningRetry(job);
        case 'csv_export': return runCsvExport(job);
    }
}
async function runThumbnail(job) {
    const p = parseParams(job);
    const key = p.key;
    const photoId = p.photo_id;
    const data = await getObject(key);
    if (data === null) {
        return { photo_id: photoId };
    }
    const thumb = await sharp(data).resize({ width: 320 }).jpeg().toBuffer();
    await putObject(`${key}.thumb.jpg`, thumb, 'image/jpeg');
    await withTx(async (tx) => {
        const rows = await tx.query(`select id from photos where id = $1`, [photoId]);
        if (rows.length === 0)
            return;
        await tx.query(`update photos set thumbnail_status = 'ready' where id = $1`, [photoId]);
    });
    return { photo_id: photoId };
}
async function runOfferPass(job) {
    const p = parseParams(job);
    await withTx(async (tx) => {
        await sweepDay(tx, p.day_id, null);
        await offerPass(tx, p.day_id, null);
    });
    return null;
}
async function runDueReminder(job) {
    const p = parseParams(job);
    const db = connectDb();
    const rows = await db.query(`select h.name as horse_name, u.email from horses h join users u on u.id = h.owner_id where h.id = $1`, [p.horse_id]);
    if (rows.rows.length === 0)
        return { horse_id: p.horse_id, next_due_date: p.next_due_date };
    const msg = T.dueReminderEmail(rows.rows[0].horse_name, p.next_due_date);
    const emailId = newId('msg');
    await withTx(async (tx) => {
        await tx.query(`insert into emails(id, to_addr, subject, body, request_claimed, next_attempt_at, created_at)
       values($1,$2,$3,$4,false,$5,$5)`, [emailId, rows.rows[0].email, msg.subject, msg.body, now()]);
    });
    return { horse_id: p.horse_id, next_due_date: p.next_due_date };
}
async function runDunningRetry(job) {
    const { attemptDunningRetry } = await import('./billing.js');
    const p = parseParams(job);
    await attemptDunningRetry(p.invoice_id, p.retry_index);
    return null;
}
async function runCsvExport(job) {
    const { writeLedgerExport } = await import('./exporting.js');
    const p = parseParams(job);
    const result = await writeLedgerExport(p.month, job.id);
    return result;
}
