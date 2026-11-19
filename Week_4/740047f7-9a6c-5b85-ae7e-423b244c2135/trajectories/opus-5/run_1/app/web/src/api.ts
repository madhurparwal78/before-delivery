import { copy } from "./copy";
import { deviceId } from "./state";

export class ApiFailure extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  details: Record<string, unknown>;
  unreachable: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string> = {},
    details: Record<string, unknown> = {},
    unreachable = false,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
    this.unreachable = unreachable;
  }

  lockedDevice(): string | null {
    const name = this.details["device_name"];
    return typeof name === "string" ? name : null;
  }
}

type Body = Record<string, unknown> | undefined;

async function send(
  method: string,
  path: string,
  body?: BodyInit | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (method !== "GET") headers["X-Pensight-Device"] = deviceId();
  try {
    return await fetch(path, { method, headers, body: body ?? null });
  } catch {
    // A call that never reaches the server prints the unreachable copy.
    window.dispatchEvent(new CustomEvent("pensight:unreachable"));
    throw new ApiFailure(0, "unreachable", copy.unreachable, {}, {}, true);
  }
}

async function unwrap(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  const payload = text.length ? safeParse(text) : null;
  if (response.ok) return payload;
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as { error: Record<string, unknown> }).error
      : {};
  throw new ApiFailure(
    response.status,
    typeof error["code"] === "string" ? (error["code"] as string) : "error",
    typeof error["message"] === "string" ? (error["message"] as string) : "Request refused",
    (error["fields"] as Record<string, string>) ?? {},
    (error["details"] as Record<string, unknown>) ?? {},
  );
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function get(path: string): Promise<any> {
  return unwrap(await send("GET", path));
}

export async function post(path: string, body?: Body): Promise<any> {
  return unwrap(
    await send(
      "POST",
      path,
      body === undefined ? null : JSON.stringify(body),
      body === undefined ? {} : { "Content-Type": "application/json" },
    ),
  );
}

export async function patch(path: string, body: Body): Promise<any> {
  return unwrap(
    await send("PATCH", path, JSON.stringify(body), {
      "Content-Type": "application/json",
    }),
  );
}

export async function del(path: string, body?: Body): Promise<any> {
  return unwrap(
    await send(
      "DELETE",
      path,
      body === undefined ? null : JSON.stringify(body),
      body === undefined ? {} : { "Content-Type": "application/json" },
    ),
  );
}

export async function upload(
  path: string,
  file: File | Blob,
  fileName: string,
  contentType: string,
): Promise<any> {
  return unwrap(
    await send("POST", path, file, {
      "Content-Type": contentType,
      "X-Filename": fileName,
    }),
  );
}

export async function heartbeat(device: string): Promise<void> {
  await send("POST", `/api/devices/${device}/heartbeat`).catch(() => undefined);
}
