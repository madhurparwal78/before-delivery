import { invalid } from './errors.js';

export class Fields {
  readonly errors: Record<string, string> = {};

  text(name: string, value: unknown, min: number, max: number): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length < min || text.length > max) {
      this.errors[name] = `Use ${min} to ${max} characters.`;
      return '';
    }
    return text;
  }

  whole(name: string, value: unknown, min: number, max: number, message?: string): number {
    const number = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isInteger(number) || number < min || number > max) {
      this.errors[name] = message ?? `Use a whole number from ${min} to ${max}.`;
      return 0;
    }
    return number;
  }

  fraction(name: string, value: unknown): number {
    const number = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(number) || number < 0 || number > 1) {
      this.errors[name] = 'Use a number from 0 to 1.';
      return 0;
    }
    return Math.round(number * 1000) / 1000;
  }

  choice<T extends string>(name: string, value: unknown, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.errors[name] = `Choose one of ${allowed.join(', ')}.`;
      return allowed[0];
    }
    return value as T;
  }

  add(name: string, message: string): void {
    this.errors[name] = message;
  }

  get bad(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  done(): void {
    if (this.bad) invalid(this.errors);
  }
}

/** Uppercased, spaces removed, 2 to 7 letters or digits. */
export function normaliseRegistration(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalised = value.toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9]{2,7}$/.test(normalised) ? normalised : null;
}
