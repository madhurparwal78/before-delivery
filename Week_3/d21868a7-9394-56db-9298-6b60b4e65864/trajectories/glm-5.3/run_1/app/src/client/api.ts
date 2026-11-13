// The single API client: every error comes back in the published shapes.

export type ApiErrorShape =
  | { kind: "error"; status: number; error: string; message: string; [k: string]: unknown }
  | { kind: "fields"; status: 422; errors: Record<string, string> };

export class ApiFailure extends Error {
  constructor(public shape: ApiErrorShape) {
    super(shape.kind === "error" ? shape.message : "Some fields need attention.");
  }
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function api<T>(method: string, path: string, body?: unknown, opts?: { raw?: boolean }): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return null as T;
  if (opts?.raw) return (await res.text()) as unknown as T;
  const data = (await parse(res)) as Record<string, unknown> | null;
  if (!res.ok) {
    if (res.status === 422 && data && typeof data === "object" && "errors" in data) {
      throw new ApiFailure({ kind: "fields", status: 422, errors: data.errors as Record<string, string> });
    }
    throw new ApiFailure({
      kind: "error",
      status: res.status,
      error: (data?.error as string) ?? "unknown",
      message: (data?.message as string) ?? "",
      ...(data ?? {}),
    });
  }
  return data as T;
}

export function errorOf(e: unknown): { code: string; message: string; status: number; extra: Record<string, unknown> } {
  if (e instanceof ApiFailure) {
    if (e.shape.kind === "error") {
      const { kind, status, error, message, ...extra } = e.shape;
      return { code: error, message, status, extra: extra as Record<string, unknown> };
    }
    return { code: "validation", message: "Some fields need attention.", status: 422, extra: {} };
  }
  return { code: "unknown", message: "Something went wrong.", status: 0, extra: {} };
}

export function fieldErrorsOf(e: unknown): Record<string, string> {
  if (e instanceof ApiFailure && e.shape.kind === "fields") return e.shape.errors;
  return {};
}

export function isNotSignedIn(e: unknown): boolean {
  return e instanceof ApiFailure && e.shape.kind === "error" && e.shape.error === "not_signed_in";
}
