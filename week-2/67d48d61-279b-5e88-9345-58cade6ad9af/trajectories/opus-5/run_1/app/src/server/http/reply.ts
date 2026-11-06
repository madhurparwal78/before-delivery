export interface Reply {
  status: number;
  json?: unknown;
  buffer?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  /** Set when the response has already been written, as the event stream does. */
  streamed?: boolean;
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({
  status,
  json: body,
  ...(headers ? { headers } : {}),
});
