export type ServiceState = 'up' | 'down';

type Status = { billing: ServiceState; mail: ServiceState; checkedAt: Date };

const status: Status = { billing: 'up', mail: 'up', checkedAt: new Date() };

export function billingState(): ServiceState {
  return status.billing;
}

export function mailState(): ServiceState {
  return status.mail;
}

export function statusSnapshot(): Status {
  return { ...status };
}

export function setBilling(state: ServiceState): void {
  status.billing = state;
  status.checkedAt = new Date();
}

export function setMail(state: ServiceState): void {
  status.mail = state;
  status.checkedAt = new Date();
}
