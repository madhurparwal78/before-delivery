// Scope by relationship, decided here and nowhere else. The caller's role and id come from the person row read on
// this call; the raiser's manager comes from the raiser's person row as it stands now. Each helper answers a SQL
// condition over a `person` alias, using `$n` for the caller's id.

/** Requests a caller may read or act on: their own, a current direct report's, or every one for people operations. */
export function requestScope(caller, raiser, n) {
  if (caller.role === "admin") return `$${n}::int IS NOT NULL`;
  if (caller.role === "manager") return `(${raiser}.id = $${n} OR ${raiser}.manager_id = $${n})`;
  return `${raiser}.id = $${n}`;
}

/** People counted on the calendar: a manager's current direct reports (inactive included), or everyone. */
export function calendarScope(caller, person, n) {
  return caller.role === "admin" ? `$${n}::int IS NOT NULL` : `${person}.manager_id = $${n}`;
}

export function readsCalendar(caller) {
  return caller.role === "manager" || caller.role === "admin";
}

/**
 * Whether a minter may share a person's month, both read as person rows on this call: a manager for a current,
 * active direct report, people operations for any active person, and only while the minter is active.
 */
export function inMintScope(minter, person) {
  return `(${person}.active AND ${minter}.active
    AND (${minter}.role = 'admin' OR (${minter}.role = 'manager' AND ${person}.manager_id = ${minter}.id)))`;
}
