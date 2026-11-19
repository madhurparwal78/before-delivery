import type { ServiceState, StatusDto } from '../../shared/types.js';

export type ServiceName = 'payments' | 'email' | 'storage' | 'documents';

const SERVICES: readonly ServiceName[] = ['payments', 'email', 'storage', 'documents'];

const state = new Map<ServiceName, ServiceState>(SERVICES.map((name) => [name, 'up']));

/** Any failed real call marks a dependency down at once; a successful one clears it. */
export function markService(name: ServiceName, next: ServiceState): void {
  state.set(name, next);
}

export function statusSnapshot(): StatusDto {
  return {
    payments: state.get('payments') ?? 'up',
    email: state.get('email') ?? 'up',
    storage: state.get('storage') ?? 'up',
    documents: state.get('documents') ?? 'up',
  };
}

/** Raised when a dependency cannot be reached, so the route can answer its 503. */
export class ServiceDownError extends Error {
  readonly service: ServiceName;

  constructor(service: ServiceName, message: string) {
    super(message);
    this.service = service;
  }
}
