import { navigate } from "./router.ts";
import { Emitter } from "./emitter.ts";

interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

let csrfToken = "";
let currentUser: SessionUser | null = null;

export const sessionInfo = {
  get user() {
    return currentUser;
  },
  adopt(body: { user: SessionUser; csrfToken: string }) {
    currentUser = body.user;
    csrfToken = body.csrfToken;
  },
  clear() {
    currentUser = null;
    csrfToken = "";
  },
};

interface RequestSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

/** Network failures resolve to a synthetic 0 response so callers handle one shape. */
async function send(spec: RequestSpec): Promise<Response> {
  const headers: Record<string, string> = { ...spec.headers };
  if (spec.method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let body: BodyInit | undefined;
  if (spec.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(spec.json);
  } else if (spec.form) body = spec.form;
  try {
    return await fetch(spec.path, { method: spec.method, headers, body, credentials: "same-origin" });
  } catch {
    return Response.error();
  }
}

export async function errorBody(res: Response): Promise<ApiErrorBody | null> {
  if (res.type === "error") return null;
  try {
    const body = (await res.clone().json()) as Partial<ApiErrorBody>;
    return typeof body.error === "string" ? (body as ApiErrorBody) : null;
  } catch {
    return null;
  }
}

/** A request outside the editor's kept-request rule. A signed-out answer (another tab signed out or changed the password) lands on sign-in. */
export async function request(spec: RequestSpec, options: { allowUnauthenticated?: boolean } = {}): Promise<Response> {
  const res = await send(spec);
  if (res.status === 401 && !options.allowUnauthenticated && (await errorBody(res))?.error === "unauthenticated") {
    sessionInfo.clear();
    void navigate("/signin", { force: true });
  }
  return res;
}

/* Sign in to continue: editor requests that meet an expired session are kept and resent once after sign-in. */

interface Kept {
  spec: RequestSpec;
  resolve: (res: Response) => void;
}

const kept: Kept[] = [];
export const resumeEvents = new Emitter();

export const resume = {
  get open() {
    return kept.length > 0;
  },
};

/** Page saves, Create export, Import file and every Share dialog action. */
export async function editorRequest(spec: RequestSpec): Promise<Response> {
  const res = await request(spec);
  if (res.status === 401 && (await errorBody(res))?.error === "session_expired") {
    return new Promise((resolve) => {
      kept.push({ spec, resolve });
      resumeEvents.emit();
    });
  }
  return res;
}

/** After a successful sign-in, each kept request is resent exactly once with the new session's CSRF token. */
export function resendKept(): void {
  const items = kept.splice(0);
  resumeEvents.emit();
  for (const item of items) void send(item.spec).then(item.resolve);
}

export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A fresh random key (Idempotency-Key, temporary row ids); works outside secure contexts too. */
export function randomKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
