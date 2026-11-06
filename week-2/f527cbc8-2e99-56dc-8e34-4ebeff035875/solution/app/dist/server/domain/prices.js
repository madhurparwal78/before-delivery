export const WORK_CODES = ["trim", "front_reset", "full_reset", "front_new", "full_new"];
export const isWorkCode = (value) => typeof value === "string" && WORK_CODES.includes(value);
export const SERVICE_NAMES = {
    trim: "Trim",
    front_reset: "Front shoes, reset",
    full_reset: "Full set, reset",
    front_new: "Front shoes, new",
    full_new: "Full set, new",
};
/** The list in force on a business date: the latest effective_from on or before it. */
export async function priceListOn(db, businessDate) {
    const { rows } = await db.query(`SELECT prices, deposit_cents FROM price_lists WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1`, [businessDate]);
    return rows[0] ?? { prices: { trim: 0, front_reset: 0, full_reset: 0, front_new: 0, full_new: 0 }, deposit_cents: 0 };
}
