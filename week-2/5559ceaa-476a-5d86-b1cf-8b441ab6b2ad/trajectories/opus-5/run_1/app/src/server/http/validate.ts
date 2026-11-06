import { limits } from '../config.js';
import { validation } from './errors.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function textField(
  fields: Record<string, unknown>,
  name: string,
  message: string,
): string {
  const value = fields[name];
  if (typeof value !== 'string') throw validation({ [name]: message });
  return value;
}

export function nameField(
  fields: Record<string, unknown>,
  name: string,
  message: string,
): string {
  const value = textField(fields, name, message).trim();
  if (value.length < 1 || value.length > limits.nameChars) throw validation({ [name]: message });
  return value;
}

export function emailField(fields: Record<string, unknown>, name: string): string {
  const value = textField(fields, name, 'Enter an email address.').trim().toLowerCase();
  if (!EMAIL.test(value)) throw validation({ [name]: 'Enter an email address.' });
  return value;
}

export function wholeNumberField(
  fields: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
  message: string,
): number {
  const value = fields[name];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw validation({ [name]: message });
  }
  return value;
}

export function isoTimeField(fields: Record<string, unknown>, name: string): Date {
  const value = textField(fields, name, 'Enter a date and time.');
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw validation({ [name]: 'Enter a date and time.' });
  return at;
}
