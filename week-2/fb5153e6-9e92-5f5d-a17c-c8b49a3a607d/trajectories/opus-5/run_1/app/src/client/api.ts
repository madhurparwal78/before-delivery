import type { Locale } from '../shared/locale.js';
import type { ErrorCode } from '../shared/copy.js';
import { errorMessage, fieldMessageFromEnglish } from '../shared/copy.js';

export interface ApiFailure {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly status: number;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiCallError';
    this.failure = failure;
  }
}

interface RawError {
  error?: string;
  message?: string;
  fields?: Record<string, string>;
}

/** Turns the published English copy into the current locale. */
function localise(raw: RawError, status: number, locale: Locale): ApiFailure {
  const code = (raw.error ?? 'not_found') as ErrorCode;
  const fields: Record<string, string> = {};
  for (const [name, english] of Object.entries(raw.fields ?? {})) {
    fields[name] = fieldMessageFromEnglish(english, locale);
  }
  let message: string;
  try {
    message = errorMessage(code, locale);
  } catch {
    message = raw.message ?? '';
  }
  // Placeholders are filled from the English copy the server computed.
  if (message.includes('<') && raw.message !== undefined) message = raw.message;
  return { code, message, fields, status };
}

export interface CallOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly form?: FormData;
  readonly idempotencyKey?: string;
  readonly locale: Locale;
}

export async function call<T>(path: string, options: CallOptions): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new ApiCallError(localise(parsed as RawError, response.status, options.locale));
  }
  return parsed as T;
}

/** One key is made when a dialog opens and reused for every submit from it. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function uploadWithProgress(
  path: string,
  form: FormData,
  onProgress: (percent: number) => void,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener('load', () => {
      let parsed: unknown = {};
      try {
        parsed = request.responseText === '' ? {} : JSON.parse(request.responseText);
      } catch {
        parsed = {};
      }
      resolve({ status: request.status, body: parsed });
    });
    request.addEventListener('error', () => reject(new Error('Upload failed')));
    request.send(form);
  });
}
