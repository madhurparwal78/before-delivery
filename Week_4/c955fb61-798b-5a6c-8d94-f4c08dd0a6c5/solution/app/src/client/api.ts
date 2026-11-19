export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? "network"));
  }
}

export interface ApiResult<T> {
  body: T;
  rev: number | null;
}

/** One call to the server; no answer is a failure with status 0. */
export async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, { error: "network" });
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!response.ok) throw new ApiFailure(response.status, parsed as Record<string, unknown>);
  const rev = response.headers.get("x-project-rev");
  return { body: parsed as T, rev: rev === null ? null : Number(rev) };
}
