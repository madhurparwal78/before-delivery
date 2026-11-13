import { invalid } from './errors';

export function text(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function rawText(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === 'string' ? value : '';
}

export function integer(body: Record<string, unknown>, name: string): number | null {
  const value = body[name];
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

export class Problems {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  check(condition: boolean, field: string, message: string): void {
    if (!condition) this.add(field, message);
  }

  throwIfAny(): void {
    if (Object.keys(this.errors).length > 0) throw invalid(this.errors);
  }
}
