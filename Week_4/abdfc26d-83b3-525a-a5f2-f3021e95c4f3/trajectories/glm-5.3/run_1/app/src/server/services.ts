import { config } from '../config.js';
import { createStorage, type StorageLike } from './lib/storage.js';
import { KillBillClient } from './lib/killbill.js';
import { AiProviderClient, RenderProviderClient } from './lib/ai.js';
import { RenderQueue } from './lib/queue.js';
import { KeycloakAdmin } from './lib/keycloak.js';
import { mailProbe } from './lib/mail.js';
import { gotenbergProbe } from './lib/gotenberg.js';

export interface AppServices {
  storage: StorageLike;
  killbill: KillBillClient;
  ai: AiProviderClient;
  renderProvider: RenderProviderClient;
  queue: RenderQueue;
  keycloak: KeycloakAdmin;
}

export function buildServices(): AppServices {
  return {
    storage: createStorage(),
    killbill: new KillBillClient(),
    ai: new AiProviderClient(),
    renderProvider: new RenderProviderClient(),
    queue: new RenderQueue(),
    keycloak: new KeycloakAdmin()
  };
}

export interface ServiceStatus {
  name: 'killbill' | 'render_provider' | 'gotenberg' | 'mail' | 'storage';
  reachable: boolean;
  checked_at: string;
}

export interface ServiceChecks {
  latest: Map<string, ServiceStatus>;
  mailReachable(): Promise<boolean>;
}

/** Per-instance, in-memory latest probe results, as the brief requires. */
export function startServiceChecks(services: AppServices): ServiceChecks {
  const latest = new Map<string, ServiceStatus>();
  const check = async () => {
    const now = new Date().toISOString();
    const [killbill, provider, gotenberg, mail, storage] = await Promise.all([
      services.killbill.probe().catch(() => false),
      providerProbe().catch(() => false),
      gotenbergProbe().catch(() => false),
      mailProbe().catch(() => false),
      services.storage.probe().catch(() => false)
    ]);
    latest.set('killbill', { name: 'killbill', reachable: killbill, checked_at: now });
    latest.set('render_provider', { name: 'render_provider', reachable: provider, checked_at: now });
    latest.set('gotenberg', { name: 'gotenberg', reachable: gotenberg, checked_at: now });
    latest.set('mail', { name: 'mail', reachable: mail, checked_at: now });
    latest.set('storage', { name: 'storage', reachable: storage, checked_at: now });
  };
  void check();
  const timer = setInterval(() => { void check(); }, 10_000);
  timer.unref();
  return {
    latest,
    mailReachable(): Promise<boolean> {
      return mailProbe();
    }
  };
}

async function providerProbe(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    // The provider has no dedicated health endpoint; a cheap stub call answers.
    const res = await fetch(`${config.wiremockUrl}/v1/shader-graphs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'probe', engine: 'GLSL' }),
      signal: controller.signal
    });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}
