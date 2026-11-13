import type { IncomingHttpHeaders } from "node:http";

export interface Context {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  remote: string;
  params: Record<string, string>;
  body: Buffer;
  /** The parsed JSON body of a JSON route; an empty or unreadable body reads as an empty object. */
  json: unknown;
  contentType: string;
}

export interface Reply {
  status: number;
  json?: unknown;
  raw?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export type BodyKind = "none" | "json" | "multipart" | "csv";

export interface Route {
  method: string;
  template: string;
  body: BodyKind;
  auth: "public" | "operator" | "sign-in";
  limited?: boolean;
  handler: (ctx: Context) => Promise<Reply>;
}

export const headerText = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ status, json: body, headers });
