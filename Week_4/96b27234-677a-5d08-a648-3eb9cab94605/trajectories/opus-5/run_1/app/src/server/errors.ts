export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, text: string) {
    super(text);
    this.status = status;
  }
}

export const notSignedIn = (): ApiError => new ApiError(401, 'Sign in first.');
export const notFound = (): ApiError => new ApiError(404, 'Not found.');
export const conflict = (text: string): ApiError => new ApiError(409, text);
export const invalid = (text: string): ApiError => new ApiError(422, text);

export const SERVICE_TEXT = {
  valkey: 'Live rooms are unavailable right now.',
  storageWrite: 'File storage is unavailable. Nothing was saved.',
  storageRead: 'File storage is unavailable.'
} as const;

export class ServiceDownError extends Error {
  readonly service: 'valkey' | 'minio';

  constructor(service: 'valkey' | 'minio') {
    super(`${service} is unreachable`);
    this.service = service;
  }
}
