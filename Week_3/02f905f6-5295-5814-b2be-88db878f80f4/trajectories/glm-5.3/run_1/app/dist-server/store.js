import pg from "pg";
import { PIECE_STATUS_LABELS, FIRING_STATUS_LABELS } from "./domain.js";
import { studioDate, studioLabel } from "./http.js";
import { POSTS, boundsFor } from "./geometry.js";
import { dec, fillPercent, toString as decToString } from "./rules.js";
export class Store {
    pool;
    cfg;
    constructor(pool, cfg) {
        this.pool = pool;
        this.cfg = cfg;
    }
    // --- People & session ---
    async userByEmail(email) {
        const res = await this.pool.query("SELECT id, name, role, member_number, email FROM people WHERE lower(email) = lower($1)", [email]);
        return res.rows[0] ?? null;
    }
    async passwordHash(userId) {
        const res = await this.pool.query("SELECT password_hash FROM people WHERE id = $1", [userId]);
        return res.rows[0]?.password_hash ?? null;
    }
    async createSession(userId) {
        const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        await this.pool.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
        return token;
    }
    async userBySession(token) {
        const res = await this.pool.query("SELECT p.id, p.name, p.role, p.member_number, p.email FROM sessions s JOIN people p ON p.id = s.user_id WHERE s.token = $1", [token]);
        return res.rows[0] ?? null;
    }
    async deleteSession(token) {
        await this.pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    }
    async members() {
        const res = await this.pool.query("SELECT id, name, role, member_number, email FROM people WHERE role = 'member' ORDER BY member_number");
        return res.rows;
    }
    // --- Clays, kilns, rates ---
    async clays() {
        const res = await this.pool.query("SELECT id, name, max_cone FROM clays ORDER BY id");
        return res.rows;
    }
    async kilns() {
        const kilnRows = await this.pool.query("SELECT * FROM kilns ORDER BY id");
        const profileRows = await this.pool.query("SELECT * FROM profiles ORDER BY id");
        const currentRows = await this.pool.query(`SELECT DISTINCT ON (kiln_id) kiln_id, id FROM firings
       WHERE status != 'unloaded' ORDER BY kiln_id, id DESC`);
        const current = new Map(currentRows.rows.map((r) => [r.kiln_id, r.id]));
        return kilnRows.rows.map((k) => ({
            id: k.id,
            name: k.name,
            shelf_diameter_in: Number(k.shelf_diameter_in),
            layers: k.layers,
            post_height_in: decToString(dec(k.post_height_in, 1), 1),
            usable_cubic_inches: k.usable_cubic_inches,
            posts: POSTS.map((p) => ({ x: p.x, y: p.y, size_in: p.size })),
            profiles: profileRows.rows
                .filter((p) => p.kiln_id === k.id)
                .map((p) => ({
                id: p.id,
                kiln_id: p.kiln_id,
                name: p.name,
                stage: p.stage,
                cone: p.cone,
                segments: typeof p.segments === "string" ? JSON.parse(p.segments) : p.segments,
                cool_down_hours: p.cool_down_hours,
                firing_hours: decToString(dec(p.firing_hours, 10), 4)
            })),
            current_firing_id: current.get(k.id) ?? null
        }));
    }
    async kilnById(id) {
        const all = await this.kilns();
        return all.find((k) => k.id === id) ?? null;
    }
    async rateSets() {
        const res = await this.pool.query("SELECT * FROM rate_sets ORDER BY effective_date DESC, id DESC");
        return res.rows.map(rateSetOut);
    }
    async rateSetInEffect(date) {
        const res = await this.pool.query("SELECT * FROM rate_sets WHERE effective_date <= $1 ORDER BY effective_date DESC, id DESC LIMIT 1", [date]);
        return res.rows[0] ? rateSetOut(res.rows[0]) : null;
    }
    async createRateSet(input) {
        const res = await this.pool.query(`INSERT INTO rate_sets (bisque_rate, glaze_rate, member_discount_percent, order_minimum_cents, effective_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (effective_date) DO NOTHING
       RETURNING *`, [input.bisque_rate, input.glaze_rate, input.member_discount_percent, input.order_minimum_cents, input.effective_date]);
        return res.rows[0] ? rateSetOut(res.rows[0]) : null;
    }
    async updateProfile(profileId, segments, coolDownHours, firingHours) {
        const res = await this.pool.query("UPDATE profiles SET segments = $1, cool_down_hours = $2, firing_hours = $3 WHERE id = $4 RETURNING *", [JSON.stringify(segments), coolDownHours, firingHours, profileId]);
        const row = res.rows[0];
        if (!row)
            return null;
        return {
            id: row.id,
            kiln_id: row.kiln_id,
            name: row.name,
            stage: row.stage,
            cone: row.cone,
            segments,
            cool_down_hours: coolDownHours,
            firing_hours: firingHours
        };
    }
    async profileById(id) {
        const res = await this.pool.query("SELECT * FROM profiles WHERE id = $1", [id]);
        const row = res.rows[0];
        if (!row)
            return null;
        return {
            id: row.id,
            kiln_id: row.kiln_id,
            name: row.name,
            stage: row.stage,
            cone: row.cone,
            segments: typeof row.segments === "string" ? JSON.parse(row.segments) : row.segments,
            cool_down_hours: row.cool_down_hours,
            firing_hours: decToString(dec(row.firing_hours, 10), 4)
        };
    }
    // --- Pieces ---
    async nextPieceNumber(client) {
        const res = await client.query("UPDATE counters SET value = value + 1 WHERE name = 'piece_number' RETURNING value");
        return res.rows[0].value;
    }
    async pieceByNumber(number) {
        const res = await this.pool.query("SELECT * FROM pieces WHERE number = $1", [number]);
        return res.rows[0] ?? null;
    }
    async piecesFor(ownerFilter) {
        if (ownerFilter.all) {
            const res = await this.pool.query("SELECT * FROM pieces ORDER BY number");
            return res.rows;
        }
        if (ownerFilter.memberNumber === null) {
            const res = await this.pool.query("SELECT * FROM pieces WHERE owner_kind = 'guest' ORDER BY number");
            return res.rows;
        }
        const res = await this.pool.query("SELECT * FROM pieces WHERE owner_kind = 'member' AND owner_member_number = $1 ORDER BY number", [ownerFilter.memberNumber]);
        return res.rows;
    }
    async piecesByStatus(status) {
        const res = await this.pool.query("SELECT * FROM pieces WHERE status = $1 ORDER BY number", [status]);
        return res.rows;
    }
    async queuedPieces() {
        const res = await this.pool.query("SELECT * FROM pieces WHERE status = 'queued' ORDER BY number");
        return res.rows;
    }
    async addHistory(client, pieceNumber, actor, action) {
        await client.query("INSERT INTO piece_history (piece_number, actor, action) VALUES ($1, $2, $3)", [pieceNumber, actor, action]);
    }
    async historyFor(number) {
        const res = await this.pool.query("SELECT at, actor, action FROM piece_history WHERE piece_number = $1 ORDER BY id", [number]);
        return res.rows.map((r) => ({
            at: r.at.toISOString(),
            at_label: studioLabel(r.at),
            actor: r.actor,
            action: r.action
        }));
    }
    async placementFor(number) {
        const res = await this.pool.query("SELECT * FROM placements WHERE piece_number = $1", [number]);
        return res.rows[0] ?? null;
    }
    // --- Firings & placements ---
    async firingById(id) {
        const res = await this.pool.query("SELECT * FROM firings WHERE id = $1", [id]);
        return res.rows[0] ?? null;
    }
    async placementsForFiring(firingId) {
        const res = await this.pool.query("SELECT * FROM placements WHERE firing_id = $1 ORDER BY piece_number", [firingId]);
        return res.rows;
    }
    async piecesForFiring(firingId) {
        const res = await this.pool.query(`SELECT p.* FROM pieces p JOIN placements pl ON pl.piece_number = p.number
       WHERE pl.firing_id = $1 ORDER BY p.number`, [firingId]);
        return res.rows;
    }
    // Effective firing status, decided here and only here.
    effectiveFiringStatus(firing, now) {
        if (firing.status === "building" || firing.status === "unloaded")
            return firing.status;
        if (!firing.started_at)
            return firing.status;
        if (firing.cool_until && now >= firing.cool_until)
            return "unloadable";
        if (firing.firing_ends_at && now >= firing.firing_ends_at)
            return "cooling";
        return "firing";
    }
    pieceStatusForFiring(firingStatus) {
        if (firingStatus === "firing")
            return "firing";
        if (firingStatus === "cooling")
            return "cooling";
        return "unloadable";
    }
    async firingView(firing, now) {
        const status = this.effectiveFiringStatus(firing, now);
        const kiln = await this.kilnById(firing.kiln_id);
        const kilnLayers = kiln?.layers ?? 1;
        const usable = kiln?.usable_cubic_inches ?? 1;
        const placements = await this.placementsForFiring(firing.id);
        const pieces = new Map();
        for (const p of await this.piecesForFiring(firing.id)) {
            pieces.set(p.number, p);
        }
        let cubicSumMilli = 0n;
        const layers = [];
        for (let i = 1; i <= kilnLayers; i++) {
            const layerPlacements = placements.filter((p) => p.layer === i);
            let tallest = 0;
            const layerOut = { layer: i, height_in: null, placements: [] };
            for (const pl of layerPlacements) {
                const piece = pieces.get(pl.piece_number);
                if (!piece)
                    continue;
                const h = Number(piece.height_in);
                if (h > tallest)
                    tallest = h;
                cubicSumMilli += BigInt(Math.round(Number(piece.cubic_inches) * 1000));
                const dims = {
                    length: piece.length_in ? Number(piece.length_in) : 0,
                    width: piece.width_in ? Number(piece.width_in) : 0,
                    diameter: piece.diameter_in ? Number(piece.diameter_in) : 0
                };
                const b = boundsFor(piece.shape, pl.rotation, dims);
                layerOut.placements.push({
                    piece_number: pl.piece_number,
                    shape: piece.shape,
                    x: pl.x,
                    y: pl.y,
                    rotation: pl.rotation,
                    width_in: decToString(dec(b.w, 1), 1),
                    depth_in: decToString(dec(b.h, 1), 1),
                    height_in: decToString(dec(h, 1), 1)
                });
            }
            layerOut.height_in = layerOut.placements.length ? decToString(dec(tallest + 1, 1), 1) : null;
            layers.push(layerOut);
        }
        const fill = fillPercent(cubicSumMilli, usable);
        return {
            id: firing.id,
            kiln_id: firing.kiln_id,
            profile: {
                id: firing.profile_snapshot.id,
                name: firing.profile_snapshot.name,
                stage: firing.profile_snapshot.stage,
                cone: firing.profile_snapshot.cone,
                segments: firing.profile_snapshot.segments,
                cool_down_hours: firing.profile_snapshot.cool_down_hours,
                firing_hours: firing.profile_snapshot.firing_hours
            },
            status,
            status_label: FIRING_STATUS_LABELS[status],
            started_at: firing.started_at ? firing.started_at.toISOString() : null,
            started_at_label: firing.started_at ? studioLabel(firing.started_at) : null,
            firing_ends_at: firing.firing_ends_at ? firing.firing_ends_at.toISOString() : null,
            firing_ends_at_label: firing.firing_ends_at ? studioLabel(firing.firing_ends_at) : null,
            cool_until: firing.cool_until ? firing.cool_until.toISOString() : null,
            cool_until_label: firing.cool_until ? studioLabel(firing.cool_until) : null,
            server_now: now.toISOString(),
            server_now_label: studioLabel(now),
            fill_percent: fill,
            layers
        };
    }
    async pieceView(row, now) {
        const placement = await this.placementFor(row.number);
        let status = row.status;
        const stage = row.stage;
        if (placement && (status === "loaded" || status === "firing" || status === "cooling" || status === "unloadable")) {
            const firing = await this.firingById(placement.firing_id);
            if (firing) {
                const fs = this.effectiveFiringStatus(firing, now);
                if (fs !== "building" && fs !== "unloaded") {
                    status = this.pieceStatusForFiring(fs);
                }
            }
        }
        const days = row.ready_at ? Math.floor((now.getTime() - row.ready_at.getTime()) / (this.cfg.pickupDaySeconds * 1000)) : null;
        const sides = row.shape === "rectangular"
            ? { length: row.length_in ?? "0.0", width: row.width_in ?? "0.0", height: row.height_in }
            : { diameter: row.diameter_in ?? "0.0", height: row.height_in };
        return {
            number: row.number,
            owner: {
                kind: row.owner_kind,
                name: row.owner_name,
                member_number: row.owner_member_number
            },
            shape: row.shape,
            sides_in: sides,
            cubic_inches: row.cubic_inches,
            fee_cents: row.fee_cents,
            rate_set_id: row.rate_set_id,
            plan: row.plan,
            stage,
            cone: row.cone,
            clay_id: row.clay_id,
            status,
            status_label: PIECE_STATUS_LABELS[status],
            pickup_shelf: row.pickup_shelf,
            intake_photo_id: row.intake_photo_id,
            accepted_at: row.accepted_at.toISOString(),
            accepted_at_label: studioLabel(row.accepted_at),
            ready_at: row.ready_at ? row.ready_at.toISOString() : null,
            ready_at_label: row.ready_at ? studioLabel(row.ready_at) : null,
            days_on_shelf: days,
            placement: placement
                ? {
                    firing_id: placement.firing_id,
                    layer: placement.layer,
                    x: placement.x,
                    y: placement.y,
                    rotation: placement.rotation
                }
                : null,
            history: await this.historyFor(row.number)
        };
    }
    // --- Photos ---
    async photoById(photoId) {
        const res = await this.pool.query("SELECT * FROM photos WHERE photo_id = $1", [photoId]);
        return res.rows[0] ?? null;
    }
    async insertPhoto(photo) {
        await this.pool.query("INSERT INTO photos (photo_id, content_type, bytes, sha256, uploaded_by) VALUES ($1, $2, $3, $4, $5)", [photo.photo_id, photo.content_type, photo.bytes, photo.sha256, photo.uploaded_by]);
    }
    async attachPhoto(client, photoId, pieceNumber) {
        const res = await client.query("UPDATE photos SET attached_to = $1 WHERE photo_id = $2 AND attached_to IS NULL", [pieceNumber, photoId]);
        return res.rowCount === 1;
    }
    // --- Damage reports ---
    async damageReports() {
        const res = await this.pool.query(`SELECT d.*, p.owner_name AS account_name, p.intake_photo_id AS piece_intake_photo
       FROM damage_reports d JOIN pieces p ON p.number = d.piece_number
       ORDER BY d.id DESC`);
        return res.rows.map((r) => ({
            id: r.id,
            piece_number: r.piece_number,
            kind: r.kind,
            note: r.note,
            status: r.status,
            intake_photo_id: r.piece_intake_photo,
            unload_photo_id: r.unload_photo_id,
            account_name: r.account_name,
            amount_cents: r.amount_cents,
            reported_by: r.reported_by,
            reported_at: r.reported_at.toISOString(),
            reported_at_label: studioLabel(r.reported_at)
        }));
    }
    async damageReportById(id) {
        const res = await this.pool.query("SELECT * FROM damage_reports WHERE id = $1", [id]);
        return res.rows[0] ?? null;
    }
    // --- Outbox ---
    async enqueueEmail(to, subject, body, tracking) {
        await this.pool.query(`INSERT INTO outbox (to_email, subject, body, tracking) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tracking) DO NOTHING`, [to, subject, body, tracking]);
    }
    async pendingEmails(limit) {
        const res = await this.pool.query(`SELECT id, to_email, subject, body, tracking FROM outbox
       WHERE sent_at IS NULL AND (attempts = 0 OR now() - updated_at > interval '10 seconds')
       ORDER BY id LIMIT $1`, [limit]);
        return res.rows;
    }
    async markEmailSent(id) {
        await this.pool.query("UPDATE outbox SET sent_at = now() WHERE id = $1", [id]);
    }
    async markEmailAttempt(id) {
        await this.pool.query("UPDATE outbox SET attempts = attempts + 1, updated_at = now() WHERE id = $1", [id]);
    }
    // --- Sweep: reminders, lapses, firing status persistence ---
    async sweepPickups(now) {
        const dayMs = this.cfg.pickupDaySeconds * 1000;
        const res = await this.pool.query("SELECT * FROM pieces WHERE status = 'ready' AND ready_at IS NOT NULL");
        for (const row of res.rows) {
            const readyAt = row.ready_at;
            const days = Math.floor((now.getTime() - readyAt.getTime()) / dayMs);
            if (days >= 21) {
                await this.pool.query("UPDATE pieces SET status = 'uncollected' WHERE number = $1 AND status = 'ready'", [row.number]);
                const client = await this.pool.connect();
                try {
                    await client.query("BEGIN");
                    await this.addHistory(client, row.number, "Shelfmark", "uncollected");
                    await client.query("COMMIT");
                }
                catch {
                    await client.query("ROLLBACK");
                }
                finally {
                    client.release();
                }
            }
            else if (days >= 14 && !row.reminder_sent_at) {
                const updated = await this.pool.query("UPDATE pieces SET reminder_sent_at = now() WHERE number = $1 AND reminder_sent_at IS NULL RETURNING number", [row.number]);
                if (updated.rows.length) {
                    const email = row.owner_kind === "member" ? await this.memberEmail(row.owner_member_number) : row.guest_email;
                    if (email) {
                        await this.enqueueEmail(email, `Still on the pickup shelf: Piece ${String(row.number).padStart(4, "0")}`, `Your piece is still on the pickup shelf.\nPickup shelf ${row.pickup_shelf}\nDays waiting: ${days}`, `reminder-${row.number}`);
                    }
                }
            }
        }
    }
    async memberEmail(memberNumber) {
        if (!memberNumber)
            return null;
        const res = await this.pool.query("SELECT email FROM people WHERE member_number = $1", [memberNumber]);
        return res.rows[0]?.email ?? null;
    }
    async sweepFiringStatus(now) {
        const res = await this.pool.query("SELECT * FROM firings WHERE status IN ('firing', 'cooling')");
        for (const row of res.rows) {
            const firing = { ...row, started_at: row.started_at ? new Date(row.started_at) : null, firing_ends_at: row.firing_ends_at ? new Date(row.firing_ends_at) : null, cool_until: row.cool_until ? new Date(row.cool_until) : null };
            const effective = this.effectiveFiringStatus(firing, now);
            if (effective !== firing.status) {
                await this.pool.query("UPDATE firings SET status = $1 WHERE id = $2 AND status = $3", [effective, firing.id, firing.status]);
                if (effective === "unloadable" || effective === "cooling") {
                    const placed = await this.piecesForFiring(firing.id);
                    const pieceStatus = this.pieceStatusForFiring(effective);
                    for (const p of placed) {
                        await this.pool.query("UPDATE pieces SET status = $1 WHERE number = $2", [pieceStatus, p.number]);
                    }
                }
            }
        }
    }
    today() {
        return studioDate(new Date());
    }
}
function rateSetOut(r) {
    const date = typeof r.effective_date === "string" ? r.effective_date : r.effective_date.toISOString().slice(0, 10);
    return {
        id: r.id,
        bisque_rate: r.bisque_rate,
        glaze_rate: r.glaze_rate,
        member_discount_percent: r.member_discount_percent,
        order_minimum_cents: r.order_minimum_cents,
        effective_date: date,
        created_at: r.created_at.toISOString(),
        created_at_label: studioLabel(r.created_at)
    };
}
export function footprintOf(piece, placement) {
    const dims = {
        length: piece.length_in ? Number(piece.length_in) : 0,
        width: piece.width_in ? Number(piece.width_in) : 0,
        diameter: piece.diameter_in ? Number(piece.diameter_in) : 0
    };
    const b = boundsFor(piece.shape, placement.rotation, dims);
    return {
        shape: piece.shape,
        x: Number(placement.x),
        y: Number(placement.y),
        w: b.w,
        h: b.h,
        rotation: placement.rotation
    };
}
