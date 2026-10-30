export type ServiceState = 'ok' | 'delayed';

interface Health {
  billing: ServiceState;
  mail: ServiceState;
}

const health: Health = { billing: 'delayed', mail: 'delayed' };

export function markBilling(reachable: boolean): void {
  health.billing = reachable ? 'ok' : 'delayed';
}

export function markMail(reachable: boolean): void {
  health.mail = reachable ? 'ok' : 'delayed';
}

export function billingState(): ServiceState {
  return health.billing;
}

export function mailState(): ServiceState {
  return health.mail;
}
