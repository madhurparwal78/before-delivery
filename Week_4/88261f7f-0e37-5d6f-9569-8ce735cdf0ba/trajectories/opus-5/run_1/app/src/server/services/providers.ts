/** Raised when a backing service cannot be reached or refuses the call. */
export class ProviderDownError extends Error {
  readonly provider: 'postgres' | 'gotenberg' | 'minio' | 'smtp';

  constructor(provider: ProviderDownError['provider'], detail: string) {
    super(`${provider} unavailable: ${detail}`);
    this.provider = provider;
  }
}

export const PROVIDER_TIMEOUT_MS = 5000;

export function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
}
