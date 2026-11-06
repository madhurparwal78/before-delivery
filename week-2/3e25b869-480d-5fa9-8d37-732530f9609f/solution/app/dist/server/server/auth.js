// Who is asking: the customer session, the staff session and the role table.
import { STUDIO_ACCESS } from '../shared/catalog.js';
import { pool } from './db.js';
import { ApiError } from './errors.js';
import { sessionId } from './http.js';
async function sessionCustomer(ctx) {
    const id = sessionId(ctx.cookies, 'customer', ctx.now);
    return id === null ? undefined : pool.query('SELECT id, email, locale, kb_account_id FROM customers WHERE id = $1', [id]).then((r) => r.rows[0]);
}
/** 401 unless the request carries a customer session. */
export async function requireCustomer(ctx) {
    const customer = await sessionCustomer(ctx);
    if (!customer)
        throw new ApiError(401, 'unauthenticated', ctx.m.unauthenticated);
    return customer;
}
/** 401 unless the request carries a staff session. */
export async function requireStaff(ctx) {
    const id = sessionId(ctx.cookies, 'staff', ctx.now);
    const staff = id === null ? undefined : (await pool.query('SELECT id, email, name, role FROM staff WHERE id = $1', [id])).rows[0];
    if (!staff)
        throw new ApiError(401, 'unauthenticated', ctx.m.unauthenticated);
    return staff;
}
/** 403 for a role outside the role table's row for `area`. */
export function allow(ctx, staff, area) {
    if (!STUDIO_ACCESS[area].includes(staff.role))
        throw new ApiError(403, 'forbidden', ctx.m.forbidden);
}
