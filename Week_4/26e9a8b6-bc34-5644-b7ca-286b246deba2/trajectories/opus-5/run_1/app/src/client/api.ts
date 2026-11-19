export interface ApiReply<T> {
  status: number;
  body: T;
  retryAfter: number;
}

export interface ApiFailure {
  error: string;
  [key: string]: unknown;
}

/** Every request goes to the app's own origin. */
export async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiReply<T>> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  const retryAfter = Number(response.headers.get('Retry-After') ?? '0');
  return {
    status: response.status,
    body: (text.length > 0 ? JSON.parse(text) : {}) as T,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0,
  };
}

export interface UploadProgress {
  (sent: number, total: number): void;
}

/**
 * Uploads raw bytes and reports bytes sent, so `Stage status` can show the
 * published uploading copy from the press until the server replies.
 */
export function uploadModel(
  path: string,
  bytes: ArrayBuffer,
  onProgress: UploadProgress,
): Promise<ApiReply<unknown>> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.setRequestHeader('Content-Type', 'model/gltf-binary');
    request.upload.addEventListener('progress', (event) => {
      onProgress(event.loaded, event.total > 0 ? event.total : bytes.byteLength);
    });
    request.addEventListener('load', () => {
      resolve({
        status: request.status,
        body: request.responseText.length > 0 ? JSON.parse(request.responseText) : {},
        retryAfter: Number(request.getResponseHeader('Retry-After') ?? '0'),
      });
    });
    request.addEventListener('error', () => reject(new Error('upload failed')));
    request.send(bytes);
  });
}
