import type { IncomingMessage, ServerResponse } from 'node:http';

export interface FieldErrors {
  [field: string]: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: FieldErrors;
  readonly extra?: Record<string, unknown>;

  constructor (status: number, code: string, message: string, extra?: Record<string, unknown>, fields?: FieldErrors) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.fields = fields;
  }
}

export const errorBody = (error: ApiError): Record<string, unknown> => {
  const body: Record<string, unknown> = { code: error.code, message: error.message };
  if (error.fields !== undefined) body.fields = error.fields;
  if (error.extra !== undefined) Object.assign(body, error.extra);
  return { error: body };
};

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
};

export function sendError (res: ServerResponse, error: ApiError): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(error.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(errorBody(error)));
}

// Every API error is produced through these constructors, so the shape is the same everywhere.
export const errors = {
  tooLarge: (limit: number) => new ApiError(413, 'too_large', `Body exceeds the ${limit} byte limit`),
  unsupportedMediaType: (received: string) => new ApiError(415, 'unsupported_media_type', `Content type ${received} is not supported`),
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue'),
  notFound: () => new ApiError(404, 'not_found', 'Not found'),
  forbidden: () => new ApiError(403, 'forbidden', 'You may not do this'),
  forbiddenOrigin: () => new ApiError(403, 'forbidden', 'Cross-origin writes are not allowed'),
  collabOffline: () => new ApiError(503, 'collab_offline', 'Live collaboration is offline. Locks can’t be taken right now.'),
  storageUnavailable: () => new ApiError(503, 'storage_unavailable', 'Asset storage is unreachable. Uploads and publishing are paused.'),
  layerLocked: (holder: { user_id: string; display_name: string }, expiresAt: string) => new ApiError(423, 'layer_locked', `${holder.display_name} holds a lock on this layer`, { holder, expires_at: expiresAt }),
  lockHeld: (holder: { user_id: string; display_name: string }, expiresAt: string) => new ApiError(409, 'lock_held', `${holder.display_name} holds this lock`, { holder, expires_at: expiresAt }),
  lockNotHeld: () => new ApiError(409, 'lock_not_held', 'You do not hold this lock'),
  staleVersion: (currentVersion: number, current: unknown, changedBy: { user_id: string; display_name: string }) => new ApiError(409, 'stale_version', `${changedBy.display_name} changed this before your edit arrived`, { current_version: currentVersion, current, changed_by: changedBy }),
  opIdReused: () => new ApiError(409, 'op_id_reused', 'This op id was already used for a different op'),
  idTaken: () => new ApiError(409, 'id_taken', 'This id is already in use'),
  inviteUsed: () => new ApiError(410, 'invite_used', 'This invite link has already been used'),
  noPreviousVersion: () => new ApiError(409, 'no_previous_version', 'No earlier published version to roll back to'),
  notPublished: () => new ApiError(409, 'not_published', 'This version is not published'),
  assetNotReady: () => new ApiError(409, 'asset_not_ready', 'This asset is not ready'),
  assetInUse: (dependents: unknown) => new ApiError(409, 'asset_in_use', 'This asset is used by layers, materials or scripts', { dependents }),
  assetInShows: (showVersions: number[]) => new ApiError(409, 'asset_in_shows', `This asset is part of published show versions ${showVersions.join(', ')}.`, { show_versions: showVersions }),
  emailTaken: () => new ApiError(409, 'email_taken', 'An account with this email already exists'),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials', 'Email or password is incorrect'),
  validation: (fields: FieldErrors) => {
    const first = Object.values(fields)[0] ?? '';
    return new ApiError(422, 'validation', first, undefined, fields);
  },
};

export const AUTH_FIELD_MESSAGES = {
  emailInvalid: 'Enter a valid email address',
  passwordShort: 'Password must be at least 10 characters',
  displayNameInvalid: 'Display name must be 1 to 40 characters',
  emailTaken: 'An account with this email already exists',
  invalidCredentials: 'Email or password is incorrect',
} as const;

export async function readJson (req: IncomingMessage, limitBytes: number): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > limitBytes) {
        // Refuse the body but let the response reach the client.
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        reject(errors.tooLarge(limitBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(errors.validation({ body: 'The request body is not valid JSON' }));
      }
    });
    req.on('error', reject);
  });
}
