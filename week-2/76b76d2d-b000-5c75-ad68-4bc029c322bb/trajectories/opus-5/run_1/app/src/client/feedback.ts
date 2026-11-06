import { ApiCallError } from './api.ts';
import { setFirstText, setI18n, tr } from './i18n.ts';
import type { Args } from '../shared/strings.ts';

export type Regions = { status: string; error: string };

export function clearFieldErrors(): void {
  for (const element of document.querySelectorAll('.field-error')) element.textContent = '';
}

export function showStatus(regions: Regions, key: string, args?: Args): void {
  const status = document.getElementById(regions.status);
  if (status === null) return;
  setI18n(status, key, args);
}

export function showPlainStatus(regions: Regions, text: string): void {
  const status = document.getElementById(regions.status);
  if (status === null) return;
  status.removeAttribute('data-i18n');
  status.removeAttribute('data-i18n-args');
  status.textContent = text;
}

export function clearFeedback(regions: Regions): void {
  const status = document.getElementById(regions.status);
  const error = document.getElementById(regions.error);
  if (status !== null) {
    status.removeAttribute('data-i18n');
    status.textContent = '';
  }
  if (error !== null) {
    error.removeAttribute('data-i18n');
    error.textContent = '';
  }
  clearFieldErrors();
}

export function showFailure(regions: Regions, error: unknown, fieldMap: Record<string, string> = {}): void {
  const target = document.getElementById(regions.error);
  if (target === null) return;
  if (error instanceof ApiCallError) {
    target.removeAttribute('data-i18n');
    target.textContent = error.failure.message;
    for (const [field, message] of Object.entries(error.failure.fields ?? {})) {
      const id = fieldMap[field] ?? field;
      const node = document.getElementById(`${id}-error`);
      if (node !== null) node.textContent = message;
    }
    return;
  }
  target.textContent = tr('err_billing_unavailable');
}

export async function runAction(
  button: HTMLButtonElement,
  regions: Regions,
  action: () => Promise<void>,
  options: { pendingKey?: string } = {},
): Promise<void> {
  const label = button.getAttribute('data-i18n');
  const labelArgs = button.getAttribute('data-i18n-args');
  const pendingKey = options.pendingKey ?? 'working';
  button.disabled = true;
  setI18n(button, pendingKey);
  showStatus(regions, pendingKey);
  try {
    await action();
  } catch (error) {
    showFailure(regions, error);
  } finally {
    button.disabled = false;
    if (label !== null) {
      button.setAttribute('data-i18n', label);
      if (labelArgs !== null) button.setAttribute('data-i18n-args', labelArgs);
      else button.removeAttribute('data-i18n-args');
      setFirstText(button, tr(label, labelArgs === null ? undefined : (JSON.parse(labelArgs) as Args)));
    }
  }
}
