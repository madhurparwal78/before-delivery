// Talking to this origin. Every write goes through `attempt`, which keeps one Idempotency-Key
// across retries of the same body and reopens the sign-in dialog when a session has ended.

interface Refusal {
  error: string;
  message: string;
  errors?: Record<string, string>;
  [extra: string]: unknown;
}

export class NoReply extends Error {
  constructor() {
    super('no reply');
    this.name = 'NoReply';
  }
}

export class Refused extends Error {
  readonly status: number;
  readonly body: Refusal;

  constructor(status: number, body: Refusal) {
    super(body.message);
    this.name = 'Refused';
    this.status = status;
    this.body = body;
  }
}

async function send<T>(method: string, path: string, options: {
  body?: unknown;
  headers?: Record<string, string>;
} = {}): Promise<T> {
  let reply: Response;
  try {
    reply = await fetch(path, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new NoReply();
  }
  return readReply<T>(reply);
}

/** Every reply, JSON or multipart, is read the same way: one refusal shape, one lost reply. */
async function readReply<T>(reply: Response): Promise<T> {
  if (reply.status === 204) return undefined as T;
  const text = await reply.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!reply.ok) {
    // A refusal the server explains is read; only a reply that never arrived is a lost reply.
    if (parsed === null) throw new NoReply();
    throw new Refused(reply.status, parsed as Refusal);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => send<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    send<T>('POST', path, { body: body ?? {}, headers }),
  put: <T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> =>
    send<T>('PUT', path, { body, headers }),
  patch: <T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> =>
    send<T>('PATCH', path, { body, headers }),
  delete: <T>(path: string, headers?: Record<string, string>): Promise<T> =>
    send<T>('DELETE', path, { headers }),
  /** The uploads route is the one multipart write; the browser sets its own content type. */
  postForm: async <T>(path: string, form: FormData): Promise<T> => {
    let reply: Response;
    try {
      reply = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
    } catch {
      throw new NoReply();
    }
    return readReply<T>(reply);
  },
};

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * One attempt at a write. The key is made once and kept across retries of the same body, so a
 * lost reply followed by another press records one offer, one claim or one acceptance.
 */
export class Attempt {
  private key = newKey();
  private signature = '';

  /** A new key only when the body changes or the dialog is reopened. */
  keyFor(body: unknown): string {
    const signature = JSON.stringify(body ?? null);
    if (signature !== this.signature) {
      this.signature = signature;
      this.key = newKey();
    }
    return this.key;
  }

  reopen(): void {
    this.signature = '';
    this.key = newKey();
  }
}
