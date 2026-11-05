import { Router } from "express";
import { AppError, conflict, crossOrigin, forbidden, methodNotAllowed, notFound, serviceUnavailable, tooLarge, unauthenticated, unsupportedType, validationError } from "./errors.js";
import { Store } from "./store.js";
import { KillBillClient } from "./killbill.js";
import { StorageClient, PHOTO_TYPES, MAX_PHOTO_BYTES } from "./storage.js";
import { MailClient } from "./mail.js";
import { verifyPassword } from "./db.js";
import { isStaff, studioLabel } from "./http.js";
import { centsToDollars, newToken, quoteParts, quoteResult, receiptBody, sha256Hex, upload, validateIntake, visiblePiece } from "./intake.js";
import { PIECE_STATUS_LABELS } from "./domain.js";
import { POSTS, firstClearPosition, footprintsOverlap, makeFootprint, meetsPost, pastShelfEdge } from "./geometry.js";
import { coneAtOrBelow, planStage, firingHours, dec, toString as decToString } from "./rules.js";
export function parseCookieToken(header) {
    if (!header)
        return null;
    for (const part of header.split(";")) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf("=");
        if (eq === -1)
            continue;
        if (trimmed.slice(0, eq) === "shelfmark_session") {
            return decodeURIComponent(trimmed.slice(eq + 1));
        }
    }
    return null;
}
export function buildApi(ctx) {
    const router = Router();
    const { cfg, store, kb, storage, mail } = ctx;
    const send = (res, err) => {
        const body = { error: err.code, message: err.message };
        if (err.extra)
            Object.assign(body, err.extra);
        if (err.fields)
            body.fields = err.fields;
        res.status(err.status).json(body);
    };
    const h = (fn) => {
        return (req, res, next) => {
            fn(req, res).catch(next);
        };
    };
    const requireRole = (level) => {
        return (req, _res, next) => {
            const user = req.user;
            if (!user) {
                next(unauthenticated());
                return;
            }
            if (level === "signed") {
                next();
                return;
            }
            if (level === "member" && user.role === "member") {
                next();
                return;
            }
            if (level === "staff" && isStaff(user)) {
                next();
                return;
            }
            if (level === "owner" && user.role === "owner") {
                next();
                return;
            }
            next(forbidden());
        };
    };
    async function withIdempotency(req, scope, run) {
        const user = req.user;
        const key = req.header("Idempotency-Key");
        if (key === undefined) {
            const result = await run();
            return { ...result, replayed: false };
        }
        if (key.length < 1 || key.length > 100 || !/^[\x20-\x7E]+$/.test(key)) {
            throw validationError({ Idempotency_Key: "Use 1 to 100 printable characters" });
        }
        const hash = sha256Hex(Buffer.from(`${scope}\0${JSON.stringify(req.body ?? null)}`));
        const insertRes = await store.pool.query(`INSERT INTO idempotency (key, user_id, request_hash) VALUES ($1, $2, $3)
       ON CONFLICT (key, user_id) DO NOTHING RETURNING key`, [`${scope}:${key}`, user.id, hash]);
        if (insertRes.rows.length === 0) {
            const existing = await store.pool.query("SELECT request_hash, in_progress, status, body FROM idempotency WHERE key = $1 AND user_id = $2", [`${scope}:${key}`, user.id]);
            const row = existing.rows[0];
            if (!row) {
                throw new AppError(409, "idempotency_conflict", "This key was used with a different request body.");
            }
            if (row.in_progress) {
                throw new AppError(409, "idempotency_in_progress", "A request with this key is still running.");
            }
            if (row.request_hash !== hash) {
                throw new AppError(409, "idempotency_conflict", "This key was used with a different request body.");
            }
            return { status: row.status, body: row.body, replayed: true };
        }
        try {
            const result = await run();
            if (result.status >= 500) {
                await store.pool.query("DELETE FROM idempotency WHERE key = $1 AND user_id = $2", [`${scope}:${key}`, user.id]);
                return { ...result, replayed: false };
            }
            await store.pool.query("UPDATE idempotency SET in_progress = false, status = $1, body = $2 WHERE key = $3 AND user_id = $4", [result.status, JSON.stringify(result.body), `${scope}:${key}`, user.id]);
            return { ...result, replayed: false };
        }
        catch (err) {
            await store.pool.query("DELETE FROM idempotency WHERE key = $1 AND user_id = $2", [`${scope}:${key}`, user.id]);
            throw err;
        }
    }
    // ---- health ----
    router.get("/health", (_req, res) => {
        res.status(200).json({ status: "ok" });
    });
    // ---- session ----
    router.post("/session", h(async (req, res) => {
        const body = req.body;
        const email = String(body.email ?? "").trim();
        const password = String(body.password ?? "");
        if (!email || !password) {
            send(res, new AppError(401, "bad_credentials", "Email or password is wrong."));
            return;
        }
        const user = await store.userByEmail(email);
        if (!user) {
            send(res, new AppError(401, "bad_credentials", "Email or password is wrong."));
            return;
        }
        const hash = await store.passwordHash(user.id);
        if (!hash || !verifyPassword(password, hash)) {
            send(res, new AppError(401, "bad_credentials", "Email or password is wrong."));
            return;
        }
        const token = await store.createSession(user.id);
        res.cookie("shelfmark_session", token, { httpOnly: true, sameSite: "lax", path: "/" });
        res.json({ user: { id: user.id, name: user.name, role: user.role, member_number: user.member_number } });
    }));
    router.delete("/session", h(async (req, res) => {
        const token = parseCookieToken(req.headers.cookie);
        if (token)
            await store.deleteSession(token);
        res.clearCookie("shelfmark_session", { httpOnly: true, sameSite: "lax", path: "/" });
        res.status(204).end();
    }));
    router.get("/me", requireRole("signed"), (req, res) => {
        const user = req.user;
        res.json({ user: { id: user.id, name: user.name, role: user.role, member_number: user.member_number } });
    });
    // ---- clays & rates ----
    router.get("/clays", requireRole("signed"), async (_req, res) => {
        const clays = await store.clays();
        res.json(clays);
    });
    router.get("/rates", requireRole("owner"), async (_req, res) => {
        res.json(await store.rateSets());
    });
    router.get("/rates/current", requireRole("signed"), async (_req, res) => {
        const rate = await store.rateSetInEffect(store.today());
        if (!rate) {
            send(res, notFound());
            return;
        }
        res.json(rate);
    });
    router.post("/rates", requireRole("owner"), h(async (req, res) => {
        const body = req.body;
        const fields = {};
        const bisqueRate = String(body.bisque_rate ?? "");
        const glazeRate = String(body.glaze_rate ?? "");
        const discount = Number(body.member_discount_percent);
        const minimum = Number(body.order_minimum_cents);
        const effective = String(body.effective_date ?? "");
        const ratePattern = /^\d{1,5}(\.\d{1,4})?$/;
        if (!ratePattern.test(bisqueRate) || Number(bisqueRate) <= 0 || Number(bisqueRate) > 1) {
            fields.bisque_rate = "Enter a rate above 0 and at most 1.0000 dollars";
        }
        if (!ratePattern.test(glazeRate) || Number(glazeRate) <= 0 || Number(glazeRate) > 1) {
            fields.glaze_rate = "Enter a rate above 0 and at most 1.0000 dollars";
        }
        if (!Number.isInteger(discount) || discount < 0 || discount > 50) {
            fields.member_discount_percent = "Enter a whole number from 0 to 50";
        }
        if (!Number.isInteger(minimum) || minimum < 0 || minimum > 10000) {
            fields.order_minimum_cents = "Enter 0 to 10000 cents";
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
            fields.effective_date = "Choose a date";
        }
        if (Object.keys(fields).length) {
            send(res, validationError(fields));
            return;
        }
        if (effective < store.today()) {
            send(res, validationError({ effective_date: "Choose today or a later date" }));
            return;
        }
        const created = await store.createRateSet({
            bisque_rate: bisqueRate,
            glaze_rate: glazeRate,
            member_discount_percent: discount,
            order_minimum_cents: minimum,
            effective_date: effective
        });
        if (!created) {
            send(res, conflict("rate_date_taken", `Rates already set for ${effective}.`));
            return;
        }
        res.status(201).json(created);
    }));
    // ---- quote ----
    router.post("/quote", requireRole("signed"), h(async (req, res) => {
        const user = req.user;
        const parts = await quoteParts(store, req.body, user.role === "member");
        res.json(quoteResult(parts));
    }));
    // ---- photos ----
    router.post("/photos", requireRole("signed"), upload.single("photo"), h(async (req, res) => {
        const user = req.user;
        if (!req.file) {
            send(res, validationError({ photo: "Add a photo of the piece" }));
            return;
        }
        const contentType = req.file.mimetype;
        if (!PHOTO_TYPES.has(contentType)) {
            send(res, unsupportedType());
            return;
        }
        if (req.file.size > MAX_PHOTO_BYTES) {
            send(res, tooLarge());
            return;
        }
        const photoId = newToken().slice(0, 32);
        try {
            await storage.put(photoId, req.file.buffer, contentType);
        }
        catch {
            send(res, serviceUnavailable("storage_unavailable", "Photo not saved — storage is unreachable. Try again in a minute."));
            return;
        }
        const confirmed = await storage.confirm(photoId).catch(() => false);
        if (!confirmed) {
            send(res, serviceUnavailable("storage_unavailable", "Photo not saved — storage is unreachable. Try again in a minute."));
            return;
        }
        await store.insertPhoto({
            photo_id: photoId,
            content_type: contentType,
            bytes: req.file.size,
            sha256: sha256Hex(req.file.buffer),
            uploaded_by: user.id
        });
        res.status(201).json({ photo_id: photoId, content_type: contentType, bytes: req.file.size, sha256: sha256Hex(req.file.buffer) });
    }));
    router.get("/photos/:photoId", requireRole("signed"), h(async (req, res) => {
        const user = req.user;
        const photo = await store.photoById(req.params.photoId);
        if (!photo) {
            send(res, notFound());
            return;
        }
        let allowed = photo.uploaded_by === user.id || isStaff(user);
        if (!allowed && user.role === "member" && photo.attached_to !== null) {
            const piece = await store.pieceByNumber(photo.attached_to);
            if (piece && piece.owner_kind === "member" && piece.owner_member_number === user.member_number) {
                allowed = true;
            }
        }
        if (!allowed) {
            send(res, notFound());
            return;
        }
        let data;
        try {
            data = await storage.get(photo.photo_id);
        }
        catch {
            send(res, serviceUnavailable("storage_unavailable", "Photo unavailable while storage is down."));
            return;
        }
        if (!data) {
            send(res, notFound());
            return;
        }
        res.setHeader("Content-Type", photo.content_type);
        res.setHeader("Content-Length", String(data.bytes.length));
        res.send(data.bytes);
    }));
    // ---- intakes & dropoffs ----
    async function performIntake(user, body, guest) {
        const { input, parts } = await validateIntake(store, body, guest);
        const photo = await store.photoById(input.photo_id);
        if (!photo || photo.uploaded_by !== user.id || photo.attached_to !== null) {
            throw validationError({ photo_id: "Photo already used or not yours" });
        }
        const stored = await storage.confirm(input.photo_id).catch(() => false);
        if (!stored) {
            throw serviceUnavailable("intake_failed", "Intake stopped at the photo step: the photo could not be confirmed. Nothing was charged.", { step: "photo" });
        }
        const client = await store.pool.connect();
        let pieceNumber;
        try {
            await client.query("BEGIN");
            pieceNumber = await store.nextPieceNumber(client);
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            client.release();
            throw err;
        }
        const ownerName = guest ? String(input.guest_name) : user.name;
        const ownerEmail = guest ? String(input.guest_email) : user.email;
        const ownerMemberNumber = guest ? null : user.member_number;
        const stage = planStage(input.plan, null);
        // Step 2: charge recorded in Kill Bill before the piece exists.
        let invoiceId = null;
        try {
            const externalKey = guest ? `guest-${String(pieceNumber).padStart(4, "0")}` : `member-${ownerMemberNumber}`;
            const charge = await kb.createCharge(externalKey, centsToDollars(parts.fee.amountCents), `Firing Piece ${String(pieceNumber).padStart(4, "0")}`);
            invoiceId = charge.invoiceId;
        }
        catch (err) {
            client.release();
            if (err instanceof AppError && err.status === 503) {
                throw serviceUnavailable("intake_failed", "Intake stopped at the charge step: billing is unreachable. Nothing was charged.", { step: "charge" });
            }
            throw err;
        }
        // Step 3: receipt accepted by the mail server before the piece exists.
        let token = null;
        if (guest) {
            token = newToken();
        }
        const trackingUrl = token ? `${cfg.appPublicUrl}/track/${token}` : null;
        const sent = await mail.send({
            to: ownerEmail,
            subject: `Intake receipt: Piece ${String(pieceNumber).padStart(4, "0")}`,
            body: receiptBody(parts, pieceNumber, guest, trackingUrl)
        });
        if (!sent) {
            if (invoiceId) {
                await kb.voidInvoice(invoiceId).catch(() => undefined);
            }
            client.release();
            throw serviceUnavailable("intake_failed", "Intake stopped at the receipt step: email is unreachable. The charge was voided.", { step: "receipt" });
        }
        try {
            await client.query("BEGIN");
            const insert = await client.query(`INSERT INTO pieces (number, owner_kind, owner_name, owner_member_number, guest_email, shape,
           length_in, width_in, diameter_in, height_in, cubic_inches, fee_cents, rate_set_id, plan, stage, cone,
           clay_id, status, intake_photo_id, killbill_invoice_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`, [
                pieceNumber,
                guest ? "guest" : "member",
                ownerName,
                ownerMemberNumber,
                guest ? ownerEmail : null,
                input.shape,
                parts.sides.length ? decToString(parts.sides.length, 1) : null,
                parts.sides.width ? decToString(parts.sides.width, 1) : null,
                parts.sides.diameter ? decToString(parts.sides.diameter, 1) : null,
                decToString(parts.sides.height, 1),
                decToString(parts.cubic, 3),
                parts.fee.amountCents,
                parts.rateSet.id,
                input.plan,
                stage,
                input.cone,
                input.clay_id,
                guest ? "awaiting_payment" : "queued",
                input.photo_id,
                invoiceId
            ]);
            const piece = insert.rows[0];
            if (token) {
                await client.query("INSERT INTO tracking_tokens (piece_number, token) VALUES ($1, $2)", [pieceNumber, token]);
            }
            const attached = await store.attachPhoto(client, input.photo_id, pieceNumber);
            if (!attached) {
                throw new Error("photo attachment race");
            }
            await store.addHistory(client, pieceNumber, user.name, "accepted");
            await client.query("COMMIT");
            return piece;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }
    router.post("/intakes", requireRole("member"), h(async (req, res) => {
        const user = req.user;
        const result = await withIdempotency(req, "intake", async () => {
            const piece = await performIntake(user, req.body, false);
            return { status: 201, body: await store.pieceView(piece, new Date()) };
        });
        if (result.replayed)
            res.set("Idempotent-Replayed", "true");
        res.status(result.status).json(result.body);
    }));
    router.post("/dropoffs", requireRole("staff"), h(async (req, res) => {
        const user = req.user;
        const result = await withIdempotency(req, "dropoff", async () => {
            const piece = await performIntake(user, req.body, true);
            const tokenRow = await store.pool.query("SELECT token FROM tracking_tokens WHERE piece_number = $1", [piece.number]);
            const view = await store.pieceView(piece, new Date());
            return {
                status: 201,
                body: {
                    piece: view,
                    amount_due_cents: piece.fee_cents,
                    payment_status: "owed",
                    tracking_url: tokenRow.rows[0] ? `${cfg.appPublicUrl}/track/${tokenRow.rows[0].token}` : null
                }
            };
        });
        if (result.replayed)
            res.set("Idempotent-Replayed", "true");
        res.status(result.status).json(result.body);
    }));
    router.post("/dropoffs/:number/payment", requireRole("staff"), h(async (req, res) => {
        const user = req.user;
        const number = Number(req.params.number);
        const result = await withIdempotency(req, `dropoff-payment-${number}`, async () => {
            const client = await store.pool.connect();
            try {
                await client.query("BEGIN");
                // Serialise concurrent payments for one drop-off: exactly one
                // Kill Bill payment is made.
                await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dropoff-payment-${number}`]);
                const row = await store.pieceByNumber(number);
                if (!row || row.owner_kind !== "guest") {
                    await client.query("ROLLBACK");
                    throw notFound();
                }
                if (row.status !== "awaiting_payment") {
                    await client.query("ROLLBACK");
                    throw conflict("already_paid", "Already paid.");
                }
                if (!row.killbill_invoice_id) {
                    await client.query("ROLLBACK");
                    throw new AppError(502, "payment_failed", "Payment not recorded.");
                }
                const externalKey = `guest-${String(number).padStart(4, "0")}`;
                let invoiceBalanceCents;
                try {
                    const invoice = await kb.getInvoice(row.killbill_invoice_id);
                    invoiceBalanceCents = invoice ? Math.round(invoice.balance * 100) : row.fee_cents;
                }
                catch (err) {
                    await client.query("ROLLBACK");
                    if (err instanceof AppError && err.status === 503) {
                        throw serviceUnavailable("billing_unavailable", "Payment not recorded — billing is unreachable. The piece stays Owed.");
                    }
                    throw err;
                }
                let outcome;
                try {
                    outcome = await kb.purchasePayment(externalKey, row.killbill_invoice_id, centsToDollars(invoiceBalanceCents), `dropoff-${number}-payment-${Date.now()}`);
                }
                catch (err) {
                    await client.query("ROLLBACK");
                    if (err instanceof AppError && err.status === 503) {
                        throw serviceUnavailable("billing_unavailable", "Payment not recorded — billing is unreachable. The piece stays Owed.");
                    }
                    throw err;
                }
                if (!outcome.ok) {
                    await client.query("ROLLBACK");
                    throw new AppError(502, "payment_failed", "Payment not recorded.");
                }
                const upd = await client.query("UPDATE pieces SET status = 'queued' WHERE number = $1 AND status = 'awaiting_payment' RETURNING *", [number]);
                if (upd.rows.length === 0) {
                    await client.query("ROLLBACK");
                    throw conflict("already_paid", "Already paid.");
                }
                await store.addHistory(client, number, user.name, "paid");
                await client.query("COMMIT");
            }
            catch (err) {
                await client.query("ROLLBACK");
                throw err;
            }
            finally {
                client.release();
            }
            const fresh = await store.pieceByNumber(number);
            return {
                status: 200,
                body: {
                    payment_status: "paid",
                    paid_cents: fresh ? fresh.fee_cents : 0,
                    piece: fresh ? await store.pieceView(fresh, new Date()) : null
                }
            };
        });
        if (result.replayed)
            res.set("Idempotent-Replayed", "true");
        res.status(result.status).json(result.body);
    }));
    // ---- pieces ----
    router.get("/pieces", requireRole("signed"), h(async (req, res) => {
        const user = req.user;
        const statusFilter = req.query.status;
        let rows;
        if (isStaff(user)) {
            rows = statusFilter
                ? (await store.pool.query("SELECT * FROM pieces WHERE status = $1 ORDER BY number", [statusFilter])).rows
                : await store.piecesFor({ memberNumber: null, all: true });
        }
        else {
            rows = await store.piecesFor({ memberNumber: user.member_number, all: false });
            if (statusFilter)
                rows = rows.filter((r) => r.status === statusFilter);
        }
        const now = new Date();
        const views = [];
        for (const row of rows) {
            views.push(await store.pieceView(row, now));
        }
        res.json(views);
    }));
    router.get("/pieces/:number", requireRole("signed"), h(async (req, res) => {
        const user = req.user;
        const row = await visiblePiece(user, store, Number(req.params.number));
        res.json(await store.pieceView(row, new Date()));
    }));
    router.post("/pieces/:number/collect", requireRole("staff"), h(async (req, res) => {
        const user = req.user;
        const number = Number(req.params.number);
        const client = await store.pool.connect();
        try {
            await client.query("BEGIN");
            const upd = await client.query(`UPDATE pieces SET status = 'collected' WHERE number = $1 AND status IN ('ready', 'uncollected') RETURNING *`, [number]);
            if (upd.rows.length === 0) {
                await client.query("ROLLBACK");
                throw conflict("invalid_transition", `Piece ${String(number).padStart(4, "0")} is not on the pickup shelf.`);
            }
            await store.addHistory(client, number, user.name, "collected");
            await client.query("UPDATE tracking_tokens SET revoked = true WHERE piece_number = $1", [number]);
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
        const row = await store.pieceByNumber(number);
        res.json(row ? await store.pieceView(row, new Date()) : null);
    }));
    // ---- tracking ----
    router.get("/track/:token", async (req, res) => {
        const token = req.params.token;
        const found = await store.pool.query(`SELECT t.piece_number, t.revoked, p.status, p.pickup_shelf
       FROM tracking_tokens t JOIN pieces p ON p.number = t.piece_number
       WHERE t.token = $1`, [token]);
        const row = found.rows[0];
        if (!row || row.revoked || row.status === "collected") {
            res.status(404).json({ error: "not_found", message: "This tracking link is no longer active." });
            return;
        }
        const pieceRow = await store.pieceByNumber(row.piece_number);
        if (!pieceRow) {
            res.status(404).json({ error: "not_found", message: "This tracking link is no longer active." });
            return;
        }
        const view = await store.pieceView(pieceRow, new Date());
        res.json({
            piece_number: view.number,
            status: view.status,
            status_label: view.status_label,
            pickup_shelf: view.pickup_shelf
        });
    });
    router.all("/track/:token", (_req, res) => {
        send(res, methodNotAllowed());
    });
    router.post("/pieces/:number/tracking-link/revoke", requireRole("owner"), h(async (req, res) => {
        const user = req.user;
        const number = Number(req.params.number);
        const row = await store.pieceByNumber(number);
        if (!row || row.owner_kind !== "guest") {
            throw conflict("not_a_guest_piece", "Only guest pieces have a tracking link.");
        }
        const client = await store.pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("UPDATE tracking_tokens SET revoked = true WHERE piece_number = $1", [number]);
            await store.addHistory(client, number, user.name, "tracking revoked");
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
        res.json({ tracking: "revoked" });
    }));
    router.post("/pieces/:number/tracking-link", requireRole("owner"), h(async (req, res) => {
        const user = req.user;
        const number = Number(req.params.number);
        const row = await store.pieceByNumber(number);
        if (!row || row.owner_kind !== "guest") {
            throw conflict("not_a_guest_piece", "Only guest pieces have a tracking link.");
        }
        const client = await store.pool.connect();
        let token;
        try {
            await client.query("BEGIN");
            token = newToken();
            await client.query("UPDATE tracking_tokens SET token = $1, revoked = false, replaced_at = now() WHERE piece_number = $2", [token, number]);
            await store.addHistory(client, number, user.name, "tracking replaced");
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
        const url = `${cfg.appPublicUrl}/track/${token}`;
        await store.enqueueEmail(row.guest_email ?? "", `New tracking link for Piece ${String(number).padStart(4, "0")}`, `Your new tracking link:\n${url}`, `newlink-${number}-${Date.now()}`);
        res.status(201).json({ tracking_url: url });
    }));
    // ---- kilns & profiles ----
    router.get("/kilns", requireRole("staff"), async (_req, res) => {
        res.json(await store.kilns());
    });
    router.put("/kilns/:kilnId/profiles/:profileId", requireRole("owner"), h(async (req, res) => {
        const body = req.body;
        const fields = {};
        const segments = Array.isArray(body.segments) ? body.segments : null;
        if (!segments || segments.length < 1 || segments.length > 8) {
            fields.segments = "Use 1 to 8 segments";
        }
        const coolDown = Number(body.cool_down_hours);
        if (!Number.isInteger(coolDown) || coolDown < 1 || coolDown > 72) {
            fields.cool_down_hours = "Use 1 to 72 hours";
        }
        const parsed = [];
        if (segments) {
            for (const seg of segments) {
                const rate = Number(seg.rate_f_per_hour);
                const target = Number(seg.target_f);
                const hold = Number(seg.hold_minutes);
                if (!Number.isFinite(rate) || rate < 1 || rate > 1000) {
                    fields.rate_f_per_hour = "Use 1 to 1000 °F per hour";
                }
                if (!Number.isFinite(target) || target < 100 || target > 2400) {
                    fields.target_f = "Use 100 to 2400 °F";
                }
                if (!Number.isInteger(hold) || hold < 0 || hold > 600) {
                    fields.hold_minutes = "Use 0 to 600 minutes";
                }
                parsed.push({ rate_f_per_hour: rate, target_f: Math.round(target), hold_minutes: hold });
            }
        }
        if (Object.keys(fields).length) {
            throw validationError(fields);
        }
        const hours = firingHours(parsed);
        const updated = await store.updateProfile(Number(req.params.profileId), parsed, coolDown, decToString(hours, 10));
        if (!updated) {
            throw notFound();
        }
        res.json({ ...updated, firing_hours: decToString(hours, 10) });
    }));
    router.get("/queue", requireRole("staff"), async (_req, res) => {
        const rows = await store.queuedPieces();
        const now = new Date();
        const views = [];
        for (const row of rows) {
            views.push(await store.pieceView(row, now));
        }
        res.json(views);
    });
    // ---- firings ----
    router.post("/firings", requireRole("staff"), h(async (req, res) => {
        const user = req.user;
        const body = req.body;
        const kilnId = String(body.kiln_id ?? "");
        const profileId = Number(body.profile_id);
        const kiln = await store.kilnById(kilnId);
        if (!kiln)
            throw notFound();
        const profile = await store.profileById(profileId);
        if (!profile || profile.kiln_id !== kilnId)
            throw notFound();
        const client = await store.pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [kilnId]);
            const busy = await client.query("SELECT id FROM firings WHERE kiln_id = $1 AND status != 'unloaded' LIMIT 1", [kilnId]);
            if (busy.rows.length) {
                await client.query("ROLLBACK");
                throw conflict("kiln_busy", "This kiln already has a firing in progress.");
            }
            const insert = await client.query("INSERT INTO firings (kiln_id, profile_id, profile_snapshot, created_by) VALUES ($1, $2, $3, $4) RETURNING *", [kilnId, profileId, JSON.stringify(profile), user.id]);
            await client.query("COMMIT");
            const firing = insert.rows[0];
            res.status(201).json(await store.firingView(firing, new Date()));
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }));
    router.get("/firings/:id", requireRole("staff"), h(async (req, res) => {
        const firing = await store.firingById(Number(req.params.id));
        if (!firing)
            throw notFound();
        res.json(await store.firingView(firing, new Date()));
    }));
    function parsePlacement(body) {
        const fields = {};
        const layer = Number(body.layer);
        const x = Number(body.x);
        const y = Number(body.y);
        const rotation = Number(body.rotation);
        if (!Number.isInteger(layer) || layer < 1) {
            fields.layer = "Choose a layer from 1 up";
        }
        if (!Number.isFinite(x) || x < 0 || x > SHELF_MAX || (x * 2) % 1 !== 0) {
            fields.x = "Use multiples of 0.5 from 0 to 23";
        }
        if (!Number.isFinite(y) || y < 0 || y > SHELF_MAX || (y * 2) % 1 !== 0) {
            fields.y = "Use multiples of 0.5 from 0 to 23";
        }
        if (!Number.isInteger(rotation) || ![0, 90, 180, 270].includes(rotation)) {
            fields.rotation = "Use 0, 90, 180 or 270";
        }
        if (Object.keys(fields).length)
            return { ok: false, fields };
        return { ok: true, layer, x, y, rotation };
    }
    const SHELF_MAX = 23;
    function fmtCoord(n) {
        return Number.isInteger(n) ? `${n}.0` : `${n}`;
    }
    function placementRefused(reason, message) {
        return new AppError(409, "placement_refused", message, undefined, { reason });
    }
    async function checkPlacement(firing, piece, input, excludePieceNumber) {
        const kiln = await store.kilnById(firing.kiln_id);
        if (!kiln)
            throw notFound();
        if (input.layer > kiln.layers) {
            throw validationError({ layer: `This kiln has ${kiln.layers} layers` });
        }
        const clay = (await store.clays()).find((c) => c.id === piece.clay_id);
        if (!clay)
            throw notFound();
        const pieceStage = planStage(piece.plan, piece.stage);
        if (firing.profile_snapshot.stage !== pieceStage) {
            throw placementRefused("stage", `Wrong stage: piece needs ${pieceStage} firing`);
        }
        if (!coneAtOrBelow(firing.profile_snapshot.cone, clay.max_cone)) {
            throw placementRefused("clay", `Clay not rated for cone ${firing.profile_snapshot.cone}`);
        }
        if (firing.profile_snapshot.stage === "glaze" && piece.cone && firing.profile_snapshot.cone !== piece.cone) {
            throw placementRefused("cone", `Wrong cone: piece is cone ${piece.cone}`);
        }
        if (Number(piece.height_in) + 1 > Number(kiln.post_height_in)) {
            throw placementRefused("height", "Too tall for this layer");
        }
        const fp = makeFootprint(piece.shape, input.rotation, {
            length: piece.length_in ? Number(piece.length_in) : 0,
            width: piece.width_in ? Number(piece.width_in) : 0,
            diameter: piece.diameter_in ? Number(piece.diameter_in) : 0
        }, input.x, input.y);
        if (pastShelfEdge(fp)) {
            throw placementRefused("edge", "Past shelf edge");
        }
        for (const post of POSTS) {
            if (meetsPost(fp, post)) {
                throw placementRefused("post", "Overlaps post");
            }
        }
        const placements = await store.placementsForFiring(firing.id);
        const pieces = new Map();
        for (const other of await store.piecesForFiring(firing.id)) {
            pieces.set(other.number, other);
        }
        let lowest = null;
        for (const pl of placements) {
            if (pl.piece_number === excludePieceNumber)
                continue;
            if (pl.layer !== input.layer)
                continue;
            const other = pieces.get(pl.piece_number);
            if (!other)
                continue;
            const otherDims = {
                length: other.length_in ? Number(other.length_in) : 0,
                width: other.width_in ? Number(other.width_in) : 0,
                diameter: other.diameter_in ? Number(other.diameter_in) : 0
            };
            const otherFp = makeFootprint(other.shape, pl.rotation, otherDims, Number(pl.x), Number(pl.y));
            if (footprintsOverlap(fp, otherFp) && (lowest === null || pl.piece_number < lowest)) {
                lowest = pl.piece_number;
            }
        }
        if (lowest !== null) {
            throw placementRefused("overlap", `Overlaps Piece ${String(lowest).padStart(4, "0")}`);
        }
    }
    router.post("/firings/:id/placements", requireRole("staff"), h(async (req, res) => {
        const user = req.user;
        const firingId = Number(req.params.id);
        const body = req.body;
        const pieceNumber = Number(body.piece_number);
        if (!Number.isInteger(pieceNumber)) {
            throw validationError({ piece_number: "Choose a piece" });
        }
        const parsed = parsePlacement(body);
        if (!parsed.ok) {
            throw validationError(parsed.fields);
        }
        const input = parsed;
        const client = await store.pool.connect();
        try {
            await client.query("BEGIN");
            const firingRes = await client.query("SELECT * FROM firings WHERE id = $1 FOR UPDATE", [firingId]);
            const firing = firingRes.rows[0];
            if (!firing) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            if (firing.status !== "building") {
                await client.query("ROLLBACK");
                throw conflict("firing_locked", "This firing is not building any more.");
            }
            const pieceRes = await client.query("SELECT * FROM pieces WHERE number = $1", [pieceNumber]);
            const piece = pieceRes.rows[0];
            if (!piece) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            if (piece.status !== "queued") {
                await client.query("ROLLBACK");
                throw conflict("piece_not_queued", "This piece is not waiting for a kiln.");
            }
            await checkPlacement(firing, piece, input, pieceNumber);
            await client.query("INSERT INTO placements (firing_id, piece_number, layer, x, y, rotation) VALUES ($1,$2,$3,$4,$5,$6)", [firingId, pieceNumber, input.layer, fmtCoord(input.x), fmtCoord(input.y), input.rotation]);
            await client.query("UPDATE pieces SET status = 'loaded' WHERE number = $1", [pieceNumber]);
            await store.addHistory(client, pieceNumber, user.name, "placed");
            await client.query("COMMIT");
            const view = await store.firingView(firing, new Date());
            const layer = view.layers.find((l) => l.layer === input.layer);
            res.status(201).json({
                placement: {
                    piece_number: pieceNumber,
                    layer: input.layer,
                    x: fmtCoord(input.x),
                    y: fmtCoord(input.y),
                    rotation: input.rotation
                },
                fill_percent: view.fill_percent,
                layer_height_in: layer?.height_in ?? null
            });
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }));
    router.patch("/firings/:id/placements/:pieceNumber", requireRole("staff"), h(async (req, res) => {
        const user = req.user;
        const firingId = Number(req.params.id);
        const pieceNumber = Number(req.params.pieceNumber);
        const body = req.body;
        const client = await store.pool.connect();
        try {
            await client.query("BEGIN");
            const firingRes = await client.query("SELECT * FROM firings WHERE id = $1 FOR UPDATE", [firingId]);
            const firing = firingRes.rows[0];
            if (!firing) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            if (firing.status !== "building") {
                await client.query("ROLLBACK");
                throw conflict("firing_locked", "This firing is not building any more.");
            }
            const existingRes = await client.query("SELECT * FROM placements WHERE firing_id = $1 AND piece_number = $2", [firingId, pieceNumber]);
            const existing = existingRes.rows[0];
            if (!existing) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            const merged = {
                layer: body.layer !== undefined ? body.layer : existing.layer,
                x: body.x !== undefined ? body.x : existing.x,
                y: body.y !== undefined ? body.y : existing.y,
                rotation: body.rotation !== undefined ? body.rotation : existing.rotation
            };
            const parsed = parsePlacement(merged);
            if (!parsed.ok) {
                await client.query("ROLLBACK");
                throw validationError(parsed.fields);
            }
            const input = parsed;
            const pieceRes = await client.query("SELECT * FROM pieces WHERE number = $1", [pieceNumber]);
            const piece = pieceRes.rows[0];
            if (!piece) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            await checkPlacement(firing, piece, input, pieceNumber);
            await client.query("UPDATE placements SET layer = $1, x = $2, y = $3, rotation = $4 WHERE firing_id = $5 AND piece_number = $6", [input.layer, fmtCoord(input.x), fmtCoord(input.y), input.rotation, firingId, pieceNumber]);
            await store.addHistory(client, pieceNumber, user.name, "moved");
            await client.query("COMMIT");
            const view = await store.firingView(firing, new Date());
            const layer = view.layers.find((l) => l.layer === input.layer);
            res.json({
                placement: {
                    piece_number: pieceNumber,
                    layer: input.layer,
                    x: fmtCoord(input.x),
                    y: fmtCoord(input.y),
                    rotation: input.rotation
                },
                fill_percent: view.fill_percent,
                layer_height_in: layer?.height_in ?? null
            });
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }));
    router.delete("/firings/:id/placements/:pieceNumber", requireRole("staff"), h(async (req, res) => {
        const user = req.user;
        const firingId = Number(req.params.id);
        const pieceNumber = Number(req.params.pieceNumber);
        const client = await store.pool.connect();
        try {
            await client.query("BEGIN");
            const firingRes = await client.query("SELECT * FROM firings WHERE id = $1 FOR UPDATE", [firingId]);
            const firing = firingRes.rows[0];
            if (!firing) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            if (firing.status !== "building") {
                await client.query("ROLLBACK");
                throw conflict("firing_locked", "This firing is not building any more.");
            }
            const del = await client.query("DELETE FROM placements WHERE firing_id = $1 AND piece_number = $2 RETURNING *", [firingId, pieceNumber]);
            if (del.rows.length === 0) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            await client.query("UPDATE pieces SET status = 'queued' WHERE number = $1", [pieceNumber]);
            await store.addHistory(client, pieceNumber, user.name, "removed");
            await client.query("COMMIT");
            const view = await store.firingView(firing, new Date());
            res.json({ fill_percent: view.fill_percent });
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }));
    router.post("/firings/:id/start", requireRole("staff"), h(async (req, res) => {
        const firingId = Number(req.params.id);
        const client = await store.pool.connect();
        try {
            await client.query("BEGIN");
            const firingRes = await client.query("SELECT * FROM firings WHERE id = $1 FOR UPDATE", [firingId]);
            const firing = firingRes.rows[0];
            if (!firing) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            if (firing.status !== "building") {
                await client.query("ROLLBACK");
                throw conflict("invalid_transition", "This firing has already been started.");
            }
            const count = await client.query("SELECT count(*)::int AS n FROM placements WHERE firing_id = $1", [firingId]);
            if (count.rows[0].n === 0) {
                await client.query("ROLLBACK");
                throw conflict("empty_load", "Place at least one piece before starting.");
            }
            const profile = firing.profile_snapshot;
            const hoursNum = Number(profile.firing_hours);
            const now = new Date();
            const ends = new Date(now.getTime() + hoursNum * cfg.firingHourSeconds * 1000);
            const coolUntil = new Date(ends.getTime() + profile.cool_down_hours * cfg.firingHourSeconds * 1000);
            await client.query("UPDATE firings SET status = 'firing', started_at = $1, firing_ends_at = $2, cool_until = $3 WHERE id = $4", [now, ends, coolUntil, firingId]);
            await client.query("UPDATE pieces SET status = 'firing' WHERE number IN (SELECT piece_number FROM placements WHERE firing_id = $1)", [firingId]);
            const placed = await store.piecesForFiring(firingId);
            for (const p of placed) {
                await store.addHistory(client, p.number, "Shelfmark", "fired");
            }
            await client.query("COMMIT");
            const fresh = await store.firingById(firingId);
            if (fresh)
                res.json(await store.firingView(fresh, new Date()));
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }));
    router.post("/firings/:id/unload", requireRole("staff"), h(async (req, res) => {
        const user = req.user;
        const firingId = Number(req.params.id);
        const body = req.body;
        const client = await store.pool.connect();
        try {
            await client.query("BEGIN");
            const firingRes = await client.query("SELECT * FROM firings WHERE id = $1 FOR UPDATE", [firingId]);
            const firing = firingRes.rows[0];
            if (!firing) {
                await client.query("ROLLBACK");
                throw notFound();
            }
            const effective = store.effectiveFiringStatus(firing, new Date());
            if (firing.status === "unloaded" || effective === "building" || effective === "unloaded") {
                await client.query("ROLLBACK");
                throw conflict("invalid_transition", "This firing cannot be unloaded now.");
            }
            const coolUntilIso = firing.cool_until?.toISOString() ?? null;
            const coolUntilLabel = firing.cool_until ? studioLabel(firing.cool_until) : null;
            if (effective === "firing") {
                await client.query("ROLLBACK");
                throw new AppError(409, "kiln_not_cool", "Kiln still firing", undefined, { cool_until: coolUntilIso, cool_until_label: coolUntilLabel });
            }
            if (effective === "cooling") {
                await client.query("ROLLBACK");
                throw new AppError(409, "kiln_not_cool", "Kiln still cooling", undefined, { cool_until: coolUntilIso, cool_until_label: coolUntilLabel });
            }
            const placed = await store.piecesForFiring(firingId);
            const needsGlazeAfter = (p) => p.plan === "bisque_and_glaze" && firing.profile_snapshot.stage === "bisque";
            const anyReady = placed.some((p) => !needsGlazeAfter(p));
            const pickupShelf = String(body.pickup_shelf ?? "").trim();
            if (anyReady && !/^[A-Z0-9]{1,8}$/.test(pickupShelf)) {
                await client.query("ROLLBACK");
                throw validationError({ pickup_shelf: "Enter a pickup shelf" });
            }
            const damage = body.damage ?? [];
            const damageEntries = [];
            const placedNumbers = new Set(placed.map((p) => p.number));
            for (const d of damage) {
                const pieceNumber = Number(d.piece_number);
                const kind = String(d.kind ?? "");
                const photoId = String(d.photo_id ?? "");
                const note = d.note === undefined || d.note === null ? null : String(d.note);
                if (!placedNumbers.has(pieceNumber)) {
                    await client.query("ROLLBACK");
                    throw validationError({ damage: "Choose a piece in this firing" });
                }
                if (kind !== "glaze_run" && kind !== "crack") {
                    await client.query("ROLLBACK");
                    throw validationError({ damage: "Choose glaze run or crack" });
                }
                if (note && note.length > 500) {
                    await client.query("ROLLBACK");
                    throw validationError({ damage: "Use at most 500 characters" });
                }
                const photo = await store.photoById(photoId);
                if (!photo || photo.uploaded_by !== user.id || photo.attached_to !== null) {
                    await client.query("ROLLBACK");
                    throw validationError({ damage: "Add a photo of the shelf" });
                }
                damageEntries.push({ piece_number: pieceNumber, kind, photo_id: photoId, note });
            }
            await client.query("DELETE FROM placements WHERE firing_id = $1", [firingId]);
            await client.query("UPDATE firings SET status = 'unloaded' WHERE id = $1", [firingId]);
            const now = new Date();
            for (const p of placed) {
                if (needsGlazeAfter(p)) {
                    await client.query("UPDATE pieces SET status = 'queued', stage = 'glaze' WHERE number = $1", [p.number]);
                }
                else {
                    await client.query("UPDATE pieces SET status = 'ready', stage = NULL, pickup_shelf = $1, ready_at = $2 WHERE number = $3", [pickupShelf, now, p.number]);
                    const email = p.owner_kind === "member" ? await store.memberEmail(p.owner_member_number) : p.guest_email;
                    if (email) {
                        await store.enqueueEmail(email, `Ready on pickup shelf: Piece ${String(p.number).padStart(4, "0")}`, `Your piece is ready on the pickup shelf\n\nPickup shelf ${pickupShelf}`, `ready-${p.number}-${firingId}`);
                    }
                }
                await store.addHistory(client, p.number, user.name, "unloaded");
            }
            for (const d of damageEntries) {
                await client.query("INSERT INTO damage_reports (piece_number, kind, note, unload_photo_id, reported_by) VALUES ($1, $2, $3, $4, $5)", [d.piece_number, d.kind, d.note, d.photo_id, user.name]);
                await store.attachPhoto(client, d.photo_id, d.piece_number);
                await store.addHistory(client, d.piece_number, user.name, "damage reported");
            }
            await client.query("COMMIT");
            const fresh = await store.firingById(firingId);
            if (fresh)
                res.json(await store.firingView(fresh, new Date()));
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }));
    // ---- damage reports ----
    router.get("/damage-reports", requireRole("owner"), async (_req, res) => {
        res.json(await store.damageReports());
    });
    router.post("/damage-reports/:id/confirm", requireRole("owner"), h(async (req, res) => {
        const user = req.user;
        const id = Number(req.params.id);
        const amount = Number(req.body.amount_cents);
        const result = await withIdempotency(req, `damage-confirm-${id}`, async () => {
            if (!Number.isInteger(amount) || amount < 100 || amount > 20000) {
                throw validationError({ amount_cents: "Enter 100 to 20000 cents" });
            }
            const report = await store.damageReportById(id);
            if (!report)
                throw notFound();
            if (report.status !== "reported") {
                throw conflict("already_settled", "This report is already settled.");
            }
            const piece = await store.pieceByNumber(report.piece_number);
            if (!piece)
                throw notFound();
            const externalKey = piece.owner_kind === "member" ? `member-${piece.owner_member_number}` : `guest-${String(piece.number).padStart(4, "0")}`;
            try {
                await kb.createCharge(externalKey, centsToDollars(amount), `Shelf damage Piece ${String(piece.number).padStart(4, "0")}`);
            }
            catch (err) {
                if (err instanceof AppError && err.status === 503) {
                    throw serviceUnavailable("billing_unavailable", "Charge not posted — billing is unreachable. The report stays open.");
                }
                throw err;
            }
            const upd = await store.pool.query("UPDATE damage_reports SET status = 'charged', amount_cents = $1, charged_at = now() WHERE id = $2 AND status = 'reported' RETURNING *", [amount, id]);
            if (upd.rows.length === 0) {
                throw conflict("already_settled", "This report is already settled.");
            }
            const client = await store.pool.connect();
            try {
                await client.query("BEGIN");
                await store.addHistory(client, report.piece_number, user.name, "damage charged");
                await client.query("COMMIT");
            }
            catch (err) {
                await client.query("ROLLBACK");
                throw err;
            }
            finally {
                client.release();
            }
            const reports = await store.damageReports();
            return { status: 200, body: reports.find((r) => r.id === id) };
        });
        if (result.replayed)
            res.set("Idempotent-Replayed", "true");
        res.status(result.status).json(result.body);
    }));
    router.post("/damage-reports/:id/waive", requireRole("owner"), h(async (req, res) => {
        const user = req.user;
        const id = Number(req.params.id);
        const client = await store.pool.connect();
        let pieceNumber;
        try {
            await client.query("BEGIN");
            const upd = await client.query("UPDATE damage_reports SET status = 'waived' WHERE id = $1 AND status = 'reported' RETURNING piece_number", [id]);
            if (upd.rows.length === 0) {
                await client.query("ROLLBACK");
                throw conflict("already_settled", "This report is already settled.");
            }
            pieceNumber = upd.rows[0].piece_number;
            await store.addHistory(client, pieceNumber, user.name, "damage waived");
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
        const reports = await store.damageReports();
        res.json(reports.find((r) => r.id === id));
    }));
    // ---- studio ----
    router.get("/studio/summary", requireRole("owner"), async (_req, res) => {
        const now = new Date();
        const ready = await store.piecesByStatus("ready");
        const reports = await store.damageReports();
        const kilns = await store.kilns();
        const kilnOut = [];
        for (const kiln of kilns) {
            if (kiln.current_firing_id) {
                const firing = await store.firingById(kiln.current_firing_id);
                if (firing) {
                    const view = await store.firingView(firing, now);
                    kilnOut.push({ kiln_id: kiln.id, firing_id: kiln.current_firing_id, fill_percent: view.fill_percent });
                    continue;
                }
            }
            kilnOut.push({ kiln_id: kiln.id, firing_id: null, fill_percent: 0 });
        }
        res.json({
            awaiting_pickup: ready.length,
            open_damage_reports: reports.filter((r) => r.status === "reported").length,
            kilns: kilnOut
        });
    });
    router.get("/studio/owed", requireRole("owner"), h(async (_req, res) => {
        const members = await store.members();
        const accounts = [];
        let total = 0;
        for (const m of members) {
            let owed = 0;
            try {
                owed = await kb.accountBalanceCents(`member-${m.member_number}`);
            }
            catch (err) {
                if (err instanceof AppError && err.status === 503)
                    throw err;
                throw err;
            }
            accounts.push({ kind: "member", member_number: m.member_number, piece_number: null, name: m.name, owed_cents: owed });
            total += owed;
        }
        const guestRows = await store.piecesByStatus("awaiting_payment");
        for (const g of guestRows) {
            const owed = g.fee_cents;
            accounts.push({
                kind: "guest",
                member_number: null,
                piece_number: g.number,
                name: g.owner_name,
                owed_cents: owed
            });
            total += owed;
        }
        res.json({ accounts, total_owed_cents: total });
    }));
    router.post("/members/:memberNumber/payments", requireRole("owner"), h(async (req, res) => {
        const user = req.user;
        const memberNumber = req.params.memberNumber;
        const result = await withIdempotency(req, `member-payment-${memberNumber}`, async () => {
            const externalKey = `member-${memberNumber}`;
            let invoices;
            try {
                invoices = await kb.listInvoices(externalKey);
            }
            catch (err) {
                if (err instanceof AppError && err.status === 503) {
                    throw serviceUnavailable("billing_unavailable", "Payment not recorded — billing is unreachable.");
                }
                throw err;
            }
            const unpaid = invoices.filter((i) => i.balance > 0);
            if (unpaid.length === 0) {
                throw conflict("nothing_owed", "Nothing is owed.");
            }
            let paid = 0;
            for (const inv of unpaid) {
                const cents = Math.round(inv.balance * 100);
                let outcome;
                try {
                    outcome = await kb.purchasePayment(externalKey, inv.invoiceId, centsToDollars(cents), `member-${memberNumber}-pay-${inv.invoiceId}-${Date.now()}`);
                }
                catch (err) {
                    if (err instanceof AppError && err.status === 503) {
                        throw serviceUnavailable("billing_unavailable", "Payment not recorded — billing is unreachable.");
                    }
                    throw err;
                }
                if (!outcome.ok) {
                    throw new AppError(502, "payment_failed", "Payment not recorded.");
                }
                paid += cents;
            }
            // Kill Bill's invoice balances settle asynchronously: wait until the
            // account balance reads zero so the response confirms the cleared balance.
            for (let attempt = 0; attempt < 12; attempt++) {
                let balance = 0;
                try {
                    balance = await kb.accountBalanceCents(externalKey);
                }
                catch (err) {
                    if (err instanceof AppError && err.status === 503) {
                        throw serviceUnavailable("billing_unavailable", "Payment not recorded — billing is unreachable.");
                    }
                    throw err;
                }
                if (balance === 0)
                    break;
                await new Promise((r) => setTimeout(r, 1000));
            }
            return { status: 200, body: { paid_cents: paid, owed_cents: 0 } };
        });
        if (result.replayed)
            res.set("Idempotent-Replayed", "true");
        res.status(result.status).json(result.body);
    }));
    router.get("/me/balance", requireRole("member"), h(async (req, res) => {
        const user = req.user;
        if (!user.member_number) {
            throw serviceUnavailable("billing_unavailable", "Balance unavailable while billing is down.");
        }
        try {
            const owed = await kb.accountBalanceCents(`member-${user.member_number}`);
            res.json({ owed_cents: owed });
        }
        catch (err) {
            if (err instanceof AppError && err.status === 503)
                throw err;
            throw err;
        }
    }));
    // First clear position helper for the frontend board (server-decided geometry).
    router.get("/firings/:id/placements/first-clear", requireRole("staff"), h(async (req, res) => {
        const firingId = Number(req.params.id);
        const pieceNumber = Number(req.query.piece_number);
        const rotation = Number(req.query.rotation ?? 0);
        const firing = await store.firingById(firingId);
        if (!firing)
            throw notFound();
        const piece = await store.pieceByNumber(pieceNumber);
        if (!piece)
            throw notFound();
        const placements = await store.placementsForFiring(firingId);
        const pieces = new Map();
        for (const other of await store.piecesForFiring(firingId))
            pieces.set(other.number, other);
        const placed = placements
            .filter((p) => p.piece_number !== pieceNumber)
            .map((p) => {
            const other = pieces.get(p.piece_number);
            if (!other)
                return null;
            return makeFootprint(other.shape, p.rotation, {
                length: other.length_in ? Number(other.length_in) : 0,
                width: other.width_in ? Number(other.width_in) : 0,
                diameter: other.diameter_in ? Number(other.diameter_in) : 0
            }, Number(p.x), Number(p.y));
        })
            .filter((f) => f !== null);
        const pos = firstClearPosition({
            length: piece.length_in ? Number(piece.length_in) : 0,
            width: piece.width_in ? Number(piece.width_in) : 0,
            diameter: piece.diameter_in ? Number(piece.diameter_in) : 0
        }, piece.shape, rotation, placed);
        res.json({ x: fmtCoord(pos.x), y: fmtCoord(pos.y) });
    }));
    return router;
}
