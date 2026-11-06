/**
 * The database clock reading stored on every row. Truncating to milliseconds
 * keeps a stored instant and the instant the API reports byte-identical, so
 * roster cursors and seat-event comparisons line up exactly.
 */
export const DB_NOW = "date_trunc('milliseconds', now())";
