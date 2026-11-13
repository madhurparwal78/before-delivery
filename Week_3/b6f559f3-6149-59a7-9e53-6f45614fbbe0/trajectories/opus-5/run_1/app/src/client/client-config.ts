import type { ClientConfig } from '../server/config';

interface Bootstrap {
  config: ClientConfig;
  me: {
    user: { id: string; name: string; email: string };
    workspaces: { id: string; name: string; role: string }[];
  } | null;
}

declare global {
  interface Window {
    __HALATION__?: Bootstrap;
    __HALATION_MODE__?: string;
    __HALATION_PROJECT__?: string;
  }
}

export function config(): ClientConfig {
  const bootstrap = window.__HALATION__;
  if (!bootstrap) throw new Error('Missing configuration');
  return bootstrap.config;
}

export function bootstrapMe(): Bootstrap['me'] {
  return window.__HALATION__?.me ?? null;
}
