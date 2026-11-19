// One consistent error shape for every refusal.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export const notFound = (): ApiError => new ApiError(404, 'Not found.');
export const signInFirst = (): ApiError => new ApiError(401, 'Sign in first.');
export const conflict = (text: string): ApiError => new ApiError(409, text);
export const invalid = (text: string): ApiError => new ApiError(422, text);
export const tooMany = (text: string): ApiError => new ApiError(429, text);
export const crossOrigin = (): ApiError => new ApiError(403, 'Cross-origin requests are refused.');
export const unavailable = (text: string): ApiError => new ApiError(503, text);
