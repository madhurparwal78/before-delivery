export type ApiSuccess<Data> = {
  ok: true;
  status: number;
  data: Data;
  headers: Headers;
};

export type ApiFailure = {
  ok: false;
  /** 0 means the request ended without any HTTP response. */
  status: number;
  code: string;
  message: string;
  errors: Record<string, string>;
  body: Record<string, unknown>;
  headers: Headers | null;
};

export type ApiResult<Data> = ApiSuccess<Data> | ApiFailure;

const noResponse: Omit<ApiFailure, 'ok'> = {
  status: 0,
  code: 'no_response',
  message: 'The request ended without an answer.',
  errors: {},
  body: {},
  headers: null,
};

async function interpret<Data>(response: Response): Promise<ApiResult<Data>> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text !== '') {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  if (response.ok) {
    return { ok: true, status: response.status, data: body as Data, headers: response.headers };
  }
  return {
    ok: false,
    status: response.status,
    code: typeof body.error === 'string' ? body.error : 'unknown',
    message: typeof body.message === 'string' ? body.message : 'Something went wrong.',
    errors: (body.errors as Record<string, string> | undefined) ?? {},
    body,
    headers: response.headers,
  };
}

export async function requestJson<Data>(
  method: string,
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<Data>> {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
    return await interpret<Data>(response);
  } catch {
    return { ok: false, ...noResponse };
  }
}

export async function getJson<Data>(url: string): Promise<ApiResult<Data>> {
  return requestJson<Data>('GET', url);
}

export type UploadProgress = (sentBytes: number, totalBytes: number) => void;

/** Multipart send through XMLHttpRequest so the brief form can show real upload progress. */
export function sendMultipart<Data>(
  url: string,
  form: FormData,
  options: { headers?: Record<string, string>; onProgress?: UploadProgress } = {},
): Promise<ApiResult<Data>> {
  return new Promise<ApiResult<Data>>((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', url, true);
    request.withCredentials = false;
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      request.setRequestHeader(name, value);
    }
    if (options.onProgress !== undefined) {
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) (options.onProgress as UploadProgress)(event.loaded, event.total);
      });
    }
    request.addEventListener('load', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(request.responseText) as Record<string, unknown>;
      } catch {
        body = {};
      }
      const headers = new Headers();
      const raw = request.getAllResponseHeaders();
      for (const line of raw.trim().split(/\r?\n/)) {
        const separator = line.indexOf(':');
        if (separator > 0) headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
      }
      if (request.status >= 200 && request.status < 300) {
        resolve({ ok: true, status: request.status, data: body as Data, headers });
        return;
      }
      resolve({
        ok: false,
        status: request.status,
        code: typeof body.error === 'string' ? body.error : 'unknown',
        message: typeof body.message === 'string' ? body.message : 'Something went wrong.',
        errors: (body.errors as Record<string, string> | undefined) ?? {},
        body,
        headers,
      });
    });
    request.addEventListener('error', () => resolve({ ok: false, ...noResponse }));
    request.addEventListener('abort', () => resolve({ ok: false, ...noResponse }));
    request.addEventListener('timeout', () => resolve({ ok: false, ...noResponse }));
    request.send(form);
  });
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
