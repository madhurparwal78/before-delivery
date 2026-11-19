import type { Locale, MessageKey, MessageParams } from '../shared/i18n/index.js';
import type { Account } from '../shared/types.js';
import type { Page } from '../server/pages.js';

export interface AppContext {
  locale: Locale;
  account: Account | null;
  page: Page;
  t(key: MessageKey, params?: MessageParams): string;
  navigate(path: string, options?: { replace?: boolean }): void;
  announce(text: string): void;
  setBanner(text: string | null): void;
  refreshAccount(): Promise<void>;
}

export interface Screen {
  destroy?(): void;
}

export interface Bootstrap {
  locale: Locale;
  page: Page;
  signedIn: boolean;
}

export function readBootstrap(): Bootstrap {
  const node = document.getElementById('bootstrap');
  if (node === null) return { locale: 'en', page: { name: 'home' }, signedIn: false };
  return JSON.parse(node.textContent ?? '{}') as Bootstrap;
}
