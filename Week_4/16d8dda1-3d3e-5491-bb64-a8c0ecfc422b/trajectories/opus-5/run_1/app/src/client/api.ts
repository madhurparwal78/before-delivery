export interface Answer<Body> {
  status: number;
  body: Body;
  error: string | null;
}

async function send<Body>(method: string, path: string, payload?: unknown): Promise<Answer<Body>> {
  const response = await fetch(path, {
    method,
    headers: payload === undefined ? {} : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    credentials: 'same-origin'
  });
  const text = await response.text();
  const body = text === '' ? null : (JSON.parse(text) as unknown);
  const error =
    response.ok || body === null || typeof body !== 'object'
      ? null
      : ((body as { error?: string }).error ?? 'Something went wrong.');
  return { status: response.status, body: body as Body, error };
}

export const api = {
  get: <Body>(path: string): Promise<Answer<Body>> => send<Body>('GET', path),
  post: <Body>(path: string, payload?: unknown): Promise<Answer<Body>> => send<Body>('POST', path, payload),
  put: <Body>(path: string, payload?: unknown): Promise<Answer<Body>> => send<Body>('PUT', path, payload),
  remove: <Body>(path: string): Promise<Answer<Body>> => send<Body>('DELETE', path),
  upload: async <Body>(path: string, files: File[]): Promise<Answer<Body>> => {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
    const text = await response.text();
    const body = text === '' ? null : (JSON.parse(text) as unknown);
    const error =
      response.ok || body === null || typeof body !== 'object'
        ? null
        : ((body as { error?: string }).error ?? 'Something went wrong.');
    return { status: response.status, body: body as Body, error };
  }
};
