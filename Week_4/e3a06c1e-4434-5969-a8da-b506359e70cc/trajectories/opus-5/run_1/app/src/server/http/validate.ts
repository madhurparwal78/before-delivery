import { validationFailed } from './errors.js';

/** Collects field errors in declaration order and raises the one 422 shape. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.errors[field] === undefined) this.errors[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  raiseIfAny(): void {
    if (this.any) throw validationFailed({ ...this.errors });
  }
}
