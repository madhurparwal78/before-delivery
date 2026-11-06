import { connectDb, withTx } from './db.js';
import { businessDate, practiceZoneName } from './time.js';
import { putObject } from './storage.js';
import { signPhotoPath } from './photourls.js';
import { money } from './format-helpers.js';
function csvCell(v) {
    let s = v;
    if (/^[=+\-@]/.test(s))
        s = `'` + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export async function writeLedgerExport(month, jobId) {
    const db = connectDb();
    const entries = await db.query(`select l.*, u.name as owner_name, h.name as horse_name
     from ledger l join users u on u.id = l.owner_id left join horses h on h.id = l.horse_id
     where to_char(l.at, 'YYYY-MM') = $1
     order by l.at, l.id`, [month]);
    const lines = ['date,kind,owner,horse,amount'];
    for (const e of entries.rows) {
        const date = e.at instanceof Date ? businessDate(practiceZoneName(), e.at) : String(e.at).slice(0, 10);
        lines.push([
            csvCell(date),
            csvCell(e.kind),
            csvCell(e.owner_name ?? ''),
            csvCell(e.horse_name ?? ''),
            csvCell(money(Math.abs(e.amount_cents)))
        ].join(','));
    }
    const key = `exports/${month}/${jobId}.csv`;
    await putObject(key, Buffer.from(lines.join('\n'), 'utf8'), 'text/csv');
    const signed = await withTx(tx => signPhotoPath(tx, jobId, false, false, null));
    return { key, url: signed.path, url_expires_at: signed.expiresAt.toISOString() };
}
