// Rental sets: creation, lifecycle, check-in against the slip and the return-due rule.
import { randomUUID } from "node:crypto";
import { RENTAL_STATUS_LABELS } from "../../shared/api.js";
import { londonDate, londonTimestamp } from "../../shared/london.js";
import { pgCode, pool, rows, transaction } from "../db.js";
import { dueAt, dueDate, isOverdue, RENTAL_EDGES, returnedLate } from "../domain/rentals.js";
import { singleLineText } from "../domain/text.js";
import { conflict, forbidden, invalid, notFound } from "../errors.js";
import { jsonBody, route } from "../http.js";
import { claimNewReminders, deliverReminders } from "../notices.js";
import { authenticate, requireRole } from "../people.js";
import { pad2 } from "../readModel.js";
import { field, isIntegerIn, isRecord, isWholeNumber } from "../validate.js";
const RENTAL_SELECT = `
  SELECT rs.id, rs.work_id, w.title AS work_title, pr.id AS programme_id, pr.number AS programme_number,
         rs.publisher, rs.status, rs.returned_at,
         (SELECT max(performs_at) FROM performances WHERE programme_id = pr.id) AS final_performance,
         (SELECT count(*)::int FROM reminders r WHERE r.rental_set_id = rs.id AND r.status = 'sent') AS reminders_sent,
         (SELECT count(*)::int FROM reminders r WHERE r.rental_set_id = rs.id AND r.status = 'queued') AS reminders_queued,
         (SELECT max(sent_at) FROM reminders r WHERE r.rental_set_id = rs.id) AS reminder_sent_at
  FROM rental_sets rs JOIN works w ON w.id = rs.work_id JOIN programmes pr ON pr.id = w.programme_id`;
