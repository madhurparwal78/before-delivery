import http from "node:http";
import https from "node:https";

interface Reply { status: number; body: Buffer }

const HEALTH_TIMEOUT_MS = 2000;
const SHEET_TIMEOUT_MS = 20000;

/** One request on a fresh connection, so a restarted Gotenberg is reached by the very next call. */
function send(url: URL, method: string, timeoutMs: number, headers: http.OutgoingHttpHeaders = {}, body?: Buffer): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, { method, headers, agent: false, signal: AbortSignal.timeout(timeoutMs) }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
      response.on("error", reject);
      response.on("close", () => reject(new Error("the connection closed before the answer ended")));
    });
    request.on("error", reject);
    request.end(body);
  });
}

export async function gotenbergAnswers(baseUrl: string): Promise<boolean> {
  try {
    const reply = await send(new URL("/health", baseUrl), "GET", HEALTH_TIMEOUT_MS);
    return reply.status >= 200 && reply.status < 300;
  } catch {
    return false;
  }
}

/** Prints an HTML document to PDF; rejects when Gotenberg is unreachable, slow or answers an error. */
export async function printHtml(baseUrl: string, html: string): Promise<Buffer> {
  const boundary = `----vireo${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const part = (name: string, value: string, filename?: string): string =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ""}\r\n` +
    `${filename ? "Content-Type: text/html\r\n" : ""}\r\n${value}\r\n`;
  const body = Buffer.from(part("files", html, "index.html") + part("preferCssPageSize", "true") + part("printBackground", "true") + `--${boundary}--\r\n`);
  const reply = await send(
    new URL("/forms/chromium/convert/html", baseUrl),
    "POST",
    SHEET_TIMEOUT_MS,
    { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length },
    body,
  );
  if (reply.status !== 200) {
    throw new Error(`Gotenberg answered ${reply.status}`);
  }
  return reply.body;
}
