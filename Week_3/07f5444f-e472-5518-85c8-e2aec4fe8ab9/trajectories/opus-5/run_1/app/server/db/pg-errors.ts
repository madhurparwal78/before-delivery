export const UNIQUE_VIOLATION = '23505';
export const EXCLUSION_VIOLATION = '23P01';

export function hasPgCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
