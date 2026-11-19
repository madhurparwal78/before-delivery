// Outbound HTTP to storage and billing over node:http. Global fetch refuses the WHATWG "bad ports"
// (9 among them) outright, and a configured address must be reachable whenever it starts answering.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface OutboundResponse {
  status: number;
  ok: boolean;
  body: Buffer;
}

/** One request on a fresh connection; rejects on a network failure or after `timeoutMs`. */
export function send(url: URL, method: string, headers: Record<string, string>, body: Buffer | undefined, timeoutMs: number): Promise<OutboundResponse> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: { ...headers, "content-length": String(body?.length ?? 0) }, agent: false, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        resolve({ status, ok: status >= 200 && status < 300, body: Buffer.concat(chunks) });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`${method} ${url.host} timed out`)));
    req.on("error", reject);
    req.end(body);
  });
}
