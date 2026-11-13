export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string> = {},
    readonly move: number | null = null,
  ) {
    super(code);
  }
}

interface ErrorEnvelope {
  error?: { code?: string; fields?: Record<string, string>; move?: number | null };
}

async function send(method: string, path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, "NETWORK");
  }
  const data = (await response.json().catch(() => null)) as (ErrorEnvelope & Record<string, unknown>) | null;
  if (!response.ok) {
    throw new ApiFailure(response.status, data?.error?.code ?? "INTERNAL", data?.error?.fields, data?.error?.move ?? null);
  }
  return data;
}

export const get = <Body>(path: string): Promise<Body> => send("GET", path) as Promise<Body>;
export const post = <Body>(path: string, body?: unknown): Promise<Body> => send("POST", path, body ?? {}) as Promise<Body>;
export const put = <Body>(path: string, body: unknown): Promise<Body> => send("PUT", path, body) as Promise<Body>;
