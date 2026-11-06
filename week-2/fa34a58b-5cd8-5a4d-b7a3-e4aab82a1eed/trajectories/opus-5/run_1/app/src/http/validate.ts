export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(path: string, message: string): void {
    if (this.fields[path] === undefined) this.fields[path] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  get all(): Record<string, string> {
    return this.fields;
  }
}

export function truncateToMinute(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 60000) * 60000);
}
