import { PANELS, PANEL_BY_ID, bandForDelta, substrateMedian, micronsToMils, isMaterial } from './panels.js';
import { buildTape, advisoryIdentity } from './record.js';
export const readCar = async (client, id) => {
    const r = await client.query('SELECT * FROM cars WHERE id = $1', [id]);
    return r.rows[0] ?? null;
};
/** All panels with owner readings and inspector entries, plus substrate medians. */
export async function readPanels(client, carId, viewer) {
    const readings = await client.query('SELECT panel_id, microns, read_at FROM readings WHERE car_id = $1', [carId]);
    const byPanel = new Map();
    for (const r of readings.rows)
        byPanel.set(r.panel_id, { microns: r.microns, readAt: r.read_at });
    const steelReadings = [];
    const aluminiumReadings = [];
    for (const p of PANELS) {
        const reading = byPanel.get(p.id);
        if (reading && p.substrate === 'steel')
            steelReadings.push(reading.microns);
        if (reading && p.substrate === 'aluminium')
            aluminiumReadings.push(reading.microns);
    }
    const medians = { steel: substrateMedian(steelReadings), aluminium: substrateMedian(aluminiumReadings) };
    const inspectorReadings = await client.query('SELECT link_id, panel_id, microns, captured_at, received_at FROM inspector_readings WHERE car_id = $1 ORDER BY received_at', [carId]);
    const inspectorFindings = await client.query('SELECT link_id, panel_id, u, v, wording, captured_at, received_at FROM inspector_findings WHERE car_id = $1 ORDER BY received_at', [carId]);
    const linkNames = new Map();
    if (viewer === 'owner') {
        const names = await client.query('SELECT id, name FROM links WHERE car_id = $1', [carId]);
        for (const row of names.rows)
            linkNames.set(row.id, row.name);
    }
    else if (viewer !== 'buyer') {
        linkNames.set(viewer.linkId, viewer.name);
    }
    const panels = PANELS.map(p => {
        const reading = byPanel.get(p.id);
        const median = p.substrate === 'steel' ? medians.steel : p.substrate === 'aluminium' ? medians.aluminium : null;
        let owner = null;
        if (p.substrate === 'plastic')
            owner = null;
        else if (reading) {
            owner = {
                microns: reading.microns,
                mils: micronsToMils(reading.microns),
                band: median === null ? 'No baseline' : bandForDelta(reading.microns - median),
                readAt: reading.readAt.toISOString(),
            };
        }
        const insp = inspectorReadings.rows.filter(r => r.panel_id === p.id).map(r => ({
            name: linkNames.get(r.link_id) ?? undefined,
            microns: r.microns,
            mils: micronsToMils(r.microns),
            band: median === null ? 'No baseline' : bandForDelta(r.microns - median),
            capturedAt: r.captured_at.toISOString(),
            receivedAt: r.received_at.toISOString(),
        }));
        const inspFindings = inspectorFindings.rows.filter(r => r.panel_id === p.id).map(r => ({
            name: linkNames.get(r.link_id) ?? undefined,
            u: r.u, v: r.v,
            wording: r.wording,
            capturedAt: r.captured_at.toISOString(),
            receivedAt: r.received_at.toISOString(),
        }));
        if (p.substrate === 'plastic') {
            return { id: p.id, label: p.label, substrate: p.substrate, owner: null, inspector: insp, inspectorFindings: inspFindings };
        }
        if (!reading) {
            return { id: p.id, label: p.label, substrate: p.substrate, owner: null, inspector: insp, inspectorFindings: inspFindings };
        }
        return { id: p.id, label: p.label, substrate: p.substrate, owner, inspector: insp, inspectorFindings: inspFindings };
    });
    return { panels, medians };
}
/** Working findings in walkround order with the owner's band. */
export async function readFindings(client, carId) {
    const rows = await client.query('SELECT * FROM findings WHERE car_id = $1 ORDER BY position', [carId]);
    const readings = await client.query('SELECT panel_id, microns FROM readings WHERE car_id = $1', [carId]);
    const byPanel = new Map(readings.rows.map((r) => [r.panel_id, r.microns]));
    const steel = [];
    const alu = [];
    for (const p of PANELS) {
        const m = byPanel.get(p.id);
        if (m !== undefined && p.substrate === 'steel')
            steel.push(m);
        if (m !== undefined && p.substrate === 'aluminium')
            alu.push(m);
    }
    const medians = { steel: substrateMedian(steel), aluminium: substrateMedian(alu) };
    const uploadKinds = await client.query('SELECT id, kind FROM uploads WHERE car_id = $1', [carId]);
    const photoIds = new Set(uploadIds(uploadKinds.rows, 'photo'));
    return rows.rows.map((r) => {
        const spec = PANEL_BY_ID[r.panel_id];
        const median = spec.substrate === 'steel' ? medians.steel : spec.substrate === 'aluminium' ? medians.aluminium : null;
        const microns = byPanel.get(r.panel_id);
        const band = spec.substrate === 'plastic' ? 'Not gauged' : median === null || microns === undefined ? 'No reading' : bandForDelta(microns - median);
        return {
            id: r.id, revision: r.revision, position: r.position, panelId: r.panel_id,
            panelLabel: spec.label, u: r.u, v: r.v, title: r.title, wording: r.wording,
            severity: r.severity, material: isMaterial(r.severity), band,
            photoId: (r.photo_id !== null && photoIds.has(r.photo_id)) ? r.photo_id : null,
        };
    });
}
function uploadIds(rows, kind) {
    const set = new Set();
    for (const r of rows)
        if (r.kind === kind)
            set.add(r.id);
    return set;
}
/** Working record: the latest pull with advisory responses and recurred flags applied. */
export async function readWorkingRecord(client, carId) {
    const pull = await client.query('SELECT * FROM record_pulls WHERE car_id = $1 ORDER BY pulled_at DESC LIMIT 1', [carId]);
    if (pull.rows.length === 0)
        return null;
    const row = pull.rows[0];
    const payload = row.payload;
    const responses = await client.query('SELECT advisory_key, stance, note, answered_at FROM advisory_responses WHERE car_id = $1', [carId]);
    const byKey = new Map(responses.rows.map((r) => [r.advisory_key, r]));
    const tape = buildTape(payload.motTests);
    const advisories = [];
    for (const step of tape) {
        for (const defect of step.defects) {
            if (defect.type !== 'ADVISORY')
                continue;
            const key = advisoryIdentity(step.motTestNumber, defect.text);
            const response = byKey.get(key);
            const recurred = computeRecurred(tape, key, defect.text, response?.stance ?? null);
            advisories.push({
                id: key, motTestNumber: step.motTestNumber, text: defect.text,
                stance: response?.stance ?? null, note: response?.note ?? null,
                answeredAt: response?.answered_at?.toISOString() ?? null, recurred,
            });
        }
    }
    const openAdvisories = advisories.filter(a => a.stance !== 'repaired' || a.recurred).length;
    return { pulledAt: row.pulled_at.toISOString(), firstUsedDate: payload.firstUsedDate, tape, advisories, openAdvisories };
}
/** An advisory is recurred when its stance is repaired and its exact text returns at a later test. */
function computeRecurred(tape, key, text, stance) {
    if (stance !== 'repaired')
        return false;
    const origin = key.split('::')[0];
    const originDate = tape.find(t => t.motTestNumber === origin)?.completedDate;
    if (!originDate)
        return false;
    return tape.some(t => t.completedDate > originDate && t.defects.some(d => d.type === 'ADVISORY' && d.text === text));
}
/** Advisory identity rows computed for validation (needed before a response is saved). */
export async function readAdvisoryByIdentity(client, carId, advisoryId) {
    const record = await readWorkingRecord(client, carId);
    if (!record)
        return null;
    return record.advisories.find(a => a.id === advisoryId) ?? null;
}
export async function readStanding(client, carId) {
    const gaugeable = PANELS.filter(p => p.substrate !== 'plastic').length;
    const read = await client.query('SELECT count(*)::int AS n FROM readings WHERE car_id = $1', [carId]);
    const findings = await client.query('SELECT count(*)::int AS n FROM findings WHERE car_id = $1', [carId]);
    const files = await client.query('SELECT count(*)::int AS n FROM uploads WHERE car_id = $1', [carId]);
    const links = await client.query(`SELECT count(*)::int AS n FROM links WHERE car_id = $1 AND status = 'active' AND expires_at > now()`, [carId]);
    const slots = await client.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE holder_link_id IS NOT NULL)::int AS held FROM slots WHERE car_id = $1', [carId]);
    const offers = await client.query(`SELECT count(*)::int AS n FROM offers WHERE car_id = $1 AND status IN ('open','needs_reread')`, [carId]);
    const alerts = await client.query(`SELECT count(*)::int AS n FROM alerts WHERE car_id = $1 AND state = 'failed'`, [carId]);
    return {
        panelsRead: read.rows[0].n, panelsGaugeable: gaugeable, findings: findings.rows[0].n,
        files: files.rows[0].n, activeLinks: links.rows[0].n,
        slotsHeld: slots.rows[0].held, slots: slots.rows[0].total,
        liveOffers: offers.rows[0].n, failedAlerts: alerts.rows[0].n,
    };
}
/** Publish blockers, decided on every read by the server's clock. */
export async function readPublishBlockers(cfg, client, carId) {
    const car = await readCar(client, carId);
    if (!car)
        return [];
    if (car.listing_status !== 'draft' && car.listing_status !== 'live')
        return [];
    const reasons = [];
    const findings = await client.query('SELECT count(*)::int AS n FROM findings WHERE car_id = $1', [carId]);
    if (findings.rows[0].n === 0)
        reasons.push('no_findings');
    const pull = await client.query('SELECT pulled_at FROM record_pulls WHERE car_id = $1 ORDER BY pulled_at DESC LIMIT 1', [carId]);
    if (pull.rows.length === 0)
        reasons.push('no_record_pull');
    else {
        const ageSeconds = (Date.now() - pull.rows[0].pulled_at.getTime()) / 1000;
        if (ageSeconds > cfg.recordPullMaxAgeSeconds)
            reasons.push('record_stale');
        const record = await readWorkingRecord(client, carId);
        if (record) {
            if (record.advisories.some(a => a.stance === null))
                reasons.push('advisories_unanswered');
            if (record.advisories.some(a => a.recurred))
                reasons.push('advisory_recurred');
        }
    }
    return reasons;
}
export async function carView(cfg, client, car) {
    const standing = await readStanding(client, car.id);
    const blockers = await readPublishBlockers(cfg, client, car.id);
    const record = await readWorkingRecord(client, car.id);
    return {
        id: car.id, name: car.name, registration: car.registration,
        askingPounds: car.asking_pounds, viewingArea: car.viewing_area, homeAddress: car.home_address,
        story: car.story, listingStatus: car.listing_status, currentVersion: car.current_version,
        pulledAt: car.pulled_at?.toISOString() ?? null,
        publishedOpenAdvisories: await publishedOpenAdvisories(client, car),
        workingOpenAdvisories: record?.openAdvisories ?? 0,
        publishBlockers: blockers,
        standing,
    };
}
async function publishedOpenAdvisories(client, car) {
    if (car.current_version === null)
        return 0;
    const v = await client.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [car.id, car.current_version]);
    if (v.rows.length === 0)
        return 0;
    const content = v.rows[0].content;
    return content.record?.openAdvisories ?? 0;
}
/** The fingerprint of a finding's content: used to decide whether an amendment changed it. */
export function findingFingerprint(f) {
    return JSON.stringify([f.panelId, f.u.toFixed(3), f.v.toFixed(3), f.title, f.wording, f.severity, f.photoId]);
}
