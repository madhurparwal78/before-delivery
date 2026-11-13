import http from 'node:http';

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  heldBy?: { id: string; name: string; role: string };
  staffIds?: string[];
  retryAfterSeconds?: number;
  status?: string;
}

/**
 * The one place that maps failures to the API's status codes and single
 * error body. Construct with a status and code; extra fields attach with
 * the helpers so every route shares the same precedence and shape.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  extra: Record<string, unknown> = {};

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  with(key: string, value: unknown): this {
    this.extra[key] = value;
    return this;
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    for (const [k, v] of Object.entries(this.extra)) body[k as keyof ApiErrorBody] = v as never;
    return body;
  }

  static unauthorized(): ApiError {
    return new ApiError(401, 'unauthorized', 'Open your seat link again.');
  }

  static notFound(): ApiError {
    return new ApiError(404, 'not_found', 'Not found.');
  }

  static forbidden(playerOutsideStaves = false): ApiError {
    return new ApiError(403, 'forbidden', playerOutsideStaves ? 'You can edit only your own staves.' : 'Your role cannot do this.');
  }

  static crossOrigin(): ApiError {
    return new ApiError(403, 'cross_origin', 'Requests must come from Fairline itself.');
  }

  static validation(errors: Record<string, string>): ApiError {
    return new ApiError(422, 'validation', 'Check the highlighted fields.').with('errors', errors);
  }

  static payloadTooLarge(): ApiError {
    return new ApiError(413, 'payload_too_large', 'Request bodies are limited to 262,144 bytes.');
  }

  static bankTooLarge(): ApiError {
    return new ApiError(413, 'too_large', 'Sample banks are limited to 8,000,000 bytes.');
  }

  static unsupportedType(): ApiError {
    return new ApiError(415, 'unsupported_type', 'Upload a WAV (RIFF/WAVE) or SFZ file.');
  }

  static rateLimited(retryAfterSeconds: number): ApiError {
    return new ApiError(429, 'rate_limited', 'Too many edits at once. Waiting to send the rest.').with(
      'retryAfterSeconds',
      retryAfterSeconds,
    );
  }

  static opConflict(lamport: number, site: string): ApiError {
    return new ApiError(409, 'op_conflict', `Operation ${lamport}@${site} was already recorded with different content.`);
  }

  static staffHeld(holder: { id: string; name: string; role: string }, staffIds: string[], staffNames: string[]): ApiError {
    const list = staffNames.join(', ');
    return new ApiError(423, 'staff_held', `${holder.name} is holding ${list}.`)
      .with('heldBy', holder)
      .with('staffIds', staffIds);
  }

  static holdRequired(): ApiError {
    return new ApiError(409, 'hold_required', 'Hold this staff before changing it.');
  }

  static notConnected(): ApiError {
    return new ApiError(409, 'not_connected', 'Open the live session before holding staves.');
  }

  static unknownConnection(): ApiError {
    return new ApiError(422, 'validation', 'Check the highlighted fields.').with('errors', { connectionId: 'Unknown connection.' });
  }

  static partBusy(partName: string, status: string): ApiError {
    return new ApiError(409, 'part_busy', `${partName} is already being extracted.`).with('status', status);
  }

  static inviteUsed(): ApiError {
    return new ApiError(409, 'invite_used', 'This invite has already been used.');
  }

  static inviteRevoked(): ApiError {
    return new ApiError(410, 'invite_revoked', 'This invite was withdrawn.');
  }

  static alreadyRemoved(name: string): ApiError {
    return new ApiError(409, 'already_removed', `${name} was already removed.`);
  }

  static cannotRemoveComposer(): ApiError {
    return new ApiError(409, 'cannot_remove_composer', 'The composer cannot be removed.');
  }

  static pdfNotReady(partName: string, status: string): ApiError {
    return new ApiError(409, 'pdf_not_ready', `The PDF for ${partName} is not ready.`).with('status', status);
  }

  static storageUnavailable(): ApiError {
    return new ApiError(503, 'storage_unavailable', 'Storage is unavailable. Nothing was saved.');
  }

  static databaseUnavailable(): ApiError {
    return new ApiError(503, 'database_unavailable', 'The score database is unavailable. Try again shortly.');
  }

  write(res: http.ServerResponse): void {
    const body = JSON.stringify(this.body());
    if (this.status === 429) res.setHeader('Retry-After', String(this.extra.retryAfterSeconds ?? 1));
    res.writeHead(this.status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}
