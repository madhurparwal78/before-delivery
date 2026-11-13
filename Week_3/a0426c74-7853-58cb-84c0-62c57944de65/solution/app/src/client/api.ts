import type { ApiErrorBody, ErrorCode } from '../shared/types.ts';
import { navigate } from './history.ts';

/** A non-2xx answer, carrying the one published error body `{error, message, fields?, lines?}`. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }

  get code(): ErrorCode {
    return this.body.error;
  }

  get lines(): string[] | undefined {
    return this.body.lines;
  }

  /** The sentences to show: each field's, else the message. */
  get sentences(): string[] {
    const fields = this.body.fields ? Object.values(this.body.fields) : [];
    return fields.length > 0 ? fields : [this.message];
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** The request init of a JSON body (none when `body` is undefined). */
export function jsonInit(method: Method, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function parseFailure(response: Response): Promise<ApiFailure> {
  return new ApiFailure(response.status, (await response.json()) as ApiErrorBody);
}

/** The JSON of a 2xx answer; any other answer throws the one published error body as an `ApiFailure`. */
export async function answerJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await parseFailure(response);
  return (await response.json()) as T;
}

/** The session is gone: go to the sign-in page. */
export function leaveForSignIn(): void {
  navigate('/signin', { replace: true });
}

async function request(method: Method, path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(path, { ...init, method, credentials: 'same-origin' });
  if (response.ok) return response;
  const failure = await parseFailure(response);
  // a lost session on any account call sends the person to sign in; sign-in itself reports wrong credentials inline
  if (failure.code === 'unauthenticated' && !path.startsWith('/api/auth/')) leaveForSignIn();
  throw failure;
}

/** GET returning the JSON body. */
export async function getJson<T>(path: string): Promise<T> {
  return (await request('GET', path, {})).json();
}

/** A write whose success answer carries a JSON body. */
export async function sendJson<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<T> {
  return (await request(method, path, jsonInit(method, body))).json();
}

/** A write whose success answer is 204 without a body. */
export async function sendEmpty(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> {
  await request(method, path, jsonInit(method, body));
}

/** POST raw file bytes (underlay images, drawing text files). */
export async function sendBytes<T>(path: string, file: Blob): Promise<T> {
  return (await request('POST', path, { headers: { 'content-type': file.type || 'application/octet-stream' }, body: file })).json();
}

/** Runs a request; the server's refusal (an `ApiFailure`) goes to `refused`, any other failure is not an answer of the server and propagates. */
export async function onRefusal(run: () => Promise<unknown>, refused: (failure: ApiFailure) => void): Promise<void> {
  try {
    await run();
  } catch (failure) {
    if (!(failure instanceof ApiFailure)) throw failure;
    refused(failure);
  }
}
