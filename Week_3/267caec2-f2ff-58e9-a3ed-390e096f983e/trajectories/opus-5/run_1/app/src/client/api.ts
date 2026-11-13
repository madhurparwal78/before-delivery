export interface ApiError {
  error: string;
  message: string;
  errors?: Record<string, string>;
  status: number;
}

export class DeskError extends Error {
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly status: number;

  constructor(status: number, code: string, message: string, fields: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
    this.status = status;
  }
}

const NETWORK_COPY = "The desk can't be reached. Check your connection and try again.";

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new DeskError(0, 'network', NETWORK_COPY, {});
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const shape = (parsed ?? {}) as Partial<ApiError>;
    if (shape.errors !== undefined) {
      const first = Object.values(shape.errors)[0] ?? 'Check the highlighted fields.';
      throw new DeskError(response.status, 'validation', first, shape.errors);
    }
    throw new DeskError(response.status, shape.error ?? 'error', shape.message ?? NETWORK_COPY, {});
  }
  return parsed as T;
}

export function uploadImage(
  entryId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ asset: { id: string; url: string; name: string; width: number; height: number } }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file, file.name);
    request.open('POST', `/api/entries/${entryId}/assets`);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(request.responseText);
      } catch {
        parsed = null;
      }
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve(parsed as { asset: { id: string; url: string; name: string; width: number; height: number } });
        return;
      }
      const shape = (parsed ?? {}) as Partial<ApiError>;
      if (shape.errors !== undefined) {
        const first = Object.values(shape.errors)[0] ?? 'Check the file.';
        reject(new DeskError(request.status, 'validation', first, shape.errors));
        return;
      }
      reject(new DeskError(request.status, shape.error ?? 'error', shape.message ?? NETWORK_COPY, {}));
    });
    request.addEventListener('error', () => reject(new DeskError(0, 'network', NETWORK_COPY, {})));
    request.send(form);
  });
}
