export type ServiceName = 'billing' | 'file_storage';

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : 'error');
    this.status = status;
    this.body = body;
  }
}

export class ServiceDownError extends ApiError {
  readonly service: ServiceName;
  constructor(service: ServiceName) {
    super(503, { error: 'service_unavailable', service });
    this.service = service;
  }
}

export const fail = {
  unauthenticated: (): ApiError => new ApiError(401, { error: 'unauthenticated' }),
  invalidCredentials: (): ApiError => new ApiError(401, { error: 'invalid_credentials' }),
  invalidSignature: (): ApiError => new ApiError(401, { error: 'invalid_signature' }),
  forbidden: (): ApiError => new ApiError(403, { error: 'forbidden' }),
  crossOrigin: (): ApiError => new ApiError(403, { error: 'cross_origin' }),
  notFound: (): ApiError => new ApiError(404, { error: 'not_found' }),
  readOnlyMethod: (): ApiError => new ApiError(405, { error: 'read_only' }),
  gone: (): ApiError => new ApiError(410, { error: 'gone' }),
  linkExpired: (): ApiError => new ApiError(410, { error: 'link_expired' }),
  workspaceReadOnly: (): ApiError => new ApiError(402, { error: 'workspace_read_only' }),
  cardDeclined: (): ApiError => new ApiError(402, { error: 'card_declined' }),
  conflict: (code: string, extra: Record<string, unknown> = {}): ApiError =>
    new ApiError(409, { error: code, ...extra }),
  payloadTooLarge: (limitBytes: number): ApiError =>
    new ApiError(413, { error: 'payload_too_large', limitBytes }),
  fileTooLarge: (limitBytes: number): ApiError =>
    new ApiError(413, { error: 'file_too_large', limitBytes }),
  unsupportedType: (): ApiError => new ApiError(415, { error: 'unsupported_type' }),
  validation: (errors: Record<string, string>): ApiError => new ApiError(422, { errors }),
  serviceDown: (service: ServiceName): ServiceDownError => new ServiceDownError(service),
};
