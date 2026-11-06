// HTTP calls to the providers. Each call opens a fresh connection (no keep-alive pool), so the first
// request after a provider comes back succeeds without a restart.
import http from "node:http";
import https from "node:https";
import { ProviderError, type Provider } from "./errors";

const TIMEOUT_MS = 10_000;

export interface OutboundResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export function request(
  provider: Provider,
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: Buffer },
): Promise<OutboundResponse> {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method: options.method,
        agent: false,
        headers: { ...options.headers, Connection: "close", ...(options.body ? { "Content-Length": String(options.body.length) } : {}) },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", (error) => reject(new ProviderError(provider, error.message)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("no answer within 10 seconds")));
    req.on("error", (error) => reject(new ProviderError(provider, error.message)));
    req.end(options.body);
  });
}
