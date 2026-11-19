import { ApiError } from './errors';

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function requireUuidField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ApiError('validation', undefined, { [field]: fieldSpecificCopy(field) });
  }
  return value;
}

function fieldSpecificCopy(field: string): string {
  switch (field) {
    case 'client_message_id':
      return 'Sending needs a client message id in UUID form.';
    case 'thread_root_id':
      return 'Reply to a top-level message in this channel.';
    case 'quoted_message_id':
      return 'Quote a message from this channel.';
    case 'user_id':
      return 'Pick a person.';
    case 'message_id':
      return 'Pick a message from this channel.';
    default:
      return 'This field cannot be set here.';
  }
}

/** Validation entry used by endpoints that must report one error object with several fields. */
export class ValidationBag {
  private errors = new Map<string, string>();

  add(field: string, copy: string): void {
    if (!this.errors.has(field)) this.errors.set(field, copy);
  }

  throwIfAny(): void {
    if (this.errors.size > 0) {
      throw new ApiError('validation', undefined, Object.fromEntries(this.errors));
    }
  }
}

export function validationError(errors: Record<string, string>): ApiError {
  return new ApiError('validation', undefined, errors);
}
