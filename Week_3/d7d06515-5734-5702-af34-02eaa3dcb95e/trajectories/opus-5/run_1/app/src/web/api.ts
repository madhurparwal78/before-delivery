import { copy } from '../shared/copy';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly errors: Record<string, string> | null,
    readonly extra: Record<string, unknown>,
  ) {
    super(code ?? 'validation');
  }

  field(name: string): string | undefined {
    return this.errors?.[name];
  }

  get formMessage(): string | undefined {
    if (this.errors === null) return undefined;
    return Object.values(this.errors)[0];
  }
}

let linkToken: string | null = null;
let storageDown = false;
const storageListeners = new Set<(down: boolean) => void>();

/** The MinIO banner follows the last answer a storage-backed action gave. */
export function storageUnavailable(): boolean {
  return storageDown;
}

export function onStorageChange(listener: (down: boolean) => void): () => void {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

function setStorageDown(down: boolean): void {
  if (storageDown === down) return;
  storageDown = down;
  for (const listener of storageListeners) listener(down);
}

function noteStorageOutcome(path: string, failure: ApiFailure | null): void {
  if (failure !== null) {
    if (failure.code === 'storage_unavailable') setStorageDown(true);
    return;
  }
  if (path.includes('/uploads') || path.includes('/exports') || path.includes('/file-versions')) {
    setStorageDown(false);
  }
}

export function setLinkToken(token: string | null): void {
  linkToken = token;
}

export function currentLinkToken(): string | null {
  return linkToken;
}

function headers(body: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (body !== undefined) result['content-type'] = 'application/json; charset=utf-8';
  if (linkToken !== null) result.authorization = `Link ${linkToken}`;
  return result;
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: headers(body),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const failure = toFailure(response.status, payload);
    noteStorageOutcome(path, failure);
    throw failure;
  }
  noteStorageOutcome(path, null);
  return payload as T;
}

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch(path, {
    method: 'POST',
    headers: linkToken === null ? {} : { authorization: `Link ${linkToken}` },
    body: form,
  });
  const text = await response.text();
  const payload: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const failure = toFailure(response.status, payload);
    noteStorageOutcome(path, failure);
    throw failure;
  }
  noteStorageOutcome(path, null);
  return payload as T;
}

function toFailure(status: number, payload: unknown): ApiFailure {
  const body = (payload ?? {}) as Record<string, unknown>;
  if (typeof body.errors === 'object' && body.errors !== null) {
    return new ApiFailure(status, null, body.errors as Record<string, string>, body);
  }
  const code = typeof body.error === 'string' ? body.error : null;
  return new ApiFailure(status, code, null, body);
}

export type ErrorContext = 'upload' | 'export' | 'invite' | 'quote' | 'verify' | 'command' | 'generic';

/** The one place API error codes become published copy. */
export function errorCopy(failure: ApiFailure, context: ErrorContext = 'generic'): string {
  const extra = failure.extra;
  switch (failure.code) {
    case 'storage_unavailable':
      return context === 'export' ? copy.exports.storageDown : copy.files.storageDownUpload;
    case 'mail_unavailable':
      if (context === 'invite') return copy.access.inviteMailDown;
      if (context === 'quote') return copy.pro.mailDown;
      return copy.account.confirmationMailNotSent;
    case 'invite_cooldown':
      return copy.access.inviteCooldown(
        String(extra.email ?? ''),
        Number(extra.retry_after_seconds ?? 0),
      );
    case 'signin_locked':
      return copy.account.signInLocked(Math.ceil(Number(extra.retry_after_seconds ?? 0) / 60));
    case 'invalid_credentials':
      return copy.account.signInWrong;
    case 'unverified':
      return copy.account.signInUnconfirmed(String(extra.email ?? ''));
    case 'verify_link_expired':
      return copy.account.verifyExpired;
    case 'verify_link_replaced':
      return copy.account.verifyReplaced;
    case 'view_only':
      return copy.history.viewOnly;
    case 'markup_only':
      return copy.history.markupOnly;
    case 'trial_ended':
      return copy.trial.endedBanner;
    case 'folder_not_empty':
      return copy.files.folderNotEmpty(String(extra.name ?? ''));
    case 'layer_zero':
      return copy.layerError.deleteZero;
    case 'layer_current':
      return copy.layerError.deleteCurrent(String(extra.name ?? ''));
    case 'layer_locked':
      return copy.layerError.deleteLocked(String(extra.name ?? ''));
    case 'layer_in_use':
      return copy.layerError.deleteInUse(String(extra.name ?? ''), Number(extra.objects ?? 0));
    case 'file_too_large':
      return copy.files.tooLarge(String(extra.name ?? ''), Number(extra.limit_bytes ?? 0));
    case 'link_expired':
      return copy.access.expiredHeading;
    case 'link_revoked':
      return copy.access.revokedHeading;
    case 'not_found':
      return copy.access.unknownHeading;
    default:
      return failure.formMessage ?? copy.history.noObjectFound;
  }
}

export function openEventStream(path: string, handlers: Record<string, (data: never) => void>): () => void {
  const source = new EventSource(path);
  const added: Array<[string, EventListener]> = [];
  for (const [name, handler] of Object.entries(handlers)) {
    const listener: EventListener = (event) => {
      handler(JSON.parse((event as MessageEvent<string>).data) as never);
    };
    source.addEventListener(name, listener);
    added.push([name, listener]);
  }
  return () => {
    for (const [name, listener] of added) source.removeEventListener(name, listener);
    source.close();
  };
}
