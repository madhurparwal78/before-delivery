import { AsyncLocalStorage } from "node:async_hooks";

/** The id the browser gave the request being served, so a tab can tell which live lines its own action caused. */
export const actionId = new AsyncLocalStorage<string>();
