export type ErrorBody = {
  error: string;
  message: string;
  fields?: Record<string, string>;
} & Record<string, unknown>;

export class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.message);
  }
}

export class Offline extends Error {}

async function run(
  method: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...init,
    });
  } catch {
    throw new Offline('no connection');
  }
  if (!response.ok) {
    let body: ErrorBody = { error: 'not_found', message: 'Not found.' };
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      body = { error: 'not_found', message: 'Not found.' };
    }
    throw new RequestFailed(response.status, body);
  }
  return response;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await run('GET', path);
  return (await response.json()) as T;
}

export async function sendJson<T>(method: string, path: string, body: unknown): Promise<T> {
  const response = await run(method, path, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function sendForm<T>(method: string, path: string, form: FormData): Promise<T> {
  const response = await run(method, path, { body: form });
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function remove(path: string): Promise<void> {
  await run('DELETE', path);
}

export async function fetchBlobUrl(path: string): Promise<string> {
  const response = await run('GET', path);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function fetchDataUrl(path: string): Promise<string> {
  const response = await run('GET', path);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Offline('read failed'));
    reader.readAsDataURL(blob);
  });
}
