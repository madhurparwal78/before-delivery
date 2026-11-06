import { withTx } from '../db.js';
import { signPhotoPath } from '../photourls.js';
import { printInstant } from '../time.js';
function markLine(row) {
    return { x1: row.hx1, y1: row.hy1, x2: row.hx2, y2: row.hy2, angle: row.hoof_wall_angle };
}
function pasternLine(row) {
    return { x1: row.px1, y1: row.py1, x2: row.px2, y2: row.py2, angle: row.pastern_angle };
}
function signedDiff(a, b) {
    const d = Math.round((b - a) * 10) / 10;
    if (Object.is(d, -0) || d === 0)
        return '±0.0';
    return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1);
}
function angleText(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
}
export function readoutLines(prev, cur) {
    return [
        `Hoof wall ${angleText(prev.hoof_wall_angle)}° → ${angleText(cur.hoof_wall_angle)}° (${signedDiff(prev.hoof_wall_angle, cur.hoof_wall_angle)}°)`,
        `Pastern ${angleText(prev.pastern_angle)}° → ${angleText(cur.pastern_angle)}° (${signedDiff(prev.pastern_angle, cur.pastern_angle)}°)`,
        `Alignment ${prev.alignment} → ${cur.alignment}`
    ];
}
export function comparisonEntry(prev, cur) {
    return {
        previous: { hoof_wall: markLine(prev), pastern: pasternLine(prev), alignment: prev.alignment },
        current: { hoof_wall: markLine(cur), pastern: pasternLine(cur), alignment: cur.alignment },
        difference: {
            hoof_wall: signedDiff(prev.hoof_wall_angle, cur.hoof_wall_angle),
            pastern: signedDiff(prev.pastern_angle, cur.pastern_angle)
        },
        readout: readoutLines(prev, cur)
    };
}
export async function vetPhotoFor(tx, vetLinkId, visitId, hoof) {
    const rows = await tx.query(`select * from photos where visit_id = $1 and hoof = $2 and phase = 'after'`, [visitId, hoof]);
    if (rows.length === 0)
        return null;
    const p = rows[0];
    const signed = await signPhotoPath(tx, p.id, false, true, vetLinkId);
    return {
        hoof: p.hoof, phase: 'after', content_type: p.content_type, width: p.width, height: p.height,
        url: signed.path, url_expires_at: printTs(signed.expiresAt)
    };
}
function printTs(t) {
    return printInstant(t);
}
export async function buildVetComparison(link, pair, requestId) {
    return withTx(async (tx) => {
        const horse = (await tx.query(`select name from horses where id = $1`, [link.horse_id]))[0];
        const hooves = {};
        for (const hoof of ['LF', 'RF', 'LH', 'RH']) {
            const prevMarks = await tx.query(`select * from marks where visit_id = $1 and hoof = $2 order by version desc limit 1`, [pair[1].id, hoof]);
            const curMarks = await tx.query(`select * from marks where visit_id = $1 and hoof = $2 order by version desc limit 1`, [pair[0].id, hoof]);
            if (prevMarks.length === 0 || curMarks.length === 0) {
                hooves[hoof] = null;
                continue;
            }
            const entry = comparisonEntry(prevMarks[0], curMarks[0]);
            const prevPhoto = await vetPhotoFor(tx, link.id, pair[1].id, hoof);
            const curPhoto = await vetPhotoFor(tx, link.id, pair[0].id, hoof);
            if (!prevPhoto || !curPhoto) {
                hooves[hoof] = null;
                continue;
            }
            hooves[hoof] = {
                hoof,
                previous: { business_date: pair[1].business_date, photo: prevPhoto, ...entry.previous },
                current: { business_date: pair[0].business_date, photo: curPhoto, ...entry.current },
                difference: entry.difference,
                readout: entry.readout
            };
        }
        return {
            horse: { name: horse.name },
            previous_date: pair[1].business_date,
            current_date: pair[0].business_date,
            expires_at: printTs(link.expires_at),
            hooves
        };
    });
}
