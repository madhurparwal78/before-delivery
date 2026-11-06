import { centsToPlainDecimal } from './decimal';

/** The screen formats, shared by the API copy, the mail bodies and the client. */

export function trimAmount(exact: string): string {
  if (!exact.includes('.')) return exact;
  const trimmed = exact.replace(/0+$/, '');
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

export function moneyLabel(currency: string, cents: bigint): string {
  const plain = centsToPlainDecimal(cents);
  const dot = plain.indexOf('.');
  const whole = plain.slice(0, dot);
  const fraction = plain.slice(dot + 1);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${grouped}.${fraction}`;
}

export function maskedAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function countdownLabel(remainingSeconds: number): string {
  const total = Math.max(0, Math.floor(remainingSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
