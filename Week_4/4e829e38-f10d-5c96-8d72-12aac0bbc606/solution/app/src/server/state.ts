/** Process-wide flags shared by the server entry and the routes. */
export const state = { ready: false };

/** A handler returns this when it has already written the response itself. */
export const RAW = Symbol("raw response");

/** A handler returns this to answer 204. */
export const NO_CONTENT = Symbol("no content");
