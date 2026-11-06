import { useEffect, useState } from 'preact/hooks';
import type { ComponentChild } from 'preact';
import { api } from './api';

// Shared client pieces: provider status and the outage banner.

export function useProviders(): { killbill: 'up' | 'down'; registry: 'up' | 'down' } {
  const [status, setStatus] = useState<{ killbill: 'up' | 'down'; registry: 'up' | 'down' }>({ killbill: 'up', registry: 'up' });
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const s = await api<{ killbill: 'up' | 'down'; registry: 'up' | 'down' }>('GET', '/api/status');
        if (!stopped) setStatus(s);
      } catch {
        /* keep the last known status */
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);
  return status;
}

export function OutageBanner(): ComponentChild {
  const providers = useProviders();
  const banners: string[] = [];
  if (providers.killbill === 'down') banners.push('Payments are paused. Nothing has been charged.');
  if (providers.registry === 'down') banners.push('Plate registry unreachable. Your fit stays unconfirmed until it answers.');
  return (
    <div role="alert" aria-label="Provider outage">
      {banners.map((b) => <p class="alert-banner" key={b}>{b}</p>)}
    </div>
  );
}
