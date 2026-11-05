// The one error shape every endpoint answers with: {"error":{"code","message","fields"?}}.

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }

  toReply(): Reply {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    return { status: this.status, body: { error }, ...(this.headers ? { headers: this.headers } : {}) };
  }
}

export const notFound = (what = "Nothing is here.") => new ApiError(404, "not_found", what);
export const forbidden = () => new ApiError(403, "forbidden", "You can't do that with this sign-in.");
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

/** A 422 naming every failing field at once; throws only when there is at least one. */
export function assertValid(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "validation", "Some fields need fixing.", fields);
  }
}

export const invalid = (field: string, text: string) =>
  new ApiError(422, "validation", "Some fields need fixing.", { [field]: text });
