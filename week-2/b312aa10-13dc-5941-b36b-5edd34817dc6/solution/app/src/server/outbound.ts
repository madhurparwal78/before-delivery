// HTTP calls to Kill Bill and object storage over node:http. The WHATWG fetch refuses a list of
// "bad" ports outright, so it could never reach a configured address on one of them, even once
// that address starts answering.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface Reply {
  status: number;
  ok: boolean;
  body: Buffer;
  text(): string;
  json(): unknown;
}

interface Outgoing {
  method: string;
  headers: Record<string, string>;
  body?: Buffer | string;
  timeoutMs: number;
}

/**
 * Sends one request on a fresh connection to the configured address (no pooled sockets, so a
 * connection opened while the address meant something else is never reused) and reads the whole
 * answer; any network failure or timeout rejects.
 */
export function send(url: URL | string, { method, headers, body, timeoutMs }: Outgoing): Promise<Reply> {
  const target = new URL(url);
  const call = target.protocol === "https:" ? httpsRequest : httpRequest;
  const payload = body === undefined ? undefined : Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = call(target, {
      method,
      headers: payload ? { ...headers, "content-length": String(payload.length) } : headers,
      timeout: timeoutMs,
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const data = Buffer.concat(chunks);
        const status = res.statusCode ?? 0;
        resolve({
          status, ok: status >= 200 && status < 300, body: data,
          text: () => data.toString("utf8"),
          json: () => JSON.parse(data.toString("utf8")) as unknown,
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on("error", reject);
    req.end(payload);
  });
}
