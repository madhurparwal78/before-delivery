// Requests to the configured backing services over node:http. The WHATWG fetch refuses some ports
// outright (9, for one), and a service URL may name any port.

import http from "node:http";
import https from "node:https";

export interface ServiceAnswer {
  status: number;
  body: Buffer;
}

/** Sends one request and reads the whole answer; rejects on no connection or after `timeoutMs`. */
export function serviceRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | string | undefined,
  timeoutMs: number,
): Promise<ServiceAnswer> {
  const transport = url.startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, { method, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        clearTimeout(timer);
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) });
      });
      response.on("error", reject);
    });
    const timer = setTimeout(() => request.destroy(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end(body);
  });
}
