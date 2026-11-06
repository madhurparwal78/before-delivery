import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PausedAction, ServiceName, StatusView } from '../shared/types';
import { api } from './api';
import { useInterval } from './hooks';

const OUTAGE_COPY: Record<ServiceName, string> = {
  billing:
    'Billing is unreachable. Confirming, cancelling, recurring slots and pack purchases are paused. Brushing and holds still work.',
  files:
    'File storage is unreachable. Uploading and opening documents are paused. Bookings still use the papers on file.',
  mail: 'Email is unreachable. Confirming, cancelling and recurring slots are paused.',
};

const SERVICE_TITLE: Record<ServiceName, string> = {
  billing: 'Billing',
  files: 'File storage',
  mail: 'Email',
};

const SERVICES: ServiceName[] = ['billing', 'files', 'mail'];

export interface ServiceState {
  status: StatusView;
  lines: string[];
  paused: (action: PausedAction) => boolean;
}

const fresh: StatusView = {
  services: { billing: 'up', files: 'up', mail: 'up' },
  paused: [],
};

const ServiceContext = createContext<ServiceState>({
  status: fresh,
  lines: [],
  paused: () => false,
});

export function useServices(): ServiceState {
  return useContext(ServiceContext);
}

export function ServiceBanner({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<StatusView>(fresh);
  const [recovered, setRecovered] = useState<ServiceName[]>([]);
  const previous = useRef<StatusView>(fresh);

  const poll = (): void => {
    void api
      .status()
      .then((next) => {
        const back = SERVICES.filter(
          (service) =>
            previous.current.services[service] === 'down' && next.services[service] === 'up',
        );
        previous.current = next;
        setStatus(next);
        if (back.length > 0) {
          setRecovered(back);
          window.setTimeout(() => setRecovered([]), 10000);
        }
      })
      .catch(() => undefined);
  };

  useEffect(poll, []);
  useInterval(poll, 10000);

  const lines = [
    ...SERVICES.filter((service) => status.services[service] === 'down').map(
      (service) => OUTAGE_COPY[service],
    ),
    ...recovered.map(
      (service) => `${SERVICE_TITLE[service]} is back. Paused actions are available again.`,
    ),
  ];

  const state: ServiceState = {
    status,
    lines,
    paused: (action) => status.paused.includes(action),
  };

  return <ServiceContext.Provider value={state}>{children}</ServiceContext.Provider>;
}
