// Session, practice, barns and the owner's card on file (brief: API, Session; Practice and barns; Cards).
import { signIn, signOut } from "../auth.js";
import { db, transaction } from "../db.js";
import { cardTokenError } from "../domain/gateway.js";
import { ApiError, FIELD_COPY, refuseInvalid } from "../errors.js";
import { json, openRoute, route } from "../http.js";
import { setCardOnFile } from "../payments.js";
import { practiceInfo, stamp, today } from "../practice.js";
import { isBlank, objectBody } from "./input.js";
export const ALL_ROLES = ["farrier", "apprentice", "owner", "barn_manager"];
openRoute("POST", "/api/session", async (ctx) => {
    const body = objectBody(ctx.body);
    const errors = {};
    if (isBlank(body.email) || typeof body.email !== "string")
        errors.email = FIELD_COPY.required;
    if (isBlank(body.password) || typeof body.password !== "string")
        errors.password = FIELD_COPY.required;
    refuseInvalid(errors);
    const session = await signIn(String(body.email).trim(), String(body.password));
    if (!session)
        throw new ApiError(401, "invalid_credentials");
    const { id, name, email, role } = session.user;
    return json(200, { user: { id, name, email, role } }, { "set-cookie": session.cookie });
});
route("DELETE", "/api/session", ALL_ROLES, async ({ caller }) => ({ status: 204, headers: { "set-cookie": await signOut(caller) } }));
route("GET", "/api/me", ALL_ROLES, async ({ caller }) => json(200, { id: caller.id, name: caller.name, email: caller.email, role: caller.role }));
/**
 * The practice, and for the farrier the latest outstanding-balance alert, which the shell announces once in
 * Notices on its next refresh (brief: Ledger and dashboard, Alert; Feedback states).
 */
route("GET", "/api/practice", ALL_ROLES, async ({ caller, now }) => {
    const { name, time_zone } = practiceInfo();
    const base = { name, time_zone, today: today(now) };
    if (caller.role !== "farrier")
        return json(200, base);
    const { rows } = await db.query(`SELECT id, threshold_cents, at FROM outstanding_alerts ORDER BY id DESC LIMIT 1`);
    const alert = rows[0];
    return json(200, { ...base, outstanding_alert: alert ? { id: alert.id, threshold_cents: alert.threshold_cents, at: stamp(alert.at) } : null });
});
route("GET", "/api/barns", ["farrier", "apprentice"], async () => {
    const { rows } = await db.query(`SELECT id, name, trip_fee_cents FROM barns ORDER BY name`);
    return json(200, rows);
});
route("PUT", "/api/my/card", ["owner"], async ({ caller, body }) => {
    const token = objectBody(body).card_token;
    const problem = cardTokenError(token);
    if (problem)
        refuseInvalid({ card_token: problem });
    const last4 = await transaction((client) => setCardOnFile(client, caller.id, String(token)));
    return json(200, { last4 });
}, { allowance: "payment" });
