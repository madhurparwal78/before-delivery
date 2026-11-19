/** What a handler answers: a status and an already-serialised body. */

export interface Reply {
  status: number;
  body: string;
  contentType: string;
  headers: Record<string, string>;
}

/** The handler took over the response (a long-lived stream). */
export const HANDLED = Symbol("handled");
export type HandlerResult = Reply | typeof HANDLED;

export const json = (status: number, value: unknown): Reply => ({ status, body: JSON.stringify(value), contentType: "application/json; charset=utf-8", headers: {} });
export const serialised = (status: number, body: string): Reply => ({ status, body, contentType: "application/json; charset=utf-8", headers: {} });
export const noContent = (): Reply => ({ status: 204, body: "", contentType: "application/json; charset=utf-8", headers: {} });
