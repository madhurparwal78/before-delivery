import type { z } from "zod";
import { errorBodySchema } from "../../shared/schemas";

type ErrorBody = z.infer<typeof errorBodySchema>;

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

type Options<T> = { method?: string; body?: unknown; schema?: z.ZodType<T> };

// Every response is parsed with its schema where it enters the client; failures keep the server's error body.
export async function api<T = void>(path: string, { method = "GET", body, schema }: Options<T> = {}): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(await response.json().catch(() => undefined));
    throw new ApiFailure(response.status, parsed.success ? parsed.data : { error: "unknown_error" });
  }
  if (response.status === 204 || !schema) return undefined as T;
  return schema.parse(await response.json());
}

export async function upload<T>(path: string, file: File, schema: z.ZodType<T>): Promise<T> {
  const form = new FormData();
  form.append("image", file);
  const response = await fetch(path, { method: "POST", credentials: "same-origin", body: form });
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(await response.json().catch(() => undefined));
    throw new ApiFailure(response.status, parsed.success ? parsed.data : { error: "unknown_error" });
  }
  return schema.parse(await response.json());
}

export const fieldErrors = (error: unknown): Record<string, string> => (error instanceof ApiFailure ? (error.body.fields ?? {}) : {});
