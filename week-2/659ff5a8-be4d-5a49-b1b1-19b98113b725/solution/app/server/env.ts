import type { Auth } from "./auth.js";

/** What middleware leaves on the request for handlers: the parsed JSON body and, past the public routes, the caller. */
export type AppEnv = { Variables: { body: unknown; auth: Auth } };