async function loadRentalSets(db, id) {
    const found = await rows(db, `${RENTAL_SELECT} ${id === null ? "" : "WHERE rs.id = $1"}`, id === null ? [] : [id]);
    const slips = await rows(db, `SELECT sl.rental_set_id, sl.part_id, pa.name AS part_name, sl.copies, sl.checked_in
     FROM slip_lines sl JOIN parts pa ON pa.id = sl.part_id
     WHERE sl.rental_set_id = ANY($1) ORDER BY pa.position`, [found.map((r) => r.id)]);
    const today = londonDate(Date.now());
    return found
        .map((row) => {
        const slip = slips.filter((line) => line.rental_set_id === row.id);
        const finalDate = londonDate(row.final_performance);
        const due = dueDate(finalDate);
        const dueInstant = dueAt(due);
        const overdue = isOverdue(row.status, due, today);
        const onSlip = slip.reduce((total, line) => total + line.copies, 0);
        const checkedIn = slip.reduce((total, line) => total + line.checked_in, 0);
        const reminderStatus = row.reminders_queued > 0 ? "queued" : row.reminders_sent > 0 ? "sent" : "none";
        return {
            id: row.id,
            work_id: row.work_id,
            work_title: row.work_title,
            programme_id: row.programme_id,
            programme_number: pad2(row.programme_number),
            publisher: row.publisher,
            status: row.status,
            display_status: overdue ? "Overdue" : RENTAL_STATUS_LABELS[row.status],
            overdue,
            final_performance_date: finalDate,
            due_date: due,
            due_at: londonTimestamp(dueInstant),
            slip: slip.map(({ part_id, part_name, copies, checked_in }) => ({ part_id, part_name, copies, checked_in })),
            copies_on_slip: onSlip,
            copies_checked_in: checkedIn,
            copies_missing: onSlip - checkedIn,
            reminder: {
                status: reminderStatus,
                sent_at: reminderStatus === "sent" && row.reminder_sent_at !== null ? londonTimestamp(row.reminder_sent_at) : null,
            },
            returned_at: row.returned_at === null ? null : londonTimestamp(row.returned_at),
            returned_late: returnedLate(row.returned_at, dueInstant),
        };
    })
        .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
}
async function rentalSet(db, id) {
    const [found] = await loadRentalSets(db, id);
    if (!found)
        throw notFound();
    return found;
}
route("GET", "/api/rental-sets", "none", async (request) => {
    const person = await authenticate(pool, request);
    requireRole(person, "PA");
    return { status: 200, json: { rental_sets: await loadRentalSets(pool, null) } };
});
route("POST", "/api/rental-sets", "json", async (request) => {
    const person = await authenticate(pool, request);
    const body = jsonBody(request);
    const workId = field(body, "work_id");
    const slipField = field(body, "slip");
    const lines = Array.isArray(slipField) ? slipField : [];
    const [work] = typeof workId === "string" && person.role !== "player"
        ? await rows(pool, "SELECT id, title FROM works WHERE id = $1", [workId])
        : [];
    if (typeof workId === "string" && !work)
        throw notFound();
    const workParts = work ? await rows(pool, "SELECT id FROM parts WHERE work_id = $1", [work.id]) : [];
    for (const line of lines) {
        const partId = field(line, "part_id");
        if (work && typeof partId === "string" && !workParts.some((p) => p.id === partId))
            throw notFound();
    }
    requireRole(person, "P");
    if (work) {
        const [open] = await rows(pool, "SELECT 1 FROM rental_sets WHERE work_id = $1 AND status <> 'checked_in'", [work.id]);
        if (open)
            throw conflict("rental_set_open", `${work.title} already has an open rental set.`);
    }
    const errors = {};
    if (!work)
        errors.work_id = "Choose a programme work.";
    const publisher = singleLineText(field(body, "publisher"), "Publisher");
    if (!publisher.ok)
        errors.publisher = publisher.message;
    const partIds = lines.map((line) => field(line, "part_id"));
    const slipValid = lines.length > 0 &&
        lines.every((line) => isRecord(line) && typeof line.part_id === "string" && isIntegerIn(line.copies, 1, 99)) &&
        new Set(partIds).size === partIds.length;
    if (!slipValid)
        errors.slip = "List each part once with 1 to 99 copies.";
    if (!work || !publisher.ok || !slipValid)
        throw invalid(errors);
    const id = `rs-${randomUUID()}`;
    let claimed = [];
    try {
        claimed = await transaction(async (client) => {
            await client.query("INSERT INTO rental_sets (id, work_id, publisher, status, created_at) VALUES ($1, $2, $3, 'requested', now())", [
                id,
                work.id,
                publisher.text,
            ]);
            for (const line of lines) {
                await client.query("INSERT INTO slip_lines (rental_set_id, part_id, copies, checked_in) VALUES ($1, $2, $3, 0)", [
                    id,
                    field(line, "part_id"),
                    field(line, "copies"),
                ]);
            }
            return claimNewReminders(client, id);
        });
    }
    catch (error) {
        if (pgCode(error) === "23505")
            throw conflict("rental_set_open", `${work.title} already has an open rental set.`);
        throw error;
    }
    void deliverReminders(claimed);
    return { status: 201, json: await rentalSet(pool, id) };
});
const TARGETS = ["received", "in_use", "returned", "checked_in"];
route("POST", "/api/rental-sets/{id}/transition", "json", async (request) => {
    const person = await authenticate(pool, request);
    if (person.role === "player")
        throw notFound();
    const current = await rentalSet(pool, request.params.id ?? "");
    const to = TARGETS.find((status) => status === field(jsonBody(request), "to"));
    const edge = to ? RENTAL_EDGES[to] : undefined;
    requireRole(person, "PA");
    if (edge && !edge.roles.includes(person.role))
        throw forbidden();
    if (!to || !edge)
        throw invalid({ to: "Choose received, in use, returned or checked in." });
    await transaction(async (client) => {
        const [locked] = await rows(client, "SELECT status FROM rental_sets WHERE id = $1 FOR NO KEY UPDATE", [current.id]);
        const from = locked?.status ?? current.status;
        if (from !== edge.from) {
            throw conflict("illegal_transition", `${current.work_title} set can't move from ${RENTAL_STATUS_LABELS[from]} to ${RENTAL_STATUS_LABELS[to]}.`);
        }
        if (to === "returned") {
            const short = await rows(client, `SELECT sl.part_id, pa.name AS part_name, sl.copies - sl.checked_in AS missing
         FROM slip_lines sl JOIN parts pa ON pa.id = sl.part_id
         WHERE sl.rental_set_id = $1 AND sl.checked_in < sl.copies ORDER BY pa.position`, [current.id]);
            if (short.length > 0) {
                const total = short.reduce((sum, line) => sum + line.missing, 0);
                const listed = short.map((line) => `${line.part_name} ${line.missing}`).join(", ");
                throw conflict("copies_missing", `Can't mark returned: ${total} ${total === 1 ? "copy" : "copies"} missing (${listed}).`, {
                    missing: short,
                });
            }
        }
        await client.query(`UPDATE rental_sets SET status = $2, returned_at = CASE WHEN $2 = 'returned' THEN now() ELSE returned_at END WHERE id = $1`, [current.id, to]);
    });
    return { status: 200, json: await rentalSet(pool, current.id) };
});
route("PUT", "/api/rental-sets/{id}/check-in", "json", async (request) => {
    const person = await authenticate(pool, request);
    if (person.role === "player")
        throw notFound();
    const current = await rentalSet(pool, request.params.id ?? "");
    const countsField = field(jsonBody(request), "counts");
    const counts = Array.isArray(countsField) ? countsField : [];
    for (const line of counts) {
        const partId = field(line, "part_id");
        if (typeof partId === "string" && !current.slip.some((s) => s.part_id === partId))
            throw notFound();
    }
    requireRole(person, "PA");
    await transaction(async (client) => {
        const [locked] = await rows(client, "SELECT status FROM rental_sets WHERE id = $1 FOR NO KEY UPDATE", [current.id]);
        if (locked?.status !== "in_use") {
            const label = RENTAL_STATUS_LABELS[locked?.status ?? current.status];
            throw conflict("wrong_status", `Counts can't change: ${current.work_title} set is already ${label}.`);
        }
        const stored = await rows(client, `SELECT sl.rental_set_id, sl.part_id, pa.name AS part_name, sl.copies, sl.checked_in
       FROM slip_lines sl JOIN parts pa ON pa.id = sl.part_id WHERE sl.rental_set_id = $1 ORDER BY pa.position`, [current.id]);
        const stale = stored.filter((line) => counts.some((c) => field(c, "part_id") === line.part_id && isWholeNumber(field(c, "expected")) && field(c, "expected") !== line.checked_in));
        if (stale.length > 0) {
            throw conflict("count_changed", "Counts changed while you were typing.", {
                lines: stale.map(({ part_id, part_name, checked_in }) => ({ part_id, part_name, checked_in })),
            });
        }
        const valid = Array.isArray(countsField) &&
            counts.every((c) => {
                const line = stored.find((s) => s.part_id === field(c, "part_id"));
                return line !== undefined && isWholeNumber(field(c, "expected")) && isIntegerIn(field(c, "copies"), 0, line.copies);
            });
        if (!valid)
            throw invalid({ counts: "Returned copies must be from 0 to the slip count." });
        for (const c of counts) {
            await client.query("UPDATE slip_lines SET checked_in = $3 WHERE rental_set_id = $1 AND part_id = $2", [
                current.id,
                field(c, "part_id"),
                field(c, "copies"),
            ]);
        }
    });
    return { status: 200, json: await rentalSet(pool, current.id) };
});
