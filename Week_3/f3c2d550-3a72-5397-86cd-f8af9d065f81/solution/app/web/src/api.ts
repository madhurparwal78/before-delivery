import type { ErrorBody } from "../../shared/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string>,
  ) {
    super(message);
  }
}

export interface Multipart {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

interface RequestOptions {
  json?: unknown;
  multipart?: Multipart;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body: ErrorBody = await response.json();
    return new ApiError(response.status, body.error.code, body.error.message, body.error.fields ?? {});
  } catch {
    return new ApiError(response.status, "unknown", response.statusText, {});
  }
}

export async function api<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.multipart) {
    headers["Content-Type"] = options.multipart.contentType;
    body = options.multipart.body;
  } else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  const response = await fetch(`/api${path}`, { method, headers, body, signal: options.signal });
  if (!response.ok) throw await toApiError(response);
  return response.json();
}

export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Encodes a form as one in-memory multipart body, so a resend after a dropped connection
 * carries exactly the same bytes (and the same idempotency key) as the first attempt.
 */
export async function encodeMultipart(fields: readonly (readonly [string, string | File])[]): Promise<Multipart> {
  const boundary = `stowdeck${crypto.randomUUID().replaceAll("-", "")}`;
  const text = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of fields) {
    if (typeof value === "string") {
      parts.push(text.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    } else {
      const filename = value.name.replaceAll('"', "%22").replaceAll("\r", "").replaceAll("\n", "");
      parts.push(
        text.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${value.type || "application/octet-stream"}\r\n\r\n`,
        ),
        new Uint8Array(await value.arrayBuffer()),
        text.encode("\r\n"),
      );
    }
  }
  parts.push(text.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
